import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIANTS,
  parseSSE,
  collectAgentOutputs,
  executeConversationTurn,
  summarizeResults,
} from '../lib/runner-core.mjs';

function sse(events) {
  return events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
}

function response(events, status = 200) {
  return new Response(sse(events), { status, headers: { 'content-type': 'text/event-stream' } });
}

const storeState = { stage: null, scenes: [], currentSceneId: null, mode: 'playback', whiteboardOpen: false };

test('variant configs keep A isolated and B/C comparable', () => {
  assert.deepEqual(VARIANTS.A.config, { agentIds: ['default-1'], sessionType: 'discussion' });
  assert.equal(VARIANTS.B.config.classroomMode, 'single');
  assert.equal(VARIANTS.C.config.classroomMode, 'multi');
  assert.equal(VARIANTS.B.config.discussionTopic, undefined);
  assert.equal(VARIANTS.C.config.triggerAgentId, undefined);
});

test('SSE parser and output collector preserve streamed text', () => {
  const events = parseSSE(sse([
    { type: 'agent_start', data: { messageId: 'm1', agentId: 'default-1', agentName: 'AI教师' } },
    { type: 'text_delta', data: { messageId: 'm1', content: '第一段' } },
    { type: 'text_delta', data: { messageId: 'm1', content: '第二段' } },
  ]));
  assert.equal(events.length, 3);
  assert.deepEqual(collectAgentOutputs(events), [{ messageId: 'm1', agentId: 'default-1', agentName: 'AI教师', text: '第一段第二段' }]);
});

test('C confusion turn routes once to assistant and waits for user', async () => {
  const fetchImpl = async () => response([
    { type: 'agent_start', data: { messageId: 'm2', agentId: 'default-2', agentName: 'AI助教' } },
    { type: 'text_delta', data: { messageId: 'm2', content: '换个简单例子。' } },
    { type: 'agent_end', data: { messageId: 'm2', agentId: 'default-2' } },
    { type: 'cue_user', data: { fromAgentId: 'default-2' } },
    { type: 'done', data: { totalActions: 0, totalAgents: 1, agentHadContent: true, classroomTrace: { intent: 'confusion', selectedAgentId: 'default-2', evidenceChunkIds: ['c1'], citationLabels: ['第一章 1.1'], sessionStatus: 'waiting_for_user', modelCalls: 1, latencyMs: 25, knowledgeQuery: '为什么身体会影响智能？' }, sessionStatus: 'waiting_for_user' } },
  ]);
  const { result } = await executeConversationTurn({ endpoint: 'http://new', variantId: 'C', caseId: 'confusion', turnIndex: 1, input: '我还是不懂', intent: 'confusion', messages: [], storeState, fetchImpl });
  assert.equal(result.selectedAgentId, 'default-2');
  assert.equal(result.totalAgents, 1);
  assert.equal(result.requestCount, 1);
  assert.equal(result.routeCorrect, true);
  assert.equal(result.cueUserReceived, true);
});

test('A compatibility performs a second director request to reach cue_user', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return response([
      { type: 'agent_start', data: { messageId: 'm3', agentId: 'default-1', agentName: 'AI教师' } },
      { type: 'text_delta', data: { messageId: 'm3', content: '旧版本回答' } },
      { type: 'agent_end', data: { messageId: 'm3', agentId: 'default-1' } },
      { type: 'done', data: { totalActions: 0, totalAgents: 1, agentHadContent: true, directorState: { turnCount: 1, agentResponses: [], whiteboardLedger: [] } } },
    ]);
    return response([
      { type: 'cue_user', data: { fromAgentId: 'default-1' } },
      { type: 'done', data: { totalActions: 0, totalAgents: 0, directorState: { turnCount: 1, agentResponses: [], whiteboardLedger: [] } } },
    ]);
  };
  const { result } = await executeConversationTurn({ endpoint: 'http://old', variantId: 'A', caseId: 'knowledge', turnIndex: 0, input: '什么是具身智能？', intent: 'question', messages: [], storeState, fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.output, '旧版本回答');
  assert.equal(result.requestCount, 2);
  assert.equal(result.routeCorrect, true);
});

test('summary calculates control and routing metrics', () => {
  const summaries = summarizeResults([
    { variant: 'C', caseId: 'q', expectedIntent: 'question', routeCorrect: true, error: null, oneAgentOnly: true, evidenceChunkIds: ['c1'], latencyMs: 100, modelCalls: 1 },
    { variant: 'C', caseId: 'ack', expectedIntent: 'acknowledgement', routeCorrect: true, acknowledgementNoRepeat: true, error: null, oneAgentOnly: true, evidenceChunkIds: [], latencyMs: 10, modelCalls: 0 },
    { variant: 'C', caseId: 'stop', expectedIntent: 'stop', routeCorrect: true, stopSuccess: true, error: null, oneAgentOnly: true, evidenceChunkIds: [], latencyMs: 8, modelCalls: 0 },
  ]);
  assert.equal(summaries[0].route_accuracy, 1);
  assert.equal(summaries[0].stop_success_rate, 1);
  assert.equal(summaries[0].acknowledgement_no_repeat_rate, 1);
  assert.equal(summaries[0].average_model_calls, 1 / 3);
});
