'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  ChevronRight,
  GraduationCap,
  Loader2,
  LogOut,
  RefreshCcw,
  Search,
  School,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { fetchCurrentUser, logoutUser } from '@/lib/auth/auth-client';
import { Pagination } from '../../learning/pagination';
import {
  closeTeacherAssignment,
  createTeacherAssignment,
  deleteTeacherAssignment,
  fetchTeacherAssignments,
  fetchTeacherClasses,
  fetchTeacherStudentDetail,
  fetchTeacherStudents,
  fetchClassSectionMastery,
} from '../teacher-client';
import type {
  AssignmentCreateInput,
  TeacherAssignmentSummary,
  TeacherClassOverview,
  TeacherStudentDetail,
  TeacherStudentSummary,
  ClassSectionMastery,
} from '../types';
import { AssignmentCreateDialog, type AssignmentDraft } from './assignment-create-dialog';
import { AssignmentPanel } from './assignment-panel';

const CLASS_PAGE_SIZE = 6;
const STUDENT_PAGE_SIZE = 8;
const SECTION_PAGE_SIZE = 6;

function formatDate(value: string | null): string {
  if (!value) return '暂无活动';
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

function ScoreBar({ value, tone = 'violet' }: { value: number; tone?: 'violet' | 'amber' }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${tone === 'amber' ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-violet-500 to-indigo-600'}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function StudentDetailModal({
  detail,
  loading,
  onClose,
}: {
  detail: TeacherStudentDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">
              学生详情下钻
            </div>
            <h2 className="mt-1 text-2xl font-black text-slate-900">
              {detail?.student.display_name ?? '加载中'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {loading || !detail ? (
          <div className="flex h-72 items-center justify-center text-slate-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在聚合学生学情…
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-4">
              {[
                ['总体得分率', `${detail.student.overall_score_rate}%`],
                ['已学章节', detail.student.learned_sections],
                ['完成练习', detail.student.completed_practices],
                ['待复习错题', detail.student.mistake_count],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs font-bold text-slate-400">{label}</div>
                  <div className="mt-2 text-2xl font-black text-slate-800">{value}</div>
                </div>
              ))}
            </section>
            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 p-5">
                <h3 className="font-black text-slate-800">章节掌握度</h3>
                <div className="mt-4 space-y-4">
                  {detail.learning.section_mastery.slice(0, 6).map((item) => (
                    <div key={item.section_key}>
                      <div className="mb-2 flex justify-between gap-3 text-sm">
                        <span className="truncate text-slate-600">
                          {item.section_number} {item.section_title}
                        </span>
                        <b>{item.score_rate}%</b>
                      </div>
                      <ScoreBar value={item.score_rate} />
                    </div>
                  ))}
                  {detail.learning.section_mastery.length === 0 && (
                    <p className="text-sm text-slate-400">暂无章节练习数据</p>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-5">
                <h3 className="font-black text-slate-800">需要关注的知识点</h3>
                <div className="mt-4 space-y-3">
                  {[...detail.learning.knowledge_mastery]
                    .sort((a, b) => a.score_rate - b.score_rate)
                    .slice(0, 6)
                    .map((item) => (
                      <div
                        key={`${item.section_key}-${item.knowledge_point}`}
                        className="rounded-xl bg-amber-50 p-3"
                      >
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="font-bold text-amber-900">{item.knowledge_point}</span>
                          <b className="text-amber-700">{item.score_rate}%</b>
                        </div>
                        <div className="mt-1 text-xs text-amber-700/70">
                          {item.section_number} {item.section_title} · {item.attempts} 次作答
                        </div>
                      </div>
                    ))}
                  {detail.learning.knowledge_mastery.length === 0 && (
                    <p className="text-sm text-slate-400">暂无知识点作答数据</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeacherPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classes, setClasses] = useState<TeacherClassOverview[]>([]);
  const [classTotal, setClassTotal] = useState(0);
  const [classPage, setClassPage] = useState(1);
  const [classSearchText, setClassSearchText] = useState('');
  const [classQuery, setClassQuery] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [students, setStudents] = useState<TeacherStudentSummary[]>([]);
  const [studentTotal, setStudentTotal] = useState(0);
  const [studentPage, setStudentPage] = useState(1);
  const [studentSearchText, setStudentSearchText] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [studentStatus, setStudentStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [sectionMastery, setSectionMastery] = useState<ClassSectionMastery[]>([]);
  const [sectionTotal, setSectionTotal] = useState(0);
  const [sectionPage, setSectionPage] = useState(1);
  const [loadingClassData, setLoadingClassData] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [studentDetail, setStudentDetail] = useState<TeacherStudentDetail | null>(null);
  const [assignments, setAssignments] = useState<TeacherAssignmentSummary[]>([]);
  const [assignmentTarget, setAssignmentTarget] = useState<ClassSectionMastery | null>(null);
  const [creatingAssignment, setCreatingAssignment] = useState(false);

  useEffect(() => {
    void fetchCurrentUser()
      .then((user) => {
        if (user.role !== 'teacher' && user.role !== 'admin') {
          toast.error('只有教师可以进入教师工作台');
          router.replace('/');
          return;
        }
        setReady(true);
      })
      .catch(() => undefined);
  }, [router]);

  const loadClasses = useCallback(async () => {
    if (!ready) return;
    setLoadingClasses(true);
    try {
      const result = await fetchTeacherClasses({
        q: classQuery,
        page: classPage,
        pageSize: CLASS_PAGE_SIZE,
      });
      setClasses(result.items);
      setClassTotal(result.total);
      setSelectedClassId((current) =>
        current && result.items.some((item) => item.id === current)
          ? current
          : (result.items[0]?.id ?? ''),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '班级列表加载失败');
    } finally {
      setLoadingClasses(false);
    }
  }, [classPage, classQuery, ready]);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  const loadClassData = useCallback(async () => {
    if (!selectedClassId) {
      setStudents([]);
      setSectionMastery([]);
      setSectionTotal(0);
      setAssignments([]);
      return;
    }
    setLoadingClassData(true);
    try {
      const [studentResult, assignmentResult, sectionResult] = await Promise.all([
        fetchTeacherStudents({
          classId: selectedClassId,
          q: studentQuery,
          status: studentStatus,
          page: studentPage,
          pageSize: STUDENT_PAGE_SIZE,
        }),
        fetchTeacherAssignments({ classId: selectedClassId, page: 1, pageSize: 20 }),
        fetchClassSectionMastery({
          classId: selectedClassId,
          page: sectionPage,
          pageSize: SECTION_PAGE_SIZE,
        }).catch(() => null),
      ]);
      setStudents(studentResult.items);
      setStudentTotal(studentResult.total);
      setAssignments(assignmentResult.items);
      setSectionMastery(sectionResult?.items ?? []);
      setSectionTotal(sectionResult?.total ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '班级学情加载失败');
    } finally {
      setLoadingClassData(false);
    }
  }, [selectedClassId, studentPage, studentQuery, studentStatus, sectionPage]);

  useEffect(() => {
    void loadClassData();
  }, [loadClassData]);

  const selectedClass = classes.find((item) => item.id === selectedClassId) ?? null;

  async function openStudent(student: TeacherStudentSummary) {
    if (!selectedClassId) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setStudentDetail(null);
    try {
      setStudentDetail(await fetchTeacherStudentDetail(selectedClassId, student.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '学生详情加载失败');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function publishAssignment(draft: AssignmentDraft) {
    if (!selectedClassId || !assignmentTarget) return;
    setCreatingAssignment(true);
    try {
      const payload: AssignmentCreateInput = {
        title: draft.title,
        description: draft.description,
        section_key: assignmentTarget.section_key,
        chapter_title: assignmentTarget.chapter_title,
        section_number: assignmentTarget.section_number,
        section_title: assignmentTarget.section_title,
        knowledge_point: '',
        difficulty: 'medium',
        question_types: ['single_choice', 'true_false'],
        question_count: draft.questionCount,
        due_at: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      };
      await createTeacherAssignment(selectedClassId, payload);
      toast.success(
        '\u5c0f\u8282\u4f5c\u4e1a\u5df2\u53d1\u5e03\uff0c\u5b66\u751f\u7aef\u5df2\u540c\u6b65',
      );
      setAssignmentTarget(null);
      await loadClassData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '教学任务发布失败');
    } finally {
      setCreatingAssignment(false);
    }
  }

  async function closeAssignment(assignmentId: string) {
    if (!selectedClassId) return;
    try {
      await closeTeacherAssignment(selectedClassId, assignmentId);
      toast.success('教学任务已关闭');
      await loadClassData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '教学任务关闭失败');
    }
  }

  async function removeAssignment(assignment: TeacherAssignmentSummary) {
    if (!selectedClassId) return;
    const confirmed = window.confirm(
      `确定删除“${assignment.title}”吗?\n\n学生端会立即移除该任务，已产生的练习记录仍会保留。`,
    );
    if (!confirmed) return;
    try {
      await deleteTeacherAssignment(selectedClassId, assignment.id);
      toast.success('教学任务已删除，学生端已移除');
      await loadClassData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '教学任务删除失败');
    }
  }

  if (!ready)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-lg shadow-indigo-200">
              <School className="h-5 w-5" />
            </div>
            <div>
              <div className="font-black">班级管理</div>
              <div className="text-xs text-slate-400">班级概览、学生下钻与薄弱知识点</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/teacher')}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:border-violet-200 hover:text-violet-600"
            >
              返回主页
            </button>
            <button
              type="button"
              onClick={() => void logoutUser()}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:border-red-200 hover:text-red-600"
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8">
        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black">负责班级</h2>
                <p className="mt-1 text-xs text-slate-400">只显示当前账号获授权的班级</p>
              </div>
              <School className="h-5 w-5 text-violet-600" />
            </div>
            <form
              className="relative mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                setClassPage(1);
                setClassQuery(classSearchText.trim());
              }}
            >
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={classSearchText}
                onChange={(e) => setClassSearchText(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
                placeholder="搜索班级"
              />
            </form>
            <div className="mt-4 space-y-2">
              {classes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedClassId(item.id);
                    setStudentPage(1);
                    setSectionPage(1);
                  }}
                  className={`w-full rounded-2xl border p-4 text-left transition ${selectedClassId === item.id ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-slate-100 hover:border-violet-200'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-800">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.course_name}</div>
                    </div>
                    <ChevronRight
                      className={`h-4 w-4 ${selectedClassId === item.id ? 'text-violet-600' : 'text-slate-300'}`}
                    />
                  </div>
                  <div className="mt-3 flex gap-3 text-xs text-slate-500">
                    <span>{item.student_count} 名学生</span>
                    <span>{item.average_score_rate}% 得分率</span>
                  </div>
                </button>
              ))}
              {loadingClasses && (
                <div className="py-8 text-center text-sm text-slate-400">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  加载班级
                </div>
              )}
              {!loadingClasses && classes.length === 0 && (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">
                  暂无负责班级
                </div>
              )}
            </div>
            <Pagination
              page={classPage}
              pageSize={CLASS_PAGE_SIZE}
              totalItems={classTotal}
              onPageChange={setClassPage}
            />
          </aside>

          <div className="min-w-0 space-y-6">
            {selectedClass ? (
              <>
                <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-700 via-violet-700 to-slate-950 p-7 text-white shadow-xl shadow-indigo-200/50">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <div className="text-sm font-bold text-indigo-200">
                        {selectedClass.course_name}
                      </div>
                      <h1 className="mt-1 text-3xl font-black">{selectedClass.name}</h1>
                      <p className="mt-2 text-sm text-indigo-100">
                        最近活动：{formatDate(selectedClass.last_activity_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void loadClasses();
                        void loadClassData();
                      }}
                      className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm font-bold hover:bg-white/25"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      刷新数据
                    </button>
                  </div>
                  <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/15 pt-5 lg:grid-cols-6">
                    {[
                      { label: '学生', value: selectedClass.student_count, icon: Users },
                      {
                        label: '启用账号',
                        value: selectedClass.active_student_count,
                        icon: UserCheck,
                      },
                      {
                        label: '有学习记录',
                        value: selectedClass.engaged_student_count,
                        icon: Activity,
                      },
                      {
                        label: '完成练习',
                        value: selectedClass.completed_practices,
                        icon: BookOpenCheck,
                      },
                      {
                        label: '平均得分率',
                        value: `${selectedClass.average_score_rate}%`,
                        icon: BarChart3,
                      },
                      { label: '错题', value: selectedClass.mistake_count, icon: AlertTriangle },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label}>
                        <Icon className="mb-2 h-4 w-4 text-indigo-200" />
                        <div className="text-2xl font-black">{value}</div>
                        <div className="text-xs text-indigo-200">{label}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="grid gap-6 2xl:grid-cols-[1.4fr_0.8fr]">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-black">学生学习情况</h2>
                        <p className="mt-1 text-sm text-slate-400">
                          支持姓名筛选、账号状态过滤和详情下钻
                        </p>
                      </div>
                      <form
                        className="flex gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          setStudentPage(1);
                          setStudentQuery(studentSearchText.trim());
                        }}
                      >
                        <input
                          value={studentSearchText}
                          onChange={(e) => setStudentSearchText(e.target.value)}
                          className="h-10 w-44 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-400"
                          placeholder="搜索学生"
                        />
                        <select
                          value={studentStatus}
                          onChange={(e) => {
                            setStudentStatus(e.target.value as 'all' | 'active' | 'inactive');
                            setStudentPage(1);
                          }}
                          className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none"
                        >
                          <option value="all">全部状态</option>
                          <option value="active">启用</option>
                          <option value="inactive">停用</option>
                        </select>
                        <button className="h-10 rounded-xl bg-slate-900 px-3 text-sm font-bold text-white">
                          筛选
                        </button>
                      </form>
                    </div>
                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-xs font-black text-slate-400">
                            <th className="px-2 py-3">学生</th>
                            <th className="px-2 py-3">已学章节</th>
                            <th className="px-2 py-3">练习</th>
                            <th className="px-2 py-3">得分率</th>
                            <th className="px-2 py-3">错题</th>
                            <th className="px-2 py-3">最近活动</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((student) => (
                            <tr
                              key={student.id}
                              className="border-b border-slate-100 last:border-0"
                            >
                              <td className="px-2 py-4">
                                <div className="font-bold">{student.display_name}</div>
                                <div className="text-xs text-slate-400">
                                  @{student.username} · {student.is_active ? '启用' : '停用'}
                                </div>
                              </td>
                              <td className="px-2 py-4 font-bold">{student.learned_sections}</td>
                              <td className="px-2 py-4">{student.completed_practices}</td>
                              <td className="px-2 py-4">
                                <div className="w-24">
                                  <div className="mb-1 text-xs font-bold">
                                    {student.overall_score_rate}%
                                  </div>
                                  <ScoreBar value={student.overall_score_rate} />
                                </div>
                              </td>
                              <td className="px-2 py-4 text-amber-600">{student.mistake_count}</td>
                              <td className="px-2 py-4 text-xs text-slate-400">
                                {formatDate(student.last_activity_at)}
                              </td>
                              <td className="px-2 py-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => void openStudent(student)}
                                  className="rounded-lg bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100"
                                >
                                  查看详情
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {loadingClassData && (
                        <div className="py-12 text-center text-sm text-slate-400">
                          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                          正在聚合学情
                        </div>
                      )}
                      {!loadingClassData && students.length === 0 && (
                        <div className="py-12 text-center text-sm text-slate-400">
                          没有符合条件的学生
                        </div>
                      )}
                    </div>
                    <Pagination
                      page={studentPage}
                      pageSize={STUDENT_PAGE_SIZE}
                      totalItems={studentTotal}
                      onPageChange={setStudentPage}
                    />
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-black">
                          {'\u73ed\u7ea7\u7ae0\u8282\u638c\u63e1\u60c5\u51b5'}
                        </h2>
                        <p className="mt-1 text-sm text-slate-400">
                          {
                            '\u6309\u5c0f\u8282\u67e5\u770b\u73ed\u7ea7\u638c\u63e1\u5ea6\u5e76\u5e03\u7f6e\u4f5c\u4e1a\uff1b\u77e5\u8bc6\u70b9\u8bca\u65ad\u4ecd\u53ef\u5728\u5b66\u751f\u8be6\u60c5\u4e2d\u67e5\u770b\u3002'
                          }
                        </p>
                      </div>
                      <BookOpenCheck className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="mt-5 space-y-3">
                      {sectionMastery.map((item) => (
                        <div
                          key={item.section_key}
                          className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-amber-700/70">
                                {item.chapter_title}
                              </div>
                              <div className="truncate font-black text-amber-950">
                                {item.section_number} {item.section_title}
                              </div>
                            </div>
                            <div className="text-lg font-black text-amber-700">
                              {item.attempts > 0 ? `${item.score_rate}%` : '\u672a\u7ec3\u4e60'}
                            </div>
                          </div>
                          <div className="mt-3">
                            <ScoreBar value={item.score_rate} tone="amber" />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-xs text-amber-700/70">
                              {item.attempts > 0 ? (
                                <>
                                  {item.student_count} {'\u540d\u5b66\u751f'} - {item.attempts}{' '}
                                  {'\u6b21\u4f5c\u7b54'}
                                </>
                              ) : (
                                <>{'\u6682\u65e0\u73ed\u7ea7\u7ec3\u4e60\u8bb0\u5f55'}</>
                              )}
                              {' - \u53ef\u7528\u5ba2\u89c2\u9898 '}
                              {item.available_question_count}
                              {' \u9053'}
                            </div>
                            <button
                              type="button"
                              disabled={item.available_question_count < 1}
                              onClick={() => setAssignmentTarget(item)}
                              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              {item.available_question_count < 1
                                ? '\u9898\u5e93\u4e0d\u8db3'
                                : '\u5e03\u7f6e\u672c\u8282\u4f5c\u4e1a'}
                            </button>
                          </div>
                        </div>
                      ))}
                      {!loadingClassData && sectionMastery.length === 0 && (
                        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">
                          {
                            '\u6682\u65e0\u53ef\u5e03\u7f6e\u4f5c\u4e1a\u7684\u7ae0\u8282\u9898\u76ee\u3002'
                          }
                        </div>
                      )}
                    </div>
                    <Pagination
                      page={sectionPage}
                      pageSize={SECTION_PAGE_SIZE}
                      totalItems={sectionTotal}
                      onPageChange={setSectionPage}
                    />
                  </div>
                </section>
                <AssignmentPanel
                  assignments={assignments}
                  loading={loadingClassData}
                  onClose={(assignmentId) => void closeAssignment(assignmentId)}
                  onDelete={(assignment) => void removeAssignment(assignment)}
                />
              </>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white text-slate-400">
                <div className="text-center">
                  <GraduationCap className="mx-auto mb-3 h-10 w-10" />
                  <p>选择一个负责班级查看学情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      {detailOpen && (
        <StudentDetailModal
          detail={studentDetail}
          loading={detailLoading}
          onClose={() => {
            setDetailOpen(false);
            setStudentDetail(null);
          }}
        />
      )}
      {assignmentTarget && (
        <AssignmentCreateDialog
          key={assignmentTarget.section_key}
          target={assignmentTarget}
          creating={creatingAssignment}
          onClose={() => setAssignmentTarget(null)}
          onSubmit={publishAssignment}
        />
      )}
    </div>
  );
}
