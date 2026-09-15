/**
 * Stateless Multi-Agent Generation
 *
 * Single-pass generation with structured JSON Array output format:
 * [{"type":"action","name":"...","params":{...}},{"type":"text","content":"natural speech"},...]
 *
 * Key design decisions:
 * - Backend is stateless (all state in request/response)
 * - Single generation pass (no generate/tool/loop)
 * - Text is natural teacher speech, NOT meta-commentary
 * - Tool calls are silent actions - students see results only
 * - Action and text objects can freely interleave in the array
 * - Uses partial-json for robust streaming of incomplete JSON
 *
 * Multi-agent orchestration:
 * - When multiple agents are configured, a director agent decides who speaks
 * - Uses LangGraph StateGraph for the orchestration loop
 * - Events are streamed via LangGraph's custom stream mode
 */

import type { LanguageModel } from 'ai';
import type { StatelessChatRequest, StatelessEvent, ParsedAction } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { WhiteboardActionRecord } from './director-prompt';
import { createOrchestrationGraph, buildInitialState } from './director-graph';
import { parse as parsePartialJson, Allow } from 'partial-json';
import { jsonrepair } from 'jsonrepair';
import { createLogger } from '@/lib/logger';

const log = createLogger('StatelessGenerate');

// ==================== Structured Output Parser ====================

/**
 * Parser state for incremental JSON Array parsing.
 *
 * Accumulates raw text from the LLM stream. Once the opening `[` is found,
 * uses `partial-json` to incrementally parse the growing array. Emits new
 * complete items as they appear, and streams partial text content deltas
 * for the last (potentially incomplete) text item.
 */
interface ParserState {
  /** Accumulated raw text from the LLM */
  buffer: string;
  /** Whether we've found the opening `[` */
  jsonStarted: boolean;
  /**
   * All speech emitted so far, concatenated.
   *
   * `jsonrepair` re-reads the whole buffer on every chunk and can return a
   * differently-shaped array each time (item counts shift, a string closes early
   * at an escaped quote then reopens). So the parser re-renders the full text
   * from scratch per chunk and emits only the growth beyond this high-water
   * mark. State keyed on item index or content length replays characters.
   */
  emittedText: string;
  /** How many actions have been emitted; actions are identified positionally. */
  emittedActionCount: number;
  /** Whether parsing is complete (closing `]` found) */
  isDone: boolean;
}

/**
 * Create initial parser state
 */
export function createParserState(): ParserState {
  return {
    buffer: '',
    jsonStarted: false,
    emittedText: '',
    emittedActionCount: 0,
    isDone: false,
  };
}

/**
 * Result from parsing a chunk
 */
export interface ParseResult {
  textChunks: string[];
  actions: ParsedAction[];
  isDone: boolean;
  /**
   * Original interleaving of text and action segments. Covers *every* entry in
   * `textChunks` and `actions`, so consumers should iterate this and nothing
   * else — indices into the other two arrays are not otherwise contiguous.
   */
  ordered: Array<{ type: 'text'; index: number } | { type: 'action'; index: number }>;
}

/**
 * Emit a single parsed item into the result, returning updated segment indices.
 */
function emitItem(item: Record<string, unknown>, result: ParseResult): void {
  if (item.type === 'text') {
    // Models sometimes echo the protocol inside their own speech; never relay it.
    const content = stripProtocolJson((item.content as string) || '');
    if (content) {
      result.textChunks.push(content);
      // Index into this call's array, which is what `ordered` entries refer to.
      result.ordered.push({
        type: 'text',
        index: result.textChunks.length - 1,
      });
    }
  } else if (item.type === 'action') {
    // Support both new format (name/params) and legacy format (tool_name/parameters)
    const action: ParsedAction = {
      actionId:
        (item.action_id as string) || `action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      actionName: (item.name || item.tool_name) as string,
      params: (item.params || item.parameters || {}) as Record<string, unknown>,
    };
    result.actions.push(action);
    // Index into this call's array, which is what `ordered` entries refer to.
    result.ordered.push({ type: 'action', index: result.actions.length - 1 });
  }
}

/**
 * Recover structured items when a model omits the required surrounding array,
 * for example: `natural text {"type":"text","content":"natural text"}`.
 * The structured object is authoritative, so its protocol wrapper is never
 * exposed as chat text.
 */
/**
 * Pull `{"type":"text"|"action"}` objects out of a loosely formatted reply,
 * keeping the plain prose that sits between them.
 *
 * Without the prose, narration written outside the JSON is silently dropped;
 * without the objects being removed, the raw JSON leaks into the transcript.
 */
function extractLooseSegments(content: string): {
  items: Array<Record<string, unknown>>;
  /** Ranges covered by recognised objects, in order. */
  spans: Array<{ start: number; end: number }>;
} {
  const items: Array<Record<string, unknown>> = [];
  const spans: Array<{ start: number; end: number }> = [];

  for (let start = 0; start < content.length; start++) {
    if (content[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < content.length; end++) {
      const char = content[end];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          const candidate = content.slice(start, end + 1);
          try {
            const parsed = JSON.parse(jsonrepair(candidate)) as Record<string, unknown>;
            if (parsed && (parsed.type === 'text' || parsed.type === 'action')) {
              items.push(parsed);
              spans.push({ start, end: end + 1 });
              start = end;
            }
          } catch {
            // Keep scanning. Genuine plain-language responses remain supported.
          }
          break;
        }
      }
    }
  }

  return { items, spans };
}

/** Strip JSON separators left behind once structured objects are removed. */
function cleanLooseProse(value: string): string {
  return value.replace(/^[\s,[\]]+|[\s,[\]]+$/g, '').trim();
}

/**
 * A protocol object the stream cut off before its closing brace. Balanced
 * objects are removed by span first, so a survivor is unterminated by
 * definition and nothing of value follows it.
 */
const TRUNCATED_PROTOCOL_RE = /\{\s*(?:\\?"(?:t(?:y(?:p(?:e\\?"?)?)?)?)?)?$|\{\s*\\?"type[\s\S]*$/i;

/** Cheap pre-check so ordinary prose skips the object scanner entirely. */
function mayContainProtocolJson(value: string): boolean {
  return value.includes('{') && /\\?"type\\?"/.test(value);
}

/**
 * Recognises a protocol object by shape alone, without requiring it to parse.
 * Tolerates `\"type\"` because an echo nested in a string arrives escaped.
 */
const PROTOCOL_SHAPE_RE = /\\?"type\\?"\s*:\s*\\?"(?:text|action)\\?"/i;

/**
 * Brace-balanced spans of protocol-shaped objects.
 *
 * Deliberately shape-based rather than parse-based: an object with unescaped
 * quotes still must not reach the transcript, and `extractLooseSegments` skips
 * anything `jsonrepair` cannot fix.
 */
function protocolObjectSpans(value: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];

  for (let start = 0; start < value.length; start++) {
    if (value[start] !== '{') continue;

    let depth = 0;
    for (let end = start; end < value.length; end++) {
      const char = value[end];
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          const candidate = value.slice(start, end + 1);
          if (PROTOCOL_SHAPE_RE.test(candidate)) {
            spans.push({ start, end: end + 1 });
            start = end;
          }
          break;
        }
      }
    }
  }

  return spans;
}

/**
 * Remove protocol objects that the model wrote *inside* a text field.
 *
 * Models occasionally echo the output format back as part of their speech, e.g.
 * `content: "…你觉得呢？{\"type\":\"action\",…}"`. The parser cannot tell that
 * apart from real narration, so the raw JSON reaches the transcript. Text is
 * never allowed to carry protocol syntax, so stripping it here is safe.
 */
function stripProtocolJson(value: string): string {
  if (!mayContainProtocolJson(value)) return value;

  const spans = protocolObjectSpans(value);
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += value.slice(cursor, span.start);
    cursor = span.end;
  }
  out += value.slice(cursor);

  out = out.replace(TRUNCATED_PROTOCOL_RE, '');
  if (out === value) return value;

  // Only tidy the seams left by removal; interior punctuation stays untouched.
  return out.replace(/\s*,\s*(?=,|$)/g, '').replace(/^[\s,[\]]+|[\s,[\]]+$/g, '');
}

/**
 * Index of the `]` closing the array that starts at position 0, or -1 if the
 * array is still open.
 *
 * `endsWith(']')` is not equivalent: a model that closes the array and then
 * keeps talking leaves trailing content, so the check fails forever and the
 * garbage gets parsed as part of the array.
 */
function arrayCloseIndex(value: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0 && char === ']') return i;
    }
  }
  return -1;
}

/**
 * Longest prefix safe to stream, i.e. stopping before anything that could grow
 * into a protocol object. Holding back a few characters avoids emitting `{"ty`
 * as speech and then being unable to retract it.
 */
function protocolSafeEnd(value: string): number {
  const brace = value.indexOf('{');
  if (brace === -1) return value.length;
  const rest = value.slice(brace);
  // `{"type"` may still be arriving one character at a time.
  return '{"type":'.startsWith(rest.slice(0, 8)) || mayContainProtocolJson(rest)
    ? brace
    : value.length;
}

/** Run a parse strategy, returning null instead of throwing on failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsers return any
function tryParse(fn: () => any): any[] | null {
  try {
    const value = fn();
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

type Segment = { type: 'text'; text: string } | { type: 'action'; item: Record<string, unknown> };

/**
 * Canonical segment list for one render of the buffer, with protocol echoes
 * stripped from speech.
 *
 * While the array is still open the final item is unfinished: an action's
 * `params` may be truncated, so it waits for a later chunk; text is streamable
 * but stops short of anything that could grow into a protocol object.
 */
function buildSegments(parsed: unknown[], isArrayClosed: boolean): Segment[] {
  const segments: Segment[] = [];

  parsed.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    const isTrailing = !isArrayClosed && index === parsed.length - 1;

    if (item.type === 'text') {
      let text = stripProtocolJson((item.content as string) || '');
      if (isTrailing) text = text.slice(0, protocolSafeEnd(text));
      if (text) segments.push({ type: 'text', text });
    } else if (item.type === 'action' && !isTrailing) {
      if (item.name || item.tool_name) segments.push({ type: 'action', item });
    }
  });

  return segments;
}

/**
 * Emit only what this render adds over what has already been sent, preserving
 * the original text/action interleaving.
 */
function emitDelta(segments: Segment[], result: ParseResult, state: ParserState): void {
  const full = segments.reduce((acc, s) => (s.type === 'text' ? acc + s.text : acc), '');
  // A shrinking or rewritten render means jsonrepair reinterpreted the buffer.
  // Deltas are already on the wire, so hold text rather than replaying it.
  const textUsable = full.startsWith(state.emittedText);
  const alreadySent = state.emittedText.length;

  let offset = 0;
  let actionIndex = 0;

  for (const segment of segments) {
    if (segment.type === 'text') {
      const start = offset;
      offset += segment.text.length;
      if (!textUsable || offset <= alreadySent) continue;
      const delta = segment.text.slice(Math.max(0, alreadySent - start));
      if (!delta) continue;
      result.textChunks.push(delta);
      result.ordered.push({ type: 'text', index: result.textChunks.length - 1 });
    } else {
      if (actionIndex >= state.emittedActionCount) {
        emitItem(segment.item, result);
        state.emittedActionCount = actionIndex + 1;
      }
      actionIndex++;
    }
  }

  if (textUsable) state.emittedText = full;
}

/**
 * Parse streaming chunks of structured JSON Array output.
 *
 * The LLM is expected to produce a JSON array like:
 * [{"type":"action","name":"spotlight","params":{"elementId":"img_1"}},
 *  {"type":"text","content":"Hello students..."},...]
 *
 * This parser:
 * 1. Accumulates chunks into a buffer
 * 2. Skips any prefix before `[` (e.g. ```json\n, explanatory text) and ignores
 *    anything after the matching `]`
 * 3. Uses jsonrepair/partial-json to parse the array as it grows
 * 4. Re-renders all segments and emits only the growth over what was already
 *    sent, so a reshaped parse cannot replay speech
 * 5. Marks done at the closing `]`
 *
 * @param chunk - New chunk of text to parse
 * @param state - Current parser state (mutated in place)
 * @returns Parsed text chunks and tool calls from this chunk
 */
export function parseStructuredChunk(chunk: string, state: ParserState): ParseResult {
  const result: ParseResult = {
    textChunks: [],
    actions: [],
    isDone: false,
    ordered: [],
  };

  if (state.isDone) {
    return result;
  }

  state.buffer += chunk;

  // Step 1: Find the opening `[` if not yet found
  if (!state.jsonStarted) {
    const bracketIndex = state.buffer.indexOf('[');
    if (bracketIndex === -1) {
      return result;
    }
    // Trim everything before `[` (markdown fences, explanatory text, etc.)
    state.buffer = state.buffer.slice(bracketIndex);
    state.jsonStarted = true;
  }

  // Step 2: Locate the real end of the array. Anything the model appends after
  // it is not part of the protocol and must not be parsed or spoken.
  const closeIndex = arrayCloseIndex(state.buffer);
  const isArrayClosed = closeIndex !== -1;
  const source = isArrayClosed ? state.buffer.slice(0, closeIndex + 1) : state.buffer;

  // Step 3: Parse. Which recovery is safe depends on whether the array closed.
  //
  // `jsonrepair` rewrites structure, which is what recovers unescaped quotes in
  // speech — but on a half-arrived string containing an escaped `\"type\"` it
  // splits that string into extra array elements, producing phantom actions and
  // duplicated speech. So it is only trusted once the buffer is complete.
  // Mid-stream, `partial-json` merely completes a truncated value; it may cut a
  // string short at a stray quote, and the next render repairs that as growth.
  const repair = () => JSON.parse(jsonrepair(source));
  const complete = () =>
    parsePartialJson(
      source,
      Allow.ARR | Allow.OBJ | Allow.STR | Allow.NUM | Allow.BOOL | Allow.NULL,
    );

  const parsed =
    tryParse(() => JSON.parse(source)) ??
    (isArrayClosed
      ? (tryParse(repair) ?? tryParse(complete))
      : (tryParse(complete) ?? tryParse(repair)));
  if (!parsed) {
    return result;
  }

  // Step 4: Render this buffer to canonical segments, then emit only the growth
  // over what was already sent. Re-rendering per chunk is what makes the parser
  // immune to jsonrepair reshaping the array between chunks.
  emitDelta(buildSegments(parsed, isArrayClosed), result, state);

  // Step 5: Mark done if the array closed
  if (isArrayClosed) {
    state.isDone = true;
    result.isDone = true;
  }

  return result;
}

/**
 * Finalize parsing after the stream ends.
 *
 * Handles the case where the model never produced a valid JSON array —
 * e.g. it output plain text instead of the expected `[...]` format.
 * Emits whatever content is in the buffer as a single text item so the
 * frontend can still display something rather than showing nothing.
 */
export function finalizeParser(state: ParserState): ParseResult {
  const result: ParseResult = {
    textChunks: [],
    actions: [],
    isDone: true,
    ordered: [],
  };

  if (state.isDone) {
    return result;
  }

  const content = state.buffer.trim();
  if (!content) {
    return result;
  }

  if (!state.jsonStarted) {
    const { items: looseItems, spans } = extractLooseSegments(content);
    if (looseItems.length > 0) {
      const pushProse = (raw: string) => {
        // A stream cut mid-object leaves a fragment no span covers.
        const prose = cleanLooseProse(stripProtocolJson(raw));
        if (!prose) return;
        result.textChunks.push(prose);
        // Index into textChunks, matching what emitItem records, because
        // director-graph reads result.textChunks[entry.index].
        result.ordered.push({ type: 'text', index: result.textChunks.length - 1 });
      };

      // Interleave prose and objects in their original order so narration the
      // model wrote outside the JSON is spoken rather than dropped, and the
      // JSON itself never reaches the transcript.
      let cursor = 0;
      looseItems.forEach((item, index) => {
        const span = spans[index];
        pushProse(content.slice(cursor, span.start));
        emitItem(item, result);
        cursor = span.end;
      });
      pushProse(content.slice(cursor));
    } else {
      // Genuine plain-text response: keep it as a graceful model fallback.
      const prose = stripProtocolJson(content);
      if (prose) {
        result.textChunks.push(prose);
        result.ordered.push({ type: 'text', index: 0 });
      }
    }
  } else {
    // JSON started but never closed — try one final parse
    const finalChunk = parseStructuredChunk('', state);
    result.textChunks.push(...finalChunk.textChunks);
    result.actions.push(...finalChunk.actions);
    result.ordered.push(...finalChunk.ordered);

    // If nothing was ever emitted, fall back to the raw text after `[`. Guarded
    // on the high-water mark: re-emitting after a partial stream would duplicate.
    if (
      result.textChunks.length === 0 &&
      result.actions.length === 0 &&
      !state.emittedText &&
      state.emittedActionCount === 0
    ) {
      const bracketIndex = content.indexOf('[');
      const raw = cleanLooseProse(stripProtocolJson(content.slice(bracketIndex + 1)));
      if (raw) {
        result.textChunks.push(raw);
        result.ordered.push({ type: 'text', index: 0 });
      }
    }
  }

  state.isDone = true;
  return result;
}

// ==================== Main Generation Function ====================

/**
 * Stateless generation with streaming via LangGraph orchestration
 *
 * @param request - The chat request with full state
 * @param abortSignal - Signal for cancellation
 * @yields StatelessEvent objects for streaming
 */
export async function* statelessGenerate(
  request: StatelessChatRequest,
  abortSignal: AbortSignal,
  languageModel: LanguageModel,
  thinkingConfig?: ThinkingConfig,
): AsyncGenerator<StatelessEvent> {
  log.info(
    `[StatelessGenerate] Starting orchestration for agents: ${request.config.agentIds.join(', ')}`,
  );
  log.info(
    `[StatelessGenerate] Message count: ${request.messages.length}, turnCount: ${request.directorState?.turnCount ?? 0}`,
  );

  try {
    const graph = createOrchestrationGraph();
    const initialState = buildInitialState(request, languageModel, thinkingConfig);

    const stream = await graph.stream(initialState, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      streamMode: 'custom' as any,
      signal: abortSignal,
    });

    let totalActions = 0;
    let totalAgents = 0;
    // Tracks whether the agent dispatched in this turn produced any text or actions.
    // Each statelessGenerate call handles exactly one agent turn (client loops externally).
    let agentHadContent = false;

    // Track current agent turn to build updated directorState
    let currentAgentId: string | null = null;
    let currentAgentName: string | null = null;
    let contentPreview = '';
    let agentActionCount = 0;
    const agentWbActions: WhiteboardActionRecord[] = [];

    for await (const chunk of stream) {
      const event = chunk as StatelessEvent;

      if (event.type === 'agent_start') {
        totalAgents++;
        currentAgentId = event.data.agentId;
        currentAgentName = event.data.agentName;
        contentPreview = '';
        agentActionCount = 0;
        agentWbActions.length = 0;
      }
      if (event.type === 'text_delta' && contentPreview.length < 100) {
        contentPreview = (contentPreview + event.data.content).slice(0, 100);
        agentHadContent = true;
      }
      if (event.type === 'action') {
        totalActions++;
        agentActionCount++;
        agentHadContent = true;
        if (event.data.actionName.startsWith('wb_')) {
          agentWbActions.push({
            actionName: event.data.actionName as WhiteboardActionRecord['actionName'],
            agentId: event.data.agentId,
            agentName: currentAgentName || event.data.agentId,
            params: event.data.params,
          });
        }
      }

      yield event;
    }

    // Build updated directorState from incoming state + this turn's data
    const incoming = request.directorState;
    const prevResponses = incoming?.agentResponses ?? [];
    const prevLedger = incoming?.whiteboardLedger ?? [];
    const prevTurnCount = incoming?.turnCount ?? 0;

    const directorState =
      totalAgents > 0
        ? {
            turnCount: prevTurnCount + 1,
            agentResponses: [
              ...prevResponses,
              {
                agentId: currentAgentId!,
                agentName: currentAgentName || currentAgentId!,
                contentPreview,
                actionCount: agentActionCount,
                whiteboardActions: [...agentWbActions],
              },
            ],
            whiteboardLedger: [...prevLedger, ...agentWbActions],
          }
        : {
            turnCount: prevTurnCount,
            agentResponses: prevResponses,
            whiteboardLedger: prevLedger,
          };

    const classroomTrace = request.classroomTurn
      ? {
          intent: request.classroomTurn.intent,
          selectedAgentId: request.classroomTurn.selectedAgentId,
          evidenceChunkIds:
            request.classroomTurn.knowledge?.chunks.map((chunk) => chunk.chunk_id) || [],
          citationLabels:
            request.classroomTurn.knowledge?.citations.map((citation) =>
              `${citation.chapter_title} ${citation.section_number} ${citation.section_title}`.trim(),
            ) || [],
          sessionStatus: 'waiting_for_user' as const,
          modelCalls: totalAgents > 0 ? 1 : 0,
          latencyMs: Math.max(0, Date.now() - request.classroomTurn.preparedAt),
          knowledgeQuery: request.classroomTurn.knowledgeQuery,
          knowledgeError: request.classroomTurn.knowledge?.error,
        }
      : undefined;

    yield {
      type: 'done',
      data: {
        totalActions,
        totalAgents,
        agentHadContent,
        directorState,
        classroomTrace,
        sessionStatus: classroomTrace?.sessionStatus,
      },
    };

    log.info(
      `[StatelessGenerate] Completed. Agents: ${totalAgents}, Actions: ${totalActions}, hadContent: ${agentHadContent}, turnCount: ${directorState.turnCount}`,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      yield { type: 'error', data: { message: 'Request interrupted' } };
    } else {
      log.error('[StatelessGenerate] Error:', error);
      yield {
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
