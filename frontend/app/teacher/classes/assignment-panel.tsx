import { ClipboardList, Loader2, LockKeyhole, Trash2, UsersRound } from 'lucide-react';
import type { TeacherAssignmentSummary } from '../types';

interface AssignmentPanelProps {
  readonly assignments: TeacherAssignmentSummary[];
  readonly loading: boolean;
  readonly onClose: (assignmentId: string) => void;
  readonly onDelete: (assignment: TeacherAssignmentSummary) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '不设截止时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function metric(value: number | null, suffix = '%'): string {
  return value === null ? '--' : `${value}${suffix}`;
}

export function AssignmentPanel({ assignments, loading, onClose, onDelete }: AssignmentPanelProps) {
  const activeCount = assignments.filter((assignment) => assignment.status === 'active').length;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-violet-600" />
            <h2 className="text-xl font-black">{'\u7ae0\u8282\u4f5c\u4e1a\u7ba1\u7406'}</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {
              '\u6309\u7ae0\u8282\u5e03\u7f6e\u4f5c\u4e1a\uff0c\u81ea\u52a8\u56de\u6536\u5b8c\u6210\u7387\u548c\u5c0f\u8282\u638c\u63e1\u5ea6\u53d8\u5316'
            }
          </p>
        </div>
        <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-600">
          {activeCount} 项进行中
        </span>
      </div>

      {loading ? (
        <div className="flex min-h-32 items-center justify-center text-sm text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在加载教学任务
        </div>
      ) : assignments.length > 0 ? (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {assignments.map((assignment) => (
            <article key={assignment.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-black text-slate-800">{assignment.title}</h3>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {assignment.section_number} {assignment.section_title}
                    {assignment.knowledge_point ? ` · ${assignment.knowledge_point}` : ''}
                    {` · ${assignment.actual_question_count ?? assignment.question_count} 题`}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${assignment.status === 'active' ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500'}`}
                >
                  {assignment.status === 'active' ? '进行中' : '已关闭'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                <div className="rounded-xl bg-slate-50 p-2">
                  <div className="font-black">
                    {assignment.completed_students}/{assignment.total_students}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">已完成</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <div className="font-black">{assignment.completion_rate}%</div>
                  <div className="mt-1 text-[10px] text-slate-400">完成率</div>
                </div>
                <div className="rounded-xl bg-violet-50 p-2">
                  <div className="font-black text-violet-700">
                    {metric(assignment.average_practice_score)}
                  </div>
                  <div className="mt-1 text-[10px] text-violet-400">任务得分</div>
                </div>
                <div className="rounded-xl bg-indigo-50 p-2">
                  <div className="font-black text-indigo-700">{assignment.baseline_average}%</div>
                  <div className="mt-1 text-[10px] text-indigo-400">干预前</div>
                </div>
                <div className="rounded-xl bg-emerald-50 p-2">
                  <div className="font-black text-emerald-700">
                    {metric(assignment.post_average)}
                  </div>
                  <div className="mt-1 text-[10px] text-emerald-500">干预后</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <UsersRound className="h-3.5 w-3.5" />
                    截止：{formatDate(assignment.due_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-black ${(assignment.average_improvement ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}
                  >
                    平均变化{' '}
                    {assignment.average_improvement === null
                      ? '--'
                      : `${assignment.average_improvement > 0 ? '+' : ''}${assignment.average_improvement}`}
                  </span>
                  {assignment.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => onClose(assignment.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-amber-200 hover:text-amber-600"
                    >
                      <LockKeyhole className="h-3.5 w-3.5" />
                      关闭
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(assignment)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:border-red-200 hover:bg-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
          {
            '\u4ece\u4e0a\u65b9\u73ed\u7ea7\u7ae0\u8282\u638c\u63e1\u60c5\u51b5\u4e2d\u70b9\u51fb\u201c\u5e03\u7f6e\u672c\u8282\u4f5c\u4e1a\u201d\uff0c\u5373\u53ef\u542f\u52a8\u4e00\u6b21\u6559\u5b66\u5e72\u9884\u3002'
          }
        </div>
      )}
    </section>
  );
}
