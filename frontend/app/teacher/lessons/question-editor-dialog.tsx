'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  type BankQuestion,
  type Difficulty,
  type QuestionUpdatePayload,
  type RubricPoint,
} from './question-types';

interface QuestionEditorDialogProps {
  readonly question: BankQuestion;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSave: (payload: QuestionUpdatePayload) => void;
}

const fieldClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

interface Draft {
  stem: string;
  options: string[];
  /** Option index for single choice; ignored for other types. */
  answerIndex: number;
  answerBool: boolean;
  answerText: string;
  analysis: string;
  rubric: RubricPoint[];
  difficulty: Difficulty;
  knowledgePoint: string;
}

function toDraft(question: BankQuestion): Draft {
  const answer = question.correct_answer;
  // Single-choice answers are stored as letters, so map back to an index.
  const answerIndex =
    typeof answer === 'string' && answer.length === 1
      ? Math.max(answer.toUpperCase().charCodeAt(0) - 65, 0)
      : 0;
  return {
    stem: question.stem,
    options: [...question.options],
    answerIndex,
    answerBool: answer === true,
    answerText: typeof answer === 'string' ? answer : '',
    analysis: question.analysis,
    rubric: question.rubric.map((item) => ({ ...item })),
    difficulty: question.difficulty,
    knowledgePoint: question.knowledge_point,
  };
}

export function QuestionEditorDialog({
  question,
  saving,
  onClose,
  onSave,
}: QuestionEditorDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(question));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(question));

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm('有未保存的修改，确定要关闭吗？')) return;
    onClose();
  }, [dirty, saving, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [requestClose]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const rubricTotal = draft.rubric.reduce((sum, item) => sum + (item.weight || 0), 0);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: QuestionUpdatePayload = {
      stem: draft.stem.trim(),
      analysis: draft.analysis.trim(),
      difficulty: draft.difficulty,
      knowledge_point: draft.knowledgePoint.trim(),
    };

    if (question.type === 'single_choice') {
      const options = draft.options.map((o) => o.trim()).filter(Boolean);
      payload.options = options;
      // Send the letter the backend stores rather than the option text.
      payload.correct_answer = letterOf(Math.min(draft.answerIndex, options.length - 1));
    } else if (question.type === 'true_false') {
      payload.correct_answer = draft.answerBool;
    } else {
      payload.correct_answer = draft.answerText.trim();
      payload.rubric = draft.rubric
        .filter((item) => item.point.trim())
        .map((item) => ({ point: item.point.trim(), weight: item.weight || 0 }));
    }

    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/40 p-0 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="编辑题目"
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white shadow-2xl sm:rounded-3xl"
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-xs font-bold text-violet-600">
              {QUESTION_TYPE_LABELS[question.type]} · {question.knowledge_point || '未标注知识点'}
            </div>
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              编辑题目
              {dirty && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                  未保存
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              form="question-editor-form"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              保存修改
            </button>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              关闭
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <form
            id="question-editor-form"
            onSubmit={handleSubmit}
            className="mx-auto max-w-3xl space-y-5"
          >
            <div>
              <label
                htmlFor="q-stem"
                className="mb-1.5 block text-xs font-bold text-slate-600"
              >
                题干
              </label>
              <textarea
                id="q-stem"
                value={draft.stem}
                onChange={(e) => patch('stem', e.target.value)}
                rows={3}
                required
                className={`${fieldClass} resize-y leading-relaxed`}
              />
            </div>

            {question.type === 'single_choice' && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">
                    选项（选中单选框标记正确答案）
                  </span>
                  <button
                    type="button"
                    onClick={() => patch('options', [...draft.options, ''])}
                    disabled={draft.options.length >= 8}
                    className="flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-700 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加选项
                  </button>
                </div>
                <div className="space-y-2">
                  {draft.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="q-answer"
                        checked={draft.answerIndex === index}
                        onChange={() => patch('answerIndex', index)}
                        aria-label={`选项 ${letterOf(index)} 为正确答案`}
                        className="h-4 w-4 shrink-0 accent-violet-600"
                      />
                      <span className="w-4 shrink-0 font-mono text-xs text-slate-400">
                        {letterOf(index)}
                      </span>
                      <input
                        value={option}
                        onChange={(e) =>
                          patch(
                            'options',
                            draft.options.map((o, i) => (i === index ? e.target.value : o)),
                          )
                        }
                        aria-label={`选项 ${letterOf(index)}`}
                        className={fieldClass}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = draft.options.filter((_, i) => i !== index);
                          setDraft((prev) => ({
                            ...prev,
                            options: next,
                            // Keep the answer pointing at a option that still exists.
                            answerIndex: Math.min(prev.answerIndex, next.length - 1),
                          }));
                        }}
                        disabled={draft.options.length <= 2}
                        title={
                          draft.options.length <= 2 ? '至少保留 2 个选项' : '删除该选项'
                        }
                        className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {question.type === 'true_false' && (
              <div>
                <span className="mb-1.5 block text-xs font-bold text-slate-600">
                  正确答案
                </span>
                <div className="flex gap-2">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => patch('answerBool', value)}
                      className={`rounded-xl border px-5 py-2.5 text-sm font-bold transition ${
                        draft.answerBool === value
                          ? 'border-violet-300 bg-violet-50 text-violet-700'
                          : 'border-slate-200 text-slate-500 hover:border-violet-200'
                      }`}
                    >
                      {value ? '正确' : '错误'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {question.type === 'short_answer' && (
              <>
                <div>
                  <label
                    htmlFor="q-answer-text"
                    className="mb-1.5 block text-xs font-bold text-slate-600"
                  >
                    参考答案
                  </label>
                  <textarea
                    id="q-answer-text"
                    value={draft.answerText}
                    onChange={(e) => patch('answerText', e.target.value)}
                    rows={3}
                    required
                    className={`${fieldClass} resize-y leading-relaxed`}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">评分点</span>
                    <button
                      type="button"
                      onClick={() =>
                        patch('rubric', [...draft.rubric, { point: '', weight: 1 }])
                      }
                      disabled={draft.rubric.length >= 10}
                      className="flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-700 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      添加评分点
                    </button>
                  </div>
                  <p className="mb-3 text-[11px] text-slate-400">
                    AI 批改简答题时按这些点给分。权重可以直接填分值（如 3 和 1），保存时会自动折算成合计 1.0。
                  </p>

                  <div className="space-y-2">
                    {draft.rubric.map((item, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <textarea
                          value={item.point}
                          onChange={(e) =>
                            patch(
                              'rubric',
                              draft.rubric.map((r, i) =>
                                i === index ? { ...r, point: e.target.value } : r,
                              ),
                            )
                          }
                          rows={2}
                          aria-label={`评分点 ${index + 1}`}
                          placeholder="学生答案需要覆盖的要点"
                          className={`${fieldClass} resize-y`}
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={item.weight}
                          onChange={(e) =>
                            patch(
                              'rubric',
                              draft.rubric.map((r, i) =>
                                i === index
                                  ? { ...r, weight: Number(e.target.value) || 0 }
                                  : r,
                              ),
                            )
                          }
                          aria-label={`评分点 ${index + 1} 权重`}
                          className={`${fieldClass} w-20 shrink-0 self-start text-center`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            patch(
                              'rubric',
                              draft.rubric.filter((_, i) => i !== index),
                            )
                          }
                          title="删除该评分点"
                          className="shrink-0 self-start rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {draft.rubric.length === 0 && (
                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">
                        暂无评分点，AI 将只对照参考答案整体判分
                      </div>
                    )}
                  </div>

                  {draft.rubric.length > 0 && (
                    <div className="mt-3 text-[11px] text-slate-400">
                      当前权重合计 {rubricTotal.toFixed(2)}
                      {Math.abs(rubricTotal - 1) > 0.01 && ' · 保存时将按比例折算'}
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="q-analysis"
                className="mb-1.5 block text-xs font-bold text-slate-600"
              >
                解析
              </label>
              <textarea
                id="q-analysis"
                value={draft.analysis}
                onChange={(e) => patch('analysis', e.target.value)}
                rows={3}
                className={`${fieldClass} resize-y leading-relaxed`}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-xs font-bold text-slate-600">难度</span>
                <div className="flex gap-2">
                  {(['easy', 'medium', 'hard'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => patch('difficulty', level)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        draft.difficulty === level
                          ? 'border-violet-300 bg-violet-50 text-violet-700'
                          : 'border-slate-200 text-slate-500 hover:border-violet-200'
                      }`}
                    >
                      {DIFFICULTY_LABELS[level]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label
                  htmlFor="q-kp"
                  className="mb-1.5 block text-xs font-bold text-slate-600"
                >
                  知识点
                </label>
                <input
                  id="q-kp"
                  value={draft.knowledgePoint}
                  onChange={(e) => patch('knowledgePoint', e.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
