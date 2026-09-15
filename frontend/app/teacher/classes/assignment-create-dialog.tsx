'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { ClassSectionMastery } from '../types';

export interface AssignmentDraft {
  title: string;
  description: string;
  questionCount: number;
  dueAt: string;
}

interface AssignmentCreateDialogProps {
  readonly target: ClassSectionMastery;
  readonly creating: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (draft: AssignmentDraft) => Promise<void>;
}

export function AssignmentCreateDialog({
  target,
  creating,
  onClose,
  onSubmit,
}: AssignmentCreateDialogProps) {
  const maximum = Math.min(10, target.available_question_count);
  const [title, setTitle] = useState(
    () => `${target.section_number} ${target.section_title}\u5c0f\u8282\u7ec3\u4e60`,
  );
  const [description, setDescription] = useState(
    () =>
      `\u8bf7\u5b8c\u6210\u7b2c ${target.section_number} \u8282\u201c${target.section_title}\u201d\u7684\u7ec3\u4e60\uff0c\u5de9\u56fa\u672c\u8282\u6838\u5fc3\u5185\u5bb9\u3002`,
  );
  const [dueAt, setDueAt] = useState('');
  const [questionCount, setQuestionCount] = useState(() => Math.max(1, Math.min(3, maximum)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            title: title.trim(),
            description: description.trim(),
            questionCount,
            dueAt,
          });
        }}
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-600">
              {'\u6309\u7ae0\u8282\u5e03\u7f6e'}
            </div>
            <h2 className="mt-1 text-2xl font-black text-slate-900">
              {'\u5e03\u7f6e\u672c\u8282\u4f5c\u4e1a'}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {target.chapter_title} - {target.section_number} {target.section_title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
            aria-label={'\u5173\u95ed'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-black text-slate-500">{'\u4f5c\u4e1a\u6807\u9898'}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-500">{'\u4f5c\u4e1a\u8bf4\u660e'}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={500}
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="text-xs font-black text-slate-500">
                {'\u9898\u76ee\u6570\u91cf\uff08\u5f53\u524d\u53ef\u7528 '}
                {target.available_question_count}
                {' \u9898\uff09'}
              </span>
              <select
                value={questionCount}
                onChange={(event) => setQuestionCount(Number(event.target.value))}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
              >
                {Array.from({ length: maximum }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>
                    {count} {'\u9898'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-xs font-black text-slate-500">
                {'\u622a\u6b62\u65f6\u95f4\uff08\u53ef\u9009\uff09'}
              </span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
              />
            </label>
          </div>
          <div className="rounded-2xl bg-indigo-50 p-4 text-xs leading-6 text-indigo-700">
            {
              '\u53d1\u5e03\u65f6\u4f1a\u8bb0\u5f55\u5168\u73ed\u5f53\u524d\u5c0f\u8282\u638c\u63e1\u5ea6\u3002\u5b66\u751f\u63d0\u4ea4\u540e\uff0c\u7cfb\u7edf\u4f1a\u81ea\u52a8\u8ba1\u7b97\u672c\u8282\u5e72\u9884\u540e\u638c\u63e1\u5ea6\u548c\u63d0\u5347\u503c\u3002\u4f5c\u4e1a\u9ed8\u8ba4\u8986\u76d6\u672c\u5c0f\u8282\u5df2\u542f\u7528\u7684\u9898\u76ee\u3002'
            }
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-500"
          >
            {'\u53d6\u6d88'}
          </button>
          <button
            type="submit"
            disabled={creating || !title.trim() || maximum < 1}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            {'\u53d1\u5e03\u7ed9\u5168\u73ed'}
          </button>
        </div>
      </form>
    </div>
  );
}
