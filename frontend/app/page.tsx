'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  GraduationCap,
  MessageSquare,
  Settings,
  BookOpen,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ClipboardCheck,
  BarChart3,
  LogOut,
} from 'lucide-react';
import Link from 'next/link';
import { SettingsDialog } from '@/components/settings';
import { prefetchToc } from './lesson/lesson-client';
import { fetchLearningDashboard, fetchStudentAssignments } from './learning/learning-client';
import type { LearningDashboard, StudentAssignment } from './learning/types';
import { fetchCurrentUser, logoutUser, type AuthUser } from '@/lib/auth/auth-client';
import { PortalPlaceholder } from './portal-placeholder';

const ROLE_LABELS: Record<AuthUser['role'], string> = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
};

export default function HomePage() {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [learningDashboard, setLearningDashboard] = useState<LearningDashboard | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [assignmentsExpanded, setAssignmentsExpanded] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    prefetchToc();
    void fetchCurrentUser()
      .then((user) => {
        setCurrentUser(user);
        if (user.role === 'student') {
          void fetchLearningDashboard()
            .then(setLearningDashboard)
            .catch(() => {
              // The learning center provides its own retry and error message.
            });
          void fetchStudentAssignments()
            .then((result) => setStudentAssignments(result.items))
            .catch(() => undefined);
        } else {
          router.replace(`/${user.role}`);
        }
      })
      .catch(() => {
        // authFetch redirects unauthenticated users to the login page.
      })
      .finally(() => setAuthReady(true));
  }, [router]);

  useEffect(() => {
    if (currentUser?.role !== 'student') return;
    const refreshAssignments = () => {
      void fetchStudentAssignments()
        .then((result) => setStudentAssignments(result.items))
        .catch(() => undefined);
    };
    window.addEventListener('focus', refreshAssignments);
    return () => window.removeEventListener('focus', refreshAssignments);
  }, [currentUser?.role]);

  if (!authReady || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div
          className="h-9 w-9 animate-spin rounded-full border-4 border-violet-100 border-t-violet-600"
          aria-label="正在加载登录状态"
        />
      </div>
    );
  }

  if (currentUser.role !== 'student') {
    return <PortalPlaceholder user={currentUser} />;
  }

  const pendingAssignments = studentAssignments
    .filter(
      (assignment) =>
        assignment.assignment_status === 'active' && assignment.progress_status !== 'completed',
    )
    .sort((left, right) => {
      const statusRank = (assignment: StudentAssignment) =>
        assignment.progress_status === 'in_progress' ? 0 : 1;
      const statusDifference = statusRank(left) - statusRank(right);
      if (statusDifference !== 0) return statusDifference;

      const dueTime = (assignment: StudentAssignment) => {
        if (!assignment.due_at) return Number.MAX_SAFE_INTEGER;
        const value = new Date(assignment.due_at).getTime();
        return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
      };
      return dueTime(left) - dueTime(right);
    });
  const pendingAssignment = pendingAssignments[0] ?? null;
  const practiceDescription =
    '按章节生成选择、判断和简答题，提交后智能批改，并给出错因分析和教材原文依据。';
  const practiceTags = pendingAssignment
    ? [
        { id: 'pending-count', label: `待完成 ${pendingAssignments.length} 项` },
        { id: 'teacher-assigned', label: '教师布置' },
        { id: 'question-count', label: `${pendingAssignment.question_count} 题` },
        { id: 'section-number', label: `第 ${pendingAssignment.section_number} 节` },
      ]
    : [
        { id: 'chapter-questions', label: '章节出题' },
        { id: 'ai-grading', label: '智能批改' },
        { id: 'textbook-analysis', label: '教材解析' },
        { id: 'error-feedback', label: '错因反馈' },
      ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Top nav */}
      <header className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-8 h-16 bg-white/70 dark:bg-gray-900/70 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md shadow-violet-200/50">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-bold text-gray-800 dark:text-gray-100">
            具身智能课程教学智能体
          </span>
        </div>
        <div className="flex items-center gap-2">
          {currentUser && (
            <div className="hidden items-center gap-2 rounded-xl border border-gray-200/60 bg-white px-3 py-2 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex">
              <span className="font-bold text-gray-700 dark:text-gray-200">
                {currentUser.display_name}
              </span>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-600 dark:bg-violet-900/30">
                {ROLE_LABELS[currentUser.role]}
              </span>
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-violet-400 hover:text-violet-600 transition-all text-sm font-medium shadow-sm"
          >
            <Settings className="w-4 h-4" />
            设置
          </button>
          <button
            onClick={() => void logoutUser()}
            className="flex items-center gap-2 rounded-xl border border-gray-200/60 bg-white px-3 py-2 text-sm font-medium text-gray-500 shadow-sm transition hover:border-red-300 hover:text-red-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            title="退出登录"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">退出</span>
          </button>
        </div>
      </header>

      <main className="pt-16 px-8 pb-16">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center pt-20 pb-14"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200/50 text-violet-600 text-sm font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              RAG · Neo4j · DeepSeek
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-4">
              具身智能课程教学智能体
            </h1>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              AI 老师讲课 + 教材问答 + 章节练习，学习过程均有教材原文依据
            </p>
          </motion.div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="h-full"
            >
              <Link
                href="/lesson"
                className="group flex h-full flex-col rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700 p-8 shadow-sm hover:shadow-xl hover:shadow-violet-100/50 hover:-translate-y-1 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-5 shadow-lg shadow-violet-200/50 group-hover:shadow-violet-300/60 transition-all">
                  <GraduationCap className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                  AI 老师讲课
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
                  选择章节，AI 老师逐张讲解幻灯片，配有语音讲稿和课中小测，随时可以打断提问。
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {['幻灯片', '语音讲解', '课中小测', '打断提问'].map((t) => (
                    <span
                      key={t}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-1 text-sm font-semibold text-violet-600 group-hover:gap-2 transition-all">
                  开始上课 <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="h-full"
            >
              <Link
                href="/qa"
                className="group flex h-full flex-col rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700 p-8 shadow-sm hover:shadow-xl hover:shadow-indigo-100/50 hover:-translate-y-1 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center mb-5 shadow-lg shadow-indigo-200/50 group-hover:shadow-indigo-300/60 transition-all">
                  <MessageSquare className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                  专门问答
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
                  深入追问任意课程概念，多轮对话，每条回答都附有教材原文引用，无依据时明确告知。
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {['多轮对话', '教材溯源', '知识点标注', '会话历史'].map((t) => (
                    <span
                      key={t}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-1 text-sm font-semibold text-indigo-600 group-hover:gap-2 transition-all">
                  开始提问 <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="h-full"
            >
              <div className="group flex h-full flex-col rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700 p-8 shadow-sm hover:shadow-xl hover:shadow-fuchsia-100/50 hover:-translate-y-1 transition-all">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center mb-5 shadow-lg shadow-fuchsia-200/50 group-hover:shadow-fuchsia-300/60 transition-all">
                  <ClipboardCheck className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                  章节练习
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
                  {practiceDescription}
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {practiceTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-100"
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
                <div className="relative mt-auto">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/practice"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-fuchsia-600 transition hover:gap-2"
                    >
                      开始练习 <ArrowRight className="w-4 h-4" />
                    </Link>
                    {pendingAssignment && (
                      <button
                        type="button"
                        onClick={() => setAssignmentsExpanded((current) => !current)}
                        aria-expanded={assignmentsExpanded}
                        className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 px-3 py-1.5 text-xs font-bold text-fuchsia-700 transition hover:bg-fuchsia-50"
                      >
                        教师布置 ({pendingAssignments.length})
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${assignmentsExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                  </div>
                  {pendingAssignment && assignmentsExpanded && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-3 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-fuchsia-100 bg-white p-3 shadow-xl shadow-fuchsia-200/60 dark:bg-gray-800">
                      {pendingAssignments.map((assignment) => (
                        <div
                          key={assignment.id}
                          className="rounded-lg border border-fuchsia-100 bg-white p-3 dark:bg-gray-800"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-gray-800 dark:text-gray-100">
                                {assignment.title}
                              </div>
                              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                                {assignment.section_number} {assignment.section_title}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-600">
                              #{assignment.question_count}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-[11px] text-gray-400">
                              {assignment.due_at
                                ? new Date(assignment.due_at).toLocaleDateString('zh-CN', {
                                    month: 'numeric',
                                    day: 'numeric',
                                  })
                                : '--'}
                            </span>
                            <Link
                              href={`/practice?assignment_id=${encodeURIComponent(assignment.id)}&section_key=${encodeURIComponent(assignment.section_key)}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-fuchsia-600 hover:gap-1.5"
                            >
                              {assignment.progress_status === 'in_progress'
                                ? '完成作业'
                                : '开始练习'}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="h-full"
            >
              <Link
                href="/learning"
                className="group flex h-full flex-col rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700 p-8 shadow-sm hover:shadow-xl hover:shadow-emerald-100/50 hover:-translate-y-1 transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-5 shadow-lg shadow-emerald-200/50 group-hover:shadow-emerald-300/60 transition-all">
                  <BarChart3 className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                  我的学习中心
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
                  {learningDashboard?.recommendations[0]?.title ??
                    '查看知识点掌握度、待复习错题和个性化学习建议，跟踪当前学习进度。'}
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                    {learningDashboard?.summary.overall_score_rate ?? 0}% 掌握度
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                    {learningDashboard?.summary.learned_sections ?? 0} 已学章节
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                    {learningDashboard?.summary.mistake_count ?? 0} 待复习
                  </span>
                </div>
                <div className="mt-auto flex items-center gap-1 text-sm font-semibold text-emerald-600 group-hover:gap-2 transition-all">
                  查看学习中心 <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-10 rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6"
          >
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 dark:text-gray-100">今日学习提醒</h2>
                  <p className="mt-0.5 text-xs text-gray-400">聚焦当前任务和下一步学习行动</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:flex xl:items-center">
                <div className="rounded-xl bg-fuchsia-50 px-4 py-3 dark:bg-fuchsia-950/30">
                  <div className="text-[11px] font-semibold text-fuchsia-500">教师任务</div>
                  <div className="mt-1 text-sm font-bold text-fuchsia-700 dark:text-fuchsia-300">
                    {pendingAssignments.length} 项待完成
                  </div>
                </div>
                <div className="rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
                  <div className="text-[11px] font-semibold text-amber-500">待复习</div>
                  <div className="mt-1 text-sm font-bold text-amber-700 dark:text-amber-300">
                    {learningDashboard?.summary.mistake_count ?? 0} 道错题
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
                  <div className="text-[11px] font-semibold text-emerald-500">推荐学习</div>
                  <div className="mt-1 max-w-56 truncate text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    {learningDashboard?.recommendations[0]?.title ?? '查看学习中心获取个性化建议'}
                  </div>
                </div>
              </div>

              <Link
                href="/learning"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-violet-600 transition hover:gap-2"
              >
                查看学习建议 <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
