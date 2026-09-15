const DEFAULT_TIMEOUT_MS = 90_000;

export const VARIANTS = Object.freeze({
  A: {
    id: 'A',
    label: 'old-single-teacher',
    endpointKind: 'baseline',
    config: {
      agentIds: ['default-1'],
      sessionType: 'discussion',
    },
  },
  B: {
    id: 'B',
    label: 'new-single-teacher',
    endpointKind: 'new',
    config: {
      agentIds: ['default-1'],
      sessionType: 'discussion',
      classroomMode: 'single',
    },
  },
  C: {
    id: 'C',
    label: 'new-multi-agent',
    endpointKind: 'new',
    config: {
      agentIds: ['default-1', 'default-2'],
      sessionType: 'discussion',
      classroomMode: 'multi',
    },
  },
});

export function parseSSE(text) {
  const events = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const payload = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch (error) {
      events.push({
        type: 'parse_error',
        data: {
          message: error instanceof Error ? error.message : String(error),
          payload,
        },
      });
    }
  }
  return events;
}

export function collectAgentOutputs(events) {
  const order = [];
  const byMessageId = new Map();
  let currentMessageId = null;

  for (const event of events) {
    if (event.type === 'agent_start') {
      currentMessageId = event.data.messageId;
      const item = {
        messageId: event.data.messageId,
        agentId: event.data.agentId,
        agentName: event.data.agentName,
        text: '',
      };
      byMessageId.set(item.messageId, item);
      order.push(item);
      continue;
    }
    if (event.type === 'text_delta') {
      const messageId = event.data.messageId || currentMessageId;
      if (!messageId) continue;
      const item = byMessageId.get(messageId);
      if (item) item.text += event.data.content || '';
    }
  }

  return order;
}

export function expectedAgentFor(variantId, intent) {
  if (intent === 'stop' || intent === 'acknowledgement') return null;
  if (variantId === 'C' && intent === 'confusion') return 'default-2';
  return 'default-1';
}

export function buildVariantRequest({
  variantId,
  messages,
  storeState,
  directorState,
  model,
  apiKey,
  baseUrl,
}) {
  const variant = VARIANTS[variantId];
  if (!variant) throw new Error(`Unknown variant: ${variantId}`);

  const request = {
    messages,
    storeState,
    config: structuredClone(variant.config),
    apiKey: apiKey || '',
  };
  if (directorState) request.directorState = directorState;
  if (model) request.model = model;
  if (baseUrl) request.baseUrl = baseUrl;
  return request;
}

function assistantMessage(output, caseId, turnIndex, sequence) {
  return {
    id: output.messageId || `eval-${caseId}-${turnIndex}-assistant-${sequence}`,
    role: 'assistant',
    parts: [{ type: 'text', text: output.text }],
    metadata: {
      senderName: output.agentName || output.agentId,
      originalRole: 'agent',
      agentId: output.agentId,
      createdAt: Date.now(),
    },
  };
}

export function userMessage(caseId, turnIndex, input) {
  return {
    id: `eval-${caseId}-${turnIndex}-user`,
    role: 'user',
    parts: [{ type: 'text', text: input }],
    metadata: {
      senderName: 'Evaluation Student',
      originalRole: 'user',
      createdAt: Date.now(),
    },
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function executeConversationTurn({
  endpoint,
  variantId,
  caseId,
  turnIndex,
  input,
  intent,
  messages,
  storeState,
  model,
  apiKey,
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRequests = 4,
}) {
  const startedAt = Date.now();
  let directorState;
  let requestMessages = [...messages];
  const allEvents = [];
  const allOutputs = [];
  const requestDiagnostics = [];
  let cueUserReceived = false;
  let finalDone = null;
  let error = null;

  for (let requestIndex = 0; requestIndex < maxRequests; requestIndex += 1) {
    const requestBody = buildVariantRequest({
      variantId,
      messages: requestMessages,
      storeState,
      directorState,
      model,
      apiKey,
      baseUrl,
    });

    let response;
    let responseText = '';
    const requestStartedAt = Date.now();
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        `${endpoint.replace(/\/$/, '')}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
        timeoutMs,
      );
      responseText = await response.text();
    } catch (requestError) {
      error = requestError instanceof Error ? requestError.message : String(requestError);
      requestDiagnostics.push({
        requestIndex,
        status: null,
        latencyMs: Date.now() - requestStartedAt,
        error,
      });
      break;
    }

    requestDiagnostics.push({
      requestIndex,
      status: response.status,
      latencyMs: Date.now() - requestStartedAt,
      error: response.ok ? null : responseText.slice(0, 1000),
    });

    if (!response.ok) {
      error = `HTTP ${response.status}: ${responseText.slice(0, 1000)}`;
      break;
    }

    const events = parseSSE(responseText);
    allEvents.push(...events);
    const outputs = collectAgentOutputs(events);
    for (const output of outputs) {
      allOutputs.push(output);
      if (!output.text.trim()) continue;
      requestMessages.push(
        assistantMessage(output, caseId, turnIndex, allOutputs.length),
      );
    }

    cueUserReceived ||= events.some((event) => event.type === 'cue_user');
    finalDone = [...events].reverse().find((event) => event.type === 'done')?.data || null;
    directorState = finalDone?.directorState || directorState;

    if (events.some((event) => event.type === 'error')) {
      const streamError = events.find((event) => event.type === 'error');
      error = streamError?.data?.message || 'Unknown stream error';
      break;
    }
    if (cueUserReceived) break;
    if (!finalDone || finalDone.totalAgents === 0) break;
  }

  const trace = finalDone?.classroomTrace || null;
  const agentIds = allOutputs.map((output) => output.agentId);
  const expectedAgentId = expectedAgentFor(variantId, intent);
  const output = allOutputs.map((item) => item.text.trim()).filter(Boolean).join('\n\n');
  const modelCalls = trace?.modelCalls ?? agentIds.length;
  const sessionStatus = trace?.sessionStatus || finalDone?.sessionStatus || null;

  return {
    result: {
      caseId,
      variant: variantId,
      turnIndex,
      input,
      expectedIntent: intent,
      detectedIntent: trace?.intent || null,
      expectedAgentId,
      selectedAgentId: trace?.selectedAgentId || agentIds[0] || null,
      agentIds,
      output,
      outputChars: output.length,
      totalAgents: agentIds.length,
      modelCalls,
      latencyMs: Date.now() - startedAt,
      serverLatencyMs: trace?.latencyMs ?? null,
      requestCount: requestDiagnostics.length,
      cueUserReceived,
      sessionStatus,
      knowledgeQuery: trace?.knowledgeQuery ?? null,
      evidenceChunkIds: trace?.evidenceChunkIds || [],
      citationLabels: trace?.citationLabels || [],
      knowledgeError: trace?.knowledgeError || null,
      routeCorrect:
        expectedAgentId === null
          ? agentIds.length === 0
          : (trace?.selectedAgentId || agentIds[0] || null) === expectedAgentId,
      stopSuccess:
        intent === 'stop'
          ? agentIds.length === 0 && sessionStatus === 'ended'
          : null,
      acknowledgementNoRepeat:
        intent === 'acknowledgement'
          ? agentIds.length === 0 && output.length === 0
          : null,
      oneAgentOnly: agentIds.length <= 1,
      error,
      requestDiagnostics,
      events: allEvents,
    },
    messages: requestMessages,
  };
}

export async function runEvaluationCase(options) {
  const { testCase, variantId } = options;
  let messages = [];
  const results = [];

  for (let turnIndex = 0; turnIndex < testCase.turns.length; turnIndex += 1) {
    const turn = testCase.turns[turnIndex];
    messages.push(userMessage(testCase.id, turnIndex, turn.input));
    const execution = await executeConversationTurn({
      ...options,
      caseId: testCase.id,
      turnIndex,
      input: turn.input,
      intent: turn.intent,
      messages,
    });
    messages = execution.messages;
    results.push({
      ...execution.result,
      category: testCase.category,
      caseTitle: testCase.title,
    });

    if (execution.result.error || execution.result.sessionStatus === 'ended') break;
  }

  return results;
}

function ratio(values) {
  if (values.length === 0) return null;
  return values.filter(Boolean).length / values.length;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeResults(results) {
  const variants = [...new Set(results.map((result) => result.variant))];
  return variants.map((variant) => {
    const rows = results.filter((result) => result.variant === variant);
    const stopRows = rows.filter((result) => result.expectedIntent === 'stop');
    const ackRows = rows.filter((result) => result.expectedIntent === 'acknowledgement');
    const evidenceRows = rows.filter((result) =>
      result.expectedIntent === 'question' || result.expectedIntent === 'confusion',
    );
    return {
      variant,
      cases: new Set(rows.map((row) => row.caseId)).size,
      turns: rows.length,
      error_rate: ratio(rows.map((row) => Boolean(row.error))),
      route_accuracy: ratio(rows.map((row) => row.routeCorrect)),
      stop_success_rate: ratio(stopRows.map((row) => row.stopSuccess)),
      acknowledgement_no_repeat_rate: ratio(
        ackRows.map((row) => row.acknowledgementNoRepeat),
      ),
      one_agent_rate: ratio(rows.map((row) => row.oneAgentOnly)),
      evidence_hit_rate:
        variant === 'A'
          ? null
          : ratio(evidenceRows.map((row) => row.evidenceChunkIds.length > 0)),
      average_latency_ms: average(rows.map((row) => row.latencyMs)),
      average_model_calls: average(rows.map((row) => row.modelCalls)),
    };
  });
}

function csvValue(value) {
  if (value === null || value === undefined) return '';
  const normalized =
    typeof value === 'number' && !Number.isInteger(value)
      ? value.toFixed(4)
      : String(value);
  return /[",\n]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}

export function summariesToCsv(summaries) {
  const headers = [
    'variant',
    'cases',
    'turns',
    'error_rate',
    'route_accuracy',
    'stop_success_rate',
    'acknowledgement_no_repeat_rate',
    'one_agent_rate',
    'evidence_hit_rate',
    'average_latency_ms',
    'average_model_calls',
  ];
  return [
    headers.join(','),
    ...summaries.map((summary) =>
      headers.map((header) => csvValue(summary[header])).join(','),
    ),
  ].join('\n');
}
