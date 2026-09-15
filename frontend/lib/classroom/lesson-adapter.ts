import type { LessonData, Slide as LessonSlide } from '@/app/lesson/types';
import type { Scene, Stage, QuizQuestion } from '@/lib/types/stage';
import type {
  Action,
  DiscussionAction,
  SpeechAction,
  WbDrawLineAction,
  WbDrawTextAction,
} from '@/lib/types/action';
import type {
  PPTElement,
  PPTImageElement,
  PPTShapeElement,
  PPTTextElement,
  Slide as CanvasSlide,
} from '@/lib/types/slides';
import { db } from '@/lib/utils/database';
import { renderLatexInHtml, renderLatexText } from '@/lib/utils/render-latex';

const CANVAS_WIDTH = 1000;
const FONT = 'Microsoft YaHei';
const PRIMARY = '#243f8f';
const PURPLE = '#8b5cf6';

export interface LessonTTSSettings {
  ttsProvider: 'qwen' | 'edge' | 'browser';
  ttsVoice: string;
  ttsSpeed: number;
}

export interface LessonClassroomBundle {
  stage: Stage;
  scenes: Scene[];
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip markup but keep the generator's clickable concept spans.
 *
 * Bullets carry `<span class="entity" data-q="...">概念</span>`, which the
 * classroom canvas turns into a question. Only the class and data-q attributes
 * survive, so unexpected markup cannot reach the slide renderer.
 */
function textWithEntities(value: string): string {
  const ENTITY_TAG =
    /<span\b[^>]*\bclass\s*=\s*["'][^"']*\bentity\b[^"']*["'][^>]*>(.*?)<\/span>/gi;
  // Private-use code points cannot occur in textbook content, so these markers
  // survive plainText() without colliding with digits in the real text.
  const OPEN = '\uE000';
  const CLOSE = '\uE001';
  const rebuilt: string[] = [];

  const withMarkers = value.replace(ENTITY_TAG, (tag, inner: string) => {
    const label = plainText(inner);
    if (!label) return '';
    const question = /\bdata-q\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    rebuilt.push(
      `<span class="entity"${question ? ` data-q="${escapeHtml(question)}"` : ''}>${label}</span>`,
    );
    return `${OPEN}${rebuilt.length - 1}${CLOSE}`;
  });

  // The result is injected without escaping, so escape everything outside the
  // rebuilt spans before putting them back.
  return escapeHtml(plainText(withMarkers)).replace(
    new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'),
    (_, index: string) => rebuilt[Number(index)] ?? '',
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function richParagraphs(
  lines: string[],
  options: {
    size: number;
    color: string;
    weight?: number;
    align?: string;
    /** Keep clickable `.entity` concept spans; only bullets should set this. */
    keepEntities?: boolean;
  },
): string {
  const { size, color, weight = 400, align = 'left', keepEntities = false } = options;
  // renderLatexText escapes HTML, which would turn entity spans into literal
  // text; renderLatexInHtml keeps existing markup and only rewrites formulas.
  const render = keepEntities
    ? (line: string) => renderLatexInHtml(textWithEntities(line))
    : (line: string) => renderLatexText(plainText(line));
  return lines
    .filter(Boolean)
    .map(
      (line) =>
        `<p style="font-size:${size}px;color:${color};font-weight:${weight};text-align:${align};margin:0 0 10px 0;">${render(line)}</p>`,
    )
    .join('');
}

function textElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  content: string,
  color = '#333333',
  extra: Partial<PPTTextElement> = {},
): PPTTextElement {
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    rotate: 0,
    content,
    defaultFontName: FONT,
    defaultColor: color,
    lineHeight: 1.45,
    paragraphSpace: 4,
    ...extra,
  };
}

function shapeElement(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
  outline?: PPTShapeElement['outline'],
): PPTShapeElement {
  return {
    id,
    type: 'shape',
    left,
    top,
    width,
    height,
    rotate: 0,
    viewBox: [1000, 1000],
    path: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
    fixedRatio: false,
    fill,
    outline,
  };
}

function imageElement(
  id: string,
  src: string,
  left: number,
  top: number,
  width: number,
  height: number,
): PPTImageElement {
  return {
    id,
    type: 'image',
    left,
    top,
    width,
    height,
    rotate: 0,
    fixedRatio: true,
    src: src.startsWith('/') ? `/backend${src}` : src,
    radius: 12,
    shadow: { h: 0, v: 6, blur: 12, color: '#00000022' },
  };
}

function buildCanvas(slide: LessonSlide, index: number): CanvasSlide {
  const elements: PPTElement[] = [];
  const titleId = `slide-${slide.slide_id}-title`;
  const bodyId = `slide-${slide.slide_id}-body`;

  elements.push(shapeElement(`slide-${slide.slide_id}-accent`, 0, 0, CANVAS_WIDTH, 12, PRIMARY));
  elements.push(
    textElement(
      titleId,
      64,
      48,
      760,
      72,
      richParagraphs([slide.title], { size: 32, color: PRIMARY, weight: 700 }),
      PRIMARY,
      { textType: 'title' },
    ),
  );
  if (slide.subtitle) {
    elements.push(
      textElement(
        `slide-${slide.slide_id}-subtitle`,
        68,
        118,
        760,
        42,
        richParagraphs([slide.subtitle], { size: 17, color: '#64748b' }),
        '#64748b',
        { textType: 'subtitle' },
      ),
    );
  }

  const bodyLines = slide.bullets.length
    ? slide.bullets.map((bullet) => `• ${bullet}`)
    : [slide.narration.slice(0, 260)];
  elements.push(
    textElement(
      bodyId,
      72,
      182,
      slide.image ? 510 : 850,
      slide.quote ? 220 : 282,
      richParagraphs(bodyLines, {
        size: 20,
        color: '#334155',
        // Only bullets carry the generator's clickable concept markers.
        keepEntities: slide.bullets.length > 0,
      }),
      '#334155',
      { textType: 'content' },
    ),
  );

  if (slide.quote) {
    elements.push(
      shapeElement(`slide-${slide.slide_id}-quote-bg`, 66, 406, 560, 96, '#f5f3ff', {
        color: '#c4b5fd',
        width: 1,
        style: 'solid',
      }),
    );
    elements.push(
      textElement(
        `slide-${slide.slide_id}-quote`,
        84,
        420,
        524,
        68,
        richParagraphs([slide.quote], { size: 14, color: '#5b21b6' }),
        '#5b21b6',
        { textType: 'notes' },
      ),
    );
  }

  if (slide.compare?.length) {
    const cardWidth = 260;
    slide.compare.slice(0, 2).forEach((item, compareIndex) => {
      const left = 72 + compareIndex * (cardWidth + 20);
      elements.push(
        shapeElement(
          `slide-${slide.slide_id}-compare-bg-${compareIndex}`,
          left,
          400,
          cardWidth,
          112,
          compareIndex === 0 ? '#fff7ed' : '#f5f3ff',
          { color: compareIndex === 0 ? '#f59e0b' : '#8b5cf6', width: 2, style: 'solid' },
        ),
      );
      elements.push(
        textElement(
          `slide-${slide.slide_id}-compare-${compareIndex}`,
          left + 16,
          414,
          cardWidth - 32,
          88,
          richParagraphs([item.name, item.desc], {
            size: 15,
            color: compareIndex === 0 ? '#92400e' : '#5b21b6',
            weight: 600,
          }),
          compareIndex === 0 ? '#92400e' : '#5b21b6',
        ),
      );
    });
  }

  if (slide.image) {
    elements.push(
      imageElement(`slide-${slide.slide_id}-image`, slide.image.src, 610, 182, 330, 250),
    );
    if (slide.image.caption) {
      elements.push(
        textElement(
          `slide-${slide.slide_id}-image-caption`,
          610,
          440,
          330,
          58,
          richParagraphs([slide.image.caption], { size: 12, color: '#64748b', align: 'center' }),
          '#64748b',
        ),
      );
    }
  }

  elements.push(
    textElement(
      `slide-${slide.slide_id}-cite`,
      68,
      526,
      780,
      28,
      richParagraphs([slide.cite || '教材依据'], { size: 11, color: '#94a3b8' }),
      '#94a3b8',
      { textType: 'footer' },
    ),
  );
  elements.push(
    textElement(
      `slide-${slide.slide_id}-number`,
      870,
      48,
      70,
      42,
      richParagraphs([String(index + 1).padStart(2, '0')], {
        size: 30,
        color: '#e2e8f0',
        weight: 800,
        align: 'right',
      }),
      '#e2e8f0',
    ),
  );

  return {
    id: `canvas-${slide.slide_id}`,
    viewportSize: CANVAS_WIDTH,
    viewportRatio: 16 / 9,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: [PRIMARY, PURPLE, '#f59e0b', '#10b981', '#64748b'],
      fontColor: '#334155',
      fontName: FONT,
    },
    elements,
    type: index === 0 ? 'cover' : 'content',
  };
}

function buildQuizScene(stageId: string, slide: LessonSlide, order: number): Scene | null {
  if (!slide.quiz) return null;
  const options = slide.quiz.opts.map((label, index) => ({
    label,
    value: String.fromCharCode(65 + index),
  }));
  const question: QuizQuestion = {
    id: `quiz-${slide.slide_id}`,
    type: 'single',
    question: slide.quiz.stem,
    options,
    answer: [String.fromCharCode(65 + slide.quiz.answer)],
    analysis: slide.quiz.pass,
    points: 1,
  };
  return {
    id: `scene-${slide.slide_id}-quiz`,
    stageId,
    type: 'quiz',
    title: `课中小测 · ${slide.title}`,
    order,
    content: { type: 'quiz', questions: [question] },
    actions: [
      {
        id: `quiz-speech-${slide.slide_id}`,
        type: 'speech',
        text: `现在做一个小测，检验一下对“${slide.title}”的理解。`,
      } satisfies SpeechAction,
    ],
    multiAgent: {
      enabled: true,
      agentIds: ['default-1', 'default-2', 'default-3'],
    },
  };
}

function buildActions(slide: LessonSlide, index: number, total: number): Action[] {
  const actions: Action[] = [];
  if (slide.narration) {
    actions.push({
      id: `speech-${slide.slide_id}`,
      type: 'speech',
      // Entity markup belongs in slide bullets; captions and TTS need plain text.
      text: plainText(slide.narration),
    } satisfies SpeechAction);
  }
  actions.push({
    id: `spotlight-${slide.slide_id}`,
    type: 'spotlight',
    elementId: `slide-${slide.slide_id}-title`,
    dimOpacity: 0.35,
  });

  // Demonstrate the same AI whiteboard flow used by OpenMAIC on the opening page.
  if (index === 0 && slide.bullets.length > 0) {
    actions.push({ id: `wb-open-${slide.slide_id}`, type: 'wb_open' });
    actions.push({ id: `wb-clear-${slide.slide_id}`, type: 'wb_clear' });
    actions.push({
      id: `wb-text-${slide.slide_id}`,
      type: 'wb_draw_text',
      content: richParagraphs([slide.title, ...slide.bullets.slice(0, 3)], {
        size: 22,
        color: '#1e293b',
        weight: 600,
      }),
      x: 80,
      y: 90,
      width: 840,
      height: 300,
      fontSize: 22,
      color: '#1e293b',
    } satisfies WbDrawTextAction);
    actions.push({
      id: `wb-line-${slide.slide_id}`,
      type: 'wb_draw_line',
      startX: 80,
      startY: 410,
      endX: 900,
      endY: 410,
      color: PURPLE,
      width: 4,
      points: ['', 'arrow'],
    } satisfies WbDrawLineAction);
    actions.push({ id: `wb-close-${slide.slide_id}`, type: 'wb_close' });
  }

  // Keep the proactive discussion cadence readable: opening and closing checks.
  if (index === 0 || index === total - 1) {
    actions.push({
      id: `discussion-${slide.slide_id}`,
      type: 'discussion',
      topic: slide.title,
      prompt: `请结合刚才的教材内容，和同学们讨论一下“${slide.title}”的核心含义和实际例子。`,
      agentId: 'default-3',
    } satisfies DiscussionAction);
  }
  return actions;
}

export function buildLessonClassroom(lesson: LessonData): LessonClassroomBundle {
  const stageId = `lesson-${encodeURIComponent(lesson.section_key).replace(/%/g, '_')}`;
  const now = Date.now();
  const stage: Stage = {
    id: stageId,
    name: lesson.section_title || lesson.chapter_title || '课程课堂',
    description: `${lesson.chapter_title} · ${lesson.section_title}`,
    language: 'zh-CN',
    style: 'professional',
    createdAt: now,
    updatedAt: now,
  };

  const scenes: Scene[] = [];
  lesson.slides.forEach((slide, index) => {
    scenes.push({
      id: `scene-${slide.slide_id}`,
      stageId,
      type: 'slide',
      title: slide.title,
      order: index + 1,
      content: { type: 'slide', canvas: buildCanvas(slide, index) },
      actions: buildActions(slide, index, lesson.slides.length),
      multiAgent: {
        enabled: true,
        agentIds: ['default-1', 'default-2', 'default-3'],
      },
    });
    const quizScene = buildQuizScene(stageId, slide, index + 1.5);
    if (quizScene) scenes.push(quizScene);
  });

  return { stage, scenes };
}

/** Concurrent synthesis requests; Edge TTS throttles beyond a handful. */
const AUDIO_CONCURRENCY = 4;

interface ResolvedAudio {
  key: string;
  cached: boolean;
}

/**
 * Ask the backend for each narration's shared cache key.
 *
 * Returns null when the endpoint is unavailable so callers can fall back to
 * plain per-request synthesis.
 */
async function resolveAudioKeys(
  texts: string[],
  settings: LessonTTSSettings,
  rate: number,
): Promise<ResolvedAudio[] | null> {
  try {
    const response = await fetch('/backend/api/tts/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.ttsProvider,
        voice: settings.ttsVoice,
        rate,
        texts,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: ResolvedAudio[] };
    return body.items ?? null;
  } catch {
    return null;
  }
}

async function storeAudio(audioId: string, response: Response, text: string, voice: string) {
  await db.audioFiles.put({
    id: audioId,
    blob: await response.blob(),
    format: response.headers.get('content-type')?.includes('mpeg') ? 'mp3' : 'wav',
    text,
    voice,
    createdAt: Date.now(),
  });
}

/**
 * Ensure every narration has playable audio before the classroom opens.
 *
 * Audio is cached server-side by content hash, so a narration another student
 * already played downloads instead of being synthesized again. Requests run a
 * few at a time because synthesis dominates the wait on a cold cache.
 */
export async function prepareLessonAudio(
  scenes: Scene[],
  settings: LessonTTSSettings,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const speechActions = scenes.flatMap((scene) =>
    (scene.actions || []).filter(
      (action): action is SpeechAction => action.type === 'speech' && Boolean(action.text),
    ),
  );
  if (settings.ttsProvider === 'browser' || speechActions.length === 0) return;

  const rate = Math.round((settings.ttsSpeed - 1) * 500);
  const resolved = await resolveAudioKeys(
    speechActions.map((action) => action.text),
    settings,
    rate,
  );

  let completed = 0;
  const total = speechActions.length;
  const report = () => onProgress?.((completed += 1), total);

  const prepareOne = async (action: SpeechAction, index: number) => {
    const entry = resolved?.[index];
    // Include the rate: the previous key omitted it, so changing playback speed
    // kept replaying audio at the old speed.
    const audioId = entry
      ? `tts-${entry.key}`
      : `lesson-${action.id}-${settings.ttsProvider}-${settings.ttsVoice}-${rate}`;
    action.audioId = audioId;

    if (await db.audioFiles.get(audioId)) {
      report();
      return;
    }

    try {
      // A shared cache hit is a plain download and needs no synthesis.
      if (entry?.cached) {
        const cached = await fetch(`/backend/api/tts/cached/${entry.key}`);
        if (cached.ok) {
          await storeAudio(audioId, cached, action.text, settings.ttsVoice);
          report();
          return;
        }
      }

      const response = await fetch('/backend/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.ttsProvider,
          text: action.text,
          voice: settings.ttsVoice,
          rate,
        }),
      });
      if (response.ok) {
        await storeAudio(audioId, response, action.text, settings.ttsVoice);
      } else {
        // Leaving audioId set would make the player wait for audio that never
        // arrives; without it the scene falls back to browser speech.
        delete action.audioId;
      }
    } catch {
      delete action.audioId;
    }
    report();
  };

  const queue = speechActions.map((action, index) => ({ action, index }));
  await Promise.all(
    Array.from({ length: Math.min(AUDIO_CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await prepareOne(item.action, item.index);
      }
    }),
  );
}
