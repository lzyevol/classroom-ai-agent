import type {
  ClassroomIntent,
  ClassroomKnowledgeContext,
  ClassroomMode,
  PreparedClassroomTurn,
  StatelessChatRequest,
} from '@/lib/types/chat';

const STOP_INPUTS = new Set([
  '\u7ed3\u675f',
  '\u7ed3\u675f\u5427',
  '\u7ed3\u675f\u8ba8\u8bba',
  '\u7ed3\u675f\u8ba8\u8bba\u5427',
  '\u505c\u6b62',
  '\u505c\u6b62\u5427',
  '\u505c\u6b62\u56de\u7b54',
  '\u505c\u6b62\u8ba8\u8bba',
  '\u5148\u5230\u8fd9\u91cc',
  '\u5c31\u5230\u8fd9\u91cc',
  '\u5230\u8fd9\u91cc',
  '\u4e0d\u804a\u4e86',
  '\u9000\u51fa\u8ba8\u8bba',
  '\u53ef\u4ee5\u7ed3\u675f\u4e86',
  '\u5c31\u8fd9\u6837',
]);

const ACK_INPUTS = new Set([
  '\u597d',
  '\u597d\u7684',
  '\u597d\u4e86',
  '\u660e\u767d',
  '\u660e\u767d\u4e86',
  '\u61c2\u4e86',
  '\u77e5\u9053\u4e86',
  '\u6536\u5230',
  '\u53ef\u4ee5',
  '\u55ef',
  '\u55ef\u55ef',
  '\u8c22\u8c22',
  '\u8c22\u8c22\u8001\u5e08',
  'ok',
  'okay',
]);

const CONFUSION_CUES = [
  '\u8fd8\u662f\u4e0d\u61c2',
  '\u8fd8\u662f\u6ca1\u61c2',
  '\u4e0d\u592a\u660e\u767d',
  '\u4e0d\u592a\u7406\u89e3',
  '\u6ca1\u542c\u61c2',
  '\u542c\u4e0d\u61c2',
  '\u542c\u4e0d\u592a\u61c2',
  '\u4e0d\u7406\u89e3',
  '\u6ca1\u7406\u89e3',
  '\u6ca1\u5f04\u61c2',
  '\u8fd9\u4e2a\u533a\u522b\u4e0d\u6e05\u695a',
  '\u4e0d\u660e\u767d',
  '\u80fd\u7b80\u5355\u70b9',
  '\u7b80\u5355\u4e00\u70b9',
  '\u6362\u4e2a\u8bf4\u6cd5',
  '\u6362\u79cd\u8bf4\u6cd5',
  '\u518d\u89e3\u91ca',
  '\u518d\u8bb2\u4e00\u904d',
];

function messageText(message: StatelessChatRequest['messages'][number]): string {
  return message.parts
    .map((part) => {
      if (typeof part !== 'object' || part === null || !('text' in part)) return '';
      return String((part as { text?: unknown }).text || '');
    })
    .join('')
    .trim();
}

export function normalizeClassroomInput(value: string): string {
  return value
    .trim()
    .replace(/[\s\u3000\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a,.!?;:~\uff5e]+/g, '')
    .toLowerCase();
}

export function classifyClassroomInput(value: string): ClassroomIntent {
  const normalized = normalizeClassroomInput(value);
  if (!normalized) return 'acknowledgement';
  if (STOP_INPUTS.has(normalized)) return 'stop';
  if (ACK_INPUTS.has(normalized)) return 'acknowledgement';
  if (CONFUSION_CUES.some((cue) => normalized.includes(cue))) return 'confusion';
  return 'question';
}

export function getLatestUserInput(request: StatelessChatRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message.role !== 'user') continue;
    const text = messageText(message);
    if (text) return text;
  }
  return '';
}

function getPreviousQuestion(request: StatelessChatRequest, currentInput: string): string | null {
  let skippedCurrent = false;
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message.role !== 'user') continue;
    const text = messageText(message);
    if (!text) continue;
    if (!skippedCurrent && text === currentInput) {
      skippedCurrent = true;
      continue;
    }
    if (classifyClassroomInput(text) === 'question') return text;
  }
  return null;
}

function extractKeywordCandidates(query: string): string[] {
  const candidates: string[] = [];
  const cleaned = query
    .replace(/[\u3000\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a!?,.;:\s]+/g, ' ')
    .trim();
  const patterns = [
    /(?:\u4ec0\u4e48\u662f|\u4e3a\u4ec0\u4e48|\u8bf7\u89e3\u91ca|\u5982\u4f55)([^ ]{2,24})/,
    /([^ ]{2,24})(?:\u662f\u4ec0\u4e48|\u6709\u4ec0\u4e48|\u600e\u4e48\u7406\u89e3|\u600e\u4e48\u56de\u4e8b)/,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      candidates.push(match[1].replace(/[\u7684\u5462\u5417\u554a]$/g, ''));
    }
  }

  // Cheap deterministic fallback: split common question/connective words so
  // a sentence such as "why does the body affect intelligence" can still
  // retrieve entities matching "body" or "intelligence".
  const topicTokens = cleaned
    .replace(/(?:\u4e3a\u4ec0\u4e48|\u4ec0\u4e48\u662f|\u8bf7\u89e3\u91ca|\u600e\u4e48\u7406\u89e3|\u5982\u4f55|\u600e\u4e48\u56de\u4e8b)/g, ' ')
    .replace(/(?:\u4f1a\u5f71\u54cd|\u6709\u4ec0\u4e48|\u6709\u54ea\u4e9b|\u662f\u5982\u4f55|\u662f\u600e\u6837|\u4f1a\u4e0d\u4f1a|\u80fd\u4e0d\u80fd|\u662f\u5426|\u533a\u522b|\u5173\u7cfb|\u76f8\u6bd4|\u5bf9\u6bd4|\u4ee5\u53ca|\u4e4b\u95f4|\u548c|\u4e0e|\u8ddf|\u53ca)/g, ' ')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 12);
  candidates.push(...topicTokens);

  return Array.from(new Set(candidates));
}

function buildKeywordCandidates(request: StatelessChatRequest, query: string): string[] {
  const currentScene = request.storeState.currentSceneId
    ? request.storeState.scenes.find((scene) => scene.id === request.storeState.currentSceneId)
    : undefined;
  return Array.from(
    new Set(
      [currentScene?.title, ...extractKeywordCandidates(query)]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value && value.length >= 2)),
    ),
  ).slice(0, 8);
}

async function fetchKnowledgeContext(
  request: StatelessChatRequest,
  query: string,
  signal?: AbortSignal,
): Promise<ClassroomKnowledgeContext> {
  const backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  try {
    const response = await fetch(`${backendUrl}/api/knowledge/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        keywords: buildKeywordCandidates(request, query),
        max_citations: 3,
      }),
      signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as ClassroomKnowledgeContext;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return {
      query,
      chunks: [],
      citations: [],
      insufficient_evidence: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prepareClassroomTurn(
  request: StatelessChatRequest,
  mode: ClassroomMode,
  signal?: AbortSignal,
): Promise<PreparedClassroomTurn | null> {
  const startedAt = Date.now();
  const input = getLatestUserInput(request);
  if (!input) return null;

  const intent = classifyClassroomInput(input);
  const normalizedInput = normalizeClassroomInput(input);
  const selectedAgentId = mode === 'multi' && intent === 'confusion' ? 'default-2' : 'default-1';

  if (intent === 'stop' || intent === 'acknowledgement') {
    return {
      input,
      normalizedInput,
      intent,
      knowledgeQuery: null,
      knowledge: null,
      selectedAgentId: null,
      preparedAt: startedAt,
    };
  }

  const knowledgeQuery =
    intent === 'confusion' ? getPreviousQuestion(request, input) || input : input;
  const knowledge = await fetchKnowledgeContext(request, knowledgeQuery, signal);

  return {
    input,
    normalizedInput,
    intent,
    knowledgeQuery,
    knowledge,
    selectedAgentId,
    preparedAt: startedAt,
  };
}

export function buildClassroomEvidencePrompt(turn: PreparedClassroomTurn, agentId: string): string {
  const knowledge = turn.knowledge;
  const roleGuidance =
    agentId === 'default-2'
      ? '\u5b66\u751f\u521a\u624d\u8868\u793a\u6ca1\u6709\u542c\u61c2\u3002\u4f60\u662f AI \u52a9\u6559\uff0c\u8bf7\u6362\u4e00\u79cd\u66f4\u7b80\u5355\u7684\u8bf4\u6cd5\uff0c\u4f18\u5148\u7528\u4e00\u4e2a\u5177\u4f53\u4f8b\u5b50\uff0c\u4e0d\u8981\u91cd\u590d\u6559\u5e08\u4e0a\u4e00\u8f6e\u7684\u539f\u8bdd\u3002'
      : '\u4f60\u662f AI \u6559\u5e08\u3002\u8bf7\u76f4\u63a5\u56de\u7b54\u5b66\u751f\u5f53\u524d\u95ee\u9898\uff0c\u5148\u8bf4\u7ed3\u8bba\uff0c\u518d\u7528\u6559\u6750\u8bc1\u636e\u89e3\u91ca\uff0c\u907f\u514d\u7a7a\u6cdb\u5c55\u5f00\u3002';

  if (!knowledge || knowledge.insufficient_evidence || knowledge.chunks.length === 0) {
    return `\n\n# \u5f53\u524d\u8bfe\u5802\u56de\u7b54\u8981\u6c42\n${roleGuidance}\n\u672a\u68c0\u7d22\u5230\u8db3\u591f\u7684\u6559\u6750\u8bc1\u636e\u3002\u8bf7\u660e\u786e\u8bf4\u660e\u8bc1\u636e\u4e0d\u8db3\uff0c\u53ef\u4ee5\u7ed9\u51fa\u8c28\u614e\u7684\u4e00\u822c\u6027\u89e3\u91ca\uff0c\u4f46\u4e0d\u8981\u4f2a\u9020\u6559\u6750\u5f15\u7528\u3002`;
  }

  const evidence = knowledge.chunks
    .map((chunk, index) => {
      const label = `${chunk.chapter_title} ${chunk.section_number} ${chunk.section_title}`.trim();
      return `[\u8bc1\u636e${index + 1}\uff1a${label}]\n${chunk.content}`;
    })
    .join('\n\n');

  const citationLabels = knowledge.citations
    .map((citation) =>
      `${citation.chapter_title} ${citation.section_number} ${citation.section_title}`.trim(),
    )
    .filter(Boolean)
    .join('\uff1b');

  return `\n\n# \u5f53\u524d\u8bfe\u5802\u56de\u7b54\u8981\u6c42\n${roleGuidance}\n\u53ea\u80fd\u628a\u4e0b\u5217\u7247\u6bb5\u5f53\u4f5c\u6559\u6750\u4f9d\u636e\u3002\u5f15\u7528\u65f6\u8bf7\u4f7f\u7528\u201c\u6839\u636e\u300a\u5177\u8eab\u667a\u80fd\u5bfc\u8bba\u300bX\u7ae0X\u8282\u201d\u8fd9\u7c7b\u81ea\u7136\u8868\u8ff0\uff0c\u4e0d\u8981\u7f16\u9020\u7ae0\u8282\u3002\n\n# \u6559\u6750\u8bc1\u636e\n${evidence}\n\n# \u53ef\u5f15\u7528\u4f4d\u7f6e\n${citationLabels || '\u672a\u63d0\u4f9b\u7ae0\u8282\u6807\u7b7e'}`;
}
