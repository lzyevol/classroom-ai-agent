'use client';

import { useState } from 'react';
import {
  BookText,
  ChevronDown,
  CircleCheck,
  Loader2,
  Pencil,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  type BankQuestion,
} from './question-types';

interface QuestionCardProps {
  readonly question: BankQuestion;
  readonly index: number;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onRegenerate: () => void;
  readonly onArchive: () => void;
}

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  hard: 'bg-rose-50 text-rose-700 border-rose-100',
};

const TYPE_STYLES: Record<string, string> = {
  single_choice: 'bg-violet-50 text-violet-700 border-violet-100',
  true_false: 'bg-sky-50 text-sky-700 border-sky-100',
  short_answer: 'bg-indigo-50 text-indigo-700 border-indigo-100',
};

/** Option letters are what the grader stores for single choice. */
function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

function Tag({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${className}`}>
      {children}
    </span>
  );
}

export function QuestionCard({
  question,
  index,
  busy,
  onEdit,
  onRegenerate,
  onArchive,
}: QuestionCardProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const archived = question.status !== 'active';

  return (
    <li
      className={`rounded-2xl border p-5 transition ${
        archived ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
            {index + 1}
          </span>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Tag className={TYPE_STYLES[question.type] ?? ''}>
                {QUESTION_TYPE_LABELS[question.type]}
              </Tag>
              <Tag className={DIFFICULTY_STYLES[question.difficulty] ?? ''}>
                {DIFFICULTY_LABELS[question.difficulty]}
              </Tag>
              {question.knowledge_point && (
                <Tag className="border-slate-200 bg-slate-50 text-slate-600">
                  {question.knowledge_point}
                </Tag>
              )}
              {question.replaced_from && (
                <Tag className="border-violet-100 bg-violet-50 text-violet-600">
                  已替换旧题
                </Tag>
              )}
              {archived && (
                <Tag className="border-slate-300 bg-slate-200 text-slate-600">已废弃</Tag>
              )}
            </div>
            <p className="text-sm font-bold leading-relaxed text-slate-800">
              {question.stem}
            </p>
          </div>
        </div>

        {!archived && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              title="编辑本题"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-violet-600 disabled:opacity-40"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={busy}
              title="重新出一题（同一知识点）"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onArchive}
              disabled={busy}
              title="废弃本题"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3 pl-10">
        {question.type === 'single_choice' && question.options.length > 0 && (
          <ul className="space-y-1.5">
            {question.options.map((option, optionIndex) => {
              const correct = question.correct_answer === letterOf(optionIndex);
              return (
                <li
                  key={optionIndex}
                  className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                    correct
                      ? 'bg-emerald-50 font-bold text-emerald-800'
                      : 'text-slate-600'
                  }`}
                >
                  {correct ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <span className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span className="font-mono text-xs text-slate-400">
                    {letterOf(optionIndex)}
                  </span>
                  <span>{option}</span>
                </li>
              );
            })}
          </ul>
        )}

        {question.type === 'true_false' && (
          <div className="flex gap-2">
            {[true, false].map((value) => {
              const correct = question.correct_answer === value;
              return (
                <span
                  key={String(value)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                    correct
                      ? 'bg-emerald-50 font-bold text-emerald-800'
                      : 'bg-slate-50 text-slate-500'
                  }`}
                >
                  {correct && <CircleCheck className="h-4 w-4 text-emerald-600" />}
                  {value ? '正确' : '错误'}
                </span>
              );
            })}
          </div>
        )}

        {question.type === 'short_answer' && (
          <div className="space-y-2">
            <div className="rounded-xl bg-emerald-50/60 p-3">
              <div className="mb-1 text-[11px] font-bold text-emerald-700">参考答案</div>
              <p className="text-sm leading-relaxed text-slate-700">
                {String(question.correct_answer ?? '')}
              </p>
            </div>
            {question.rubric.length > 0 && (
              <div className="rounded-xl border border-slate-100 p-3">
                <div className="mb-2 text-[11px] font-bold text-slate-500">
                  评分点（权重合计 1.0）
                </div>
                <ul className="space-y-1">
                  {question.rubric.map((item, rubricIndex) => (
                    <li
                      key={rubricIndex}
                      className="flex items-start justify-between gap-3 text-sm text-slate-600"
                    >
                      <span>{item.point}</span>
                      <span className="shrink-0 font-mono text-xs text-slate-400">
                        {item.weight.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {question.analysis && (
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="mb-1 text-[11px] font-bold text-slate-500">解析</div>
            <p className="text-sm leading-relaxed text-slate-600">{question.analysis}</p>
          </div>
        )}

        {question.citation?.quote && (
          <div>
            <button
              type="button"
              onClick={() => setSourceOpen((prev) => !prev)}
              aria-expanded={sourceOpen}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-400 transition hover:text-violet-600"
            >
              <BookText className="h-3.5 w-3.5" />
              教材依据
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${sourceOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {sourceOpen && (
              <blockquote className="mt-2 rounded-xl border-l-2 border-violet-200 bg-violet-50/40 p-3 text-xs leading-relaxed text-slate-600">
                {question.citation.quote}
                <footer className="mt-2 text-slate-400">
                  {question.citation.section_number} {question.citation.section_title}
                  {question.source_chunk_id && ` · ${question.source_chunk_id}`}
                </footer>
              </blockquote>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
