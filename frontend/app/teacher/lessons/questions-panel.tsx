'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useJob } from '@/lib/jobs/use-job';
import { QuestionCard } from './question-card';
import { QuestionEditorDialog } from './question-editor-dialog';
import {
  archiveQuestion,
  fetchSectionQuestions,
  queueQuestionGeneration,
  queueQuestionRegeneration,
  updateQuestion,
} from './question-admin-client';
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  type BankQuestion,
  type Difficulty,
  type QuestionGenerateResult,
  type QuestionType,
  type QuestionUpdatePayload,
} from './question-types';

interface QuestionsPanelProps {
  readonly sectionKey: string;
  readonly sectionLabel: string;
}

const ALL_TYPES: QuestionType[] = ['single_choice', 'true_false', 'short_answer'];

export function QuestionsPanel({ sectionKey, sectionLabel }: QuestionsPanelProps) {
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const [types, setTypes] = useState<QuestionType[]>(ALL_TYPES);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [count, setCount] = useState(5);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(
    async (includeArchived: boolean) => {
      setLoading(true);
      try {
        const page = await fetchSectionQuestions(sectionKey, { includeArchived });
        setQuestions(page.questions);
        setActiveCount(page.active_count);
        setArchivedCount(page.archived_count);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '题库加载失败');
      } finally {
        setLoading(false);
      }
    },
    [sectionKey],
  );

  useEffect(() => {
    setShowArchived(false);
    void load(false);
  }, [load]);

  const generation = useJob<QuestionGenerateResult>({
    onDone: (result) => {
      if (result.skipped_count > 0) {
        toast.success(
          `生成 ${result.generated_count} 题，入库 ${result.inserted_count} 题，${result.skipped_count} 题与已有题目重复被跳过`,
        );
      } else {
        toast.success(`已生成 ${result.inserted_count} 道题`);
      }
      void load(showArchived);
    },
    onFailed: (message) => toast.error(message),
  });

  const regeneration = useJob<BankQuestion>({
    onDone: () => {
      setPendingId(null);
      toast.success('已重新出题，原题已归档');
      void load(showArchived);
    },
    onFailed: (message) => {
      setPendingId(null);
      toast.error(message);
    },
  });

  const { track: trackGeneration, active: generating } = generation;
  const { track: trackRegeneration, active: regenerating } = regeneration;

  const handleGenerate = useCallback(async () => {
    if (generating || types.length === 0) return;
    try {
      const accepted = await queueQuestionGeneration(sectionKey, {
        question_types: types,
        difficulty,
        question_count: count,
      });
      trackGeneration(accepted.job_id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成任务创建失败');
    }
  }, [generating, types, sectionKey, difficulty, count, trackGeneration]);

  const handleRegenerate = useCallback(
    async (questionId: string) => {
      if (regenerating) return;
      setPendingId(questionId);
      try {
        const accepted = await queueQuestionRegeneration(questionId);
        trackRegeneration(accepted.job_id);
      } catch (error) {
        setPendingId(null);
        toast.error(error instanceof Error ? error.message : '重新出题失败');
      }
    },
    [regenerating, trackRegeneration],
  );

  const handleArchive = useCallback(
    async (question: BankQuestion) => {
      if (
        !window.confirm(
          '废弃后学生不会再抽到这道题，历史答题记录仍会保留。确定废弃吗？',
        )
      ) {
        return;
      }
      setPendingId(question.id);
      try {
        await archiveQuestion(question.id);
        toast.success('已废弃该题');
        await load(showArchived);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '废弃失败');
      } finally {
        setPendingId(null);
      }
    },
    [load, showArchived],
  );

  const handleSaveEdit = useCallback(
    async (payload: QuestionUpdatePayload) => {
      if (!editingId) return;
      setSavingEdit(true);
      try {
        const saved = await updateQuestion(editingId, payload);
        setQuestions((prev) => prev.map((q) => (q.id === saved.id ? saved : q)));
        setEditingId(null);
        toast.success('已保存');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存失败');
      } finally {
        setSavingEdit(false);
      }
    },
    [editingId],
  );

  const toggleType = (type: QuestionType) =>
    setTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );

  const editing = questions.find((q) => q.id === editingId) ?? null;
  const hasQuestions = questions.length > 0;

  return (
    <div className="mt-5">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1.5 block text-xs font-bold text-slate-600">题型</span>
            <div className="flex gap-1.5">
              {ALL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={types.includes(type)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    types.includes(type)
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-400 hover:border-violet-200'
                  }`}
                >
                  {QUESTION_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-bold text-slate-600">难度</span>
            <div className="flex gap-1.5">
              {(['easy', 'medium', 'hard'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDifficulty(level)}
                  aria-pressed={difficulty === level}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    difficulty === level
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-400 hover:border-violet-200'
                  }`}
                >
                  {DIFFICULTY_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="q-count"
              className="mb-1.5 block text-xs font-bold text-slate-600"
            >
              数量
            </label>
            <select
              id="q-count"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-violet-400"
            >
              {[1, 2, 3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} 题
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || types.length === 0}
            title={types.length === 0 ? '请至少选择一种题型' : undefined}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasQuestions ? (
              <Plus className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {hasQuestions ? '继续加题' : '生成题目'}
          </button>
        </div>

        {generating && (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 text-xs text-violet-700"
          >
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            {generation.status === 'pending'
              ? '任务已排队…'
              : `AI 正在为「${sectionLabel}」出题，约 30-60 秒。切换章节不会中断生成，回来刷新即可看到结果。`}
          </div>
        )}
        {generation.status === 'failed' && generation.error && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
            {generation.error}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">
            {activeCount} 道在用
            {archivedCount > 0 && ` · ${archivedCount} 道已废弃`}
          </span>
          <button
            type="button"
            onClick={() => void load(showArchived)}
            disabled={loading}
            title="刷新题库"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-violet-600 disabled:opacity-40"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => {
                setShowArchived(e.target.checked);
                void load(e.target.checked);
              }}
              className="h-3.5 w-3.5 accent-violet-600"
            />
            显示已废弃
          </label>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          加载题库
        </div>
      ) : hasQuestions ? (
        <ol className="mt-3 space-y-3">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              index={index}
              busy={pendingId === question.id}
              onEdit={() => setEditingId(question.id)}
              onRegenerate={() => void handleRegenerate(question.id)}
              onArchive={() => void handleArchive(question)}
            />
          ))}
        </ol>
      ) : (
        <div className="py-16 text-center">
          <p className="text-sm text-slate-400">该章节还没有题目</p>
          <p className="mt-1 text-xs text-slate-400">
            用上方的选项设置题型和难度，然后点“生成题目”
          </p>
        </div>
      )}

      {editing && (
        <QuestionEditorDialog
          key={editing.id}
          question={editing}
          saving={savingEdit}
          onClose={() => setEditingId(null)}
          onSave={(payload) => void handleSaveEdit(payload)}
        />
      )}
    </div>
  );
}
