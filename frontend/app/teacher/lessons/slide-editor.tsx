'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Slide, SlideQuiz } from '../../lesson/types';
import { SLIDE_FORM_ID, fieldId } from './slide-fields';

interface SlideEditorProps {
  readonly slide: Slide;
  /** Fires on every keystroke so the caller can render a live preview. */
  readonly onDraftChange?: (draft: Slide) => void;
  readonly onSave: (slide: Slide) => void;
}

const EMPTY_QUIZ: SlideQuiz = {
  stem: '',
  opts: ['', '', '', ''],
  answer: 0,
  pass: '回答正确！',
  fail: '再想想。',
};

const fieldClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-bold text-slate-600"
    >
      {children}
    </label>
  );
}

export function SlideEditor({ slide, onDraftChange, onSave }: SlideEditorProps) {
  const [draft, setDraft] = useState<Slide>(slide);

  // Reset when the teacher switches to a different slide.
  useEffect(() => {
    setDraft(slide);
  }, [slide]);

  useEffect(() => {
    onDraftChange?.(draft);
    // onDraftChange is a stable callback from the parent; excluded on purpose
    // so a fresh inline arrow does not retrigger this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const patch = <K extends keyof Slide>(key: K, value: Slide[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const patchQuiz = <K extends keyof SlideQuiz>(key: K, value: SlideQuiz[K]) =>
    setDraft((prev) => ({
      ...prev,
      quiz: { ...(prev.quiz ?? EMPTY_QUIZ), [key]: value },
    }));

  const updateBullet = (index: number, value: string) =>
    setDraft((prev) => ({
      ...prev,
      bullets: prev.bullets.map((b, i) => (i === index ? value : b)),
    }));

  const removeBullet = (index: number) =>
    setDraft((prev) => ({
      ...prev,
      bullets: prev.bullets.filter((_, i) => i !== index),
    }));

  const updateOption = (index: number, value: string) =>
    setDraft((prev) => {
      const quiz = prev.quiz ?? EMPTY_QUIZ;
      return {
        ...prev,
        quiz: { ...quiz, opts: quiz.opts.map((o, i) => (i === index ? value : o)) },
      };
    });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Drop blank bullets so an empty row never reaches the slide renderer.
    onSave({ ...draft, bullets: draft.bullets.filter((b) => b.trim().length > 0) });
  };

  return (
    <form id={SLIDE_FORM_ID} onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-2xl border border-violet-100 bg-violet-50/50 px-4 py-3 text-xs text-violet-700">
        要点中的 <code className="rounded bg-white px-1">&lt;span class=&quot;entity&quot;&gt;</code>{' '}
        标记会让概念在课堂上带下划线、可点击提问，<code className="rounded bg-white px-1">data-q</code>{' '}
        的内容就是学生点击后向 AI 提出的问题。删掉标记会失去这个入口，其他字段请使用纯文本。
      </div>

      <div>
        <Label htmlFor={fieldId.title}>标题</Label>
        <input
          id={fieldId.title}
          value={draft.title}
          onChange={(e) => patch('title', e.target.value)}
          className={fieldClass}
          required
        />
      </div>

      <div>
        <Label htmlFor={fieldId.subtitle}>副标题</Label>
        <input
          id={fieldId.subtitle}
          value={draft.subtitle}
          onChange={(e) => patch('subtitle', e.target.value)}
          className={fieldClass}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">要点</span>
          <button
            type="button"
            onClick={() => patch('bullets', [...draft.bullets, ''])}
            className="flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-700"
          >
            <Plus className="h-3.5 w-3.5" />
            添加要点
          </button>
        </div>
        <div className="space-y-2">
          {draft.bullets.map((bullet, index) => (
            <div key={index} className="flex gap-2">
              <textarea
                id={fieldId.bullet(index)}
                value={bullet}
                onChange={(e) => updateBullet(index, e.target.value)}
                rows={2}
                aria-label={`要点 ${index + 1}`}
                className={`${fieldClass} resize-y font-mono text-xs`}
              />
              <button
                type="button"
                onClick={() => removeBullet(index)}
                title="删除该要点"
                className="shrink-0 self-start rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {draft.bullets.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">
              暂无要点，点击上方“添加要点”
            </div>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor={fieldId.narration}>讲稿</Label>
        <textarea
          id={fieldId.narration}
          value={draft.narration}
          onChange={(e) => patch('narration', e.target.value)}
          rows={6}
          className={`${fieldClass} resize-y leading-relaxed`}
        />
      </div>

      <div>
        <Label htmlFor={fieldId.cite}>引用标注</Label>
        <input
          id={fieldId.cite}
          value={draft.cite}
          onChange={(e) => patch('cite', e.target.value)}
          className={fieldClass}
        />
      </div>

      <div>
        <Label htmlFor={fieldId.quote}>引言（可选）</Label>
        <input
          id={fieldId.quote}
          value={draft.quote ?? ''}
          onChange={(e) => patch('quote', e.target.value || null)}
          className={fieldClass}
        />
      </div>

      <div>
        <Label htmlFor={fieldId.imageSrc}>图片路径（可选）</Label>
        <input
          id={fieldId.imageSrc}
          value={draft.image?.src ?? ''}
          onChange={(e) =>
            patch(
              'image',
              e.target.value
                ? { src: e.target.value, caption: draft.image?.caption ?? '' }
                : null,
            )
          }
          placeholder="/static/images/page_0047/..."
          className={`${fieldClass} font-mono text-xs`}
        />
      </div>

      <div>
        <Label htmlFor={fieldId.imageCaption}>图片说明</Label>
        <input
          id={fieldId.imageCaption}
          value={draft.image?.caption ?? ''}
          onChange={(e) =>
            draft.image && patch('image', { ...draft.image, caption: e.target.value })
          }
          disabled={!draft.image}
          className={`${fieldClass} disabled:bg-slate-50 disabled:text-slate-400`}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">课中小测</span>
          {draft.quiz ? (
            <button
              type="button"
              onClick={() => patch('quiz', null)}
              className="text-xs font-bold text-slate-400 hover:text-red-600"
            >
              移除小测
            </button>
          ) : (
            <button
              type="button"
              onClick={() => patch('quiz', { ...EMPTY_QUIZ, opts: [...EMPTY_QUIZ.opts] })}
              className="flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-700"
            >
              <Plus className="h-3.5 w-3.5" />
              添加小测
            </button>
          )}
        </div>

        {draft.quiz && (
          <div className="space-y-3">
            <div>
              <Label htmlFor={fieldId.quizStem}>题干</Label>
              <textarea
                id={fieldId.quizStem}
                value={draft.quiz.stem}
                onChange={(e) => patchQuiz('stem', e.target.value)}
                rows={2}
                className={`${fieldClass} resize-y`}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-bold text-slate-600">
                选项（选中单选框标记正确答案）
              </span>
              <div className="space-y-2">
                {draft.quiz.opts.map((opt, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="quiz-answer"
                      checked={draft.quiz!.answer === index}
                      onChange={() => patchQuiz('answer', index)}
                      aria-label={`选项 ${index + 1} 为正确答案`}
                      className="h-4 w-4 shrink-0 accent-violet-600"
                    />
                    <input
                      id={fieldId.quizOption(index)}
                      value={opt}
                      onChange={(e) => updateOption(index, e.target.value)}
                      aria-label={`选项 ${index + 1}`}
                      className={fieldClass}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>答对反馈</Label>
                <input
                  value={draft.quiz.pass}
                  onChange={(e) => patchQuiz('pass', e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <Label>答错反馈</Label>
                <input
                  value={draft.quiz.fail}
                  onChange={(e) => patchQuiz('fail', e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
