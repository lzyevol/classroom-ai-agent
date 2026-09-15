/**
 * Stateless Chat API Endpoint
 *
 * POST /api/chat - Send message, receive SSE stream
 *
 * This endpoint:
 * 1. Receives full state from client (messages + storeState)
 * 2. Runs single-pass generation
 * 3. Streams events as SSE (text deltas + tool calls)
 *
 * Fully stateless: interruption is handled by the client aborting
 * the fetch request, which triggers req.signal on the server side.
 */

import { NextRequest } from 'next/server';
import { statelessGenerate } from '@/lib/orchestration/stateless-generate';
import { getModel, parseModelString } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl, resolveProxy } from '@/lib/server/provider-config';
import type { ClassroomTrace, StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { prepareClassroomTurn } from '@/lib/orchestration/classroom/fast-classroom';
const log = createLogger('Chat API');

function createSSEEventResponse(events: StatelessEvent[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function createControlTrace(
  body: StatelessChatRequest,
  sessionStatus: 'waiting_for_user' | 'ended',
): ClassroomTrace {
  const turn = body.classroomTurn!;
  return {
    intent: turn.intent,
    selectedAgentId: null,
    evidenceChunkIds: [],
    citationLabels: [],
    sessionStatus,
    modelCalls: 0,
    latencyMs: Math.max(0, Date.now() - turn.preparedAt),
    knowledgeQuery: null,
  };
}

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

/**
 * POST /api/chat
 * Send a message and receive SSE stream of generation events
 *
 * Request body: StatelessChatRequest
 * {
 *   messages: UIMessage[],
 *   storeState: { stage, scenes, currentSceneId, mode },
 *   config: { agentIds, sessionType? },
 *   apiKey: string,
 *   baseUrl?: string,
 *   model?: string
 * }
 *
 * Response: SSE stream of StatelessEvent
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body: StatelessChatRequest = await req.json();

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }

    if (!body.storeState) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
    }

    if (!body.config || !body.config.agentIds || body.config.agentIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
    }

    // Prepared turns are trusted only when constructed by this server.
    body.classroomTurn = undefined;

    if (body.config.classroomMode) {
      if (body.config.classroomMode !== 'single' && body.config.classroomMode !== 'multi') {
        return apiError('INVALID_REQUEST', 400, 'config.classroomMode must be single or multi');
      }
      body.config.agentIds =
        body.config.classroomMode === 'single'
          ? ['default-1']
          : ['default-1', 'default-2'];
      body.classroomTurn =
        (await prepareClassroomTurn(body, body.config.classroomMode, req.signal)) || undefined;

      if (body.classroomTurn?.intent === 'stop') {
        const classroomTrace = createControlTrace(body, 'ended');
        return createSSEEventResponse([
          {
            type: 'done',
            data: {
              totalActions: 0,
              totalAgents: 0,
              agentHadContent: false,
              classroomTrace,
              sessionStatus: 'ended',
            },
          },
        ]);
      }

      if (body.classroomTurn?.intent === 'acknowledgement') {
        const classroomTrace = createControlTrace(body, 'waiting_for_user');
        return createSSEEventResponse([
          { type: 'cue_user', data: {} },
          {
            type: 'done',
            data: {
              totalActions: 0,
              totalAgents: 0,
              agentHadContent: false,
              classroomTrace,
              sessionStatus: 'waiting_for_user',
            },
          },
        ]);
      }
    }

    // Resolve API key: client > server > empty
    const modelString = body.model || 'gpt-4o-mini';
    const { providerId, modelId } = parseModelString(modelString);

    const clientBaseUrl = body.baseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const effectiveApiKey = clientBaseUrl
      ? body.apiKey || ''
      : resolveApiKey(providerId, body.apiKey);
    const effectiveBaseUrl = clientBaseUrl
      ? clientBaseUrl
      : resolveBaseUrl(providerId, body.baseUrl);
    const proxy = resolveProxy(providerId);

    if (!effectiveApiKey) {
      return apiError('MISSING_API_KEY', 401, 'API Key is required');
    }

    log.info('Processing request');
    log.info(
      `Agents: ${body.config.agentIds.join(', ')}, Messages: ${body.messages.length}, Turn: ${body.directorState?.turnCount ?? 0}`,
    );

    // Create LanguageModel via the unified provider system
    const { model: languageModel } = getModel({
      providerId,
      modelId,
      apiKey: effectiveApiKey,
      baseUrl: effectiveBaseUrl,
      proxy,
    });

    // Use the native request signal for abort propagation
    const signal = req.signal;

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Stream generation in background with heartbeat to prevent connection timeout
    const HEARTBEAT_INTERVAL_MS = 15_000;
    (async () => {
      // Heartbeat: periodically send SSE comments to keep the connection alive.
      // Proxies / browsers may close idle SSE connections after 30-120s of silence.
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      try {
        startHeartbeat();

        const generator = statelessGenerate(
          {
            ...body,
            apiKey: effectiveApiKey,
          },
          signal,
          languageModel,
          { enabled: false } satisfies ThinkingConfig,
        );

        for await (const event of generator) {
          if (signal.aborted) {
            log.info('Request was aborted');
            break;
          }

          const data = `data: ${JSON.stringify(event)}\n\n`;
          await writer.write(encoder.encode(data));
        }

        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        // If aborted, just close the writer silently
        if (signal.aborted) {
          log.info('Request aborted during streaming');
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error('Stream error:', error);

        // Try to send error event
        try {
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          // Writer may already be closed
        }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Error:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to process request',
    );
  }
}
