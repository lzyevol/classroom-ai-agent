'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpenCheck,
  LogOut,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchCurrentUser,
  logoutUser,
  type AuthUser,
} from '@/lib/auth/auth-client';

export default function TeacherHomePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void fetchCurrentUser()
      .then((current) => {
        if (current.role !== 'teacher' && current.role !== 'admin') {
          toast.error('只有教师可以进入教师主页');
          router.replace('/');
          return;
        }
        setUser(current);
        setReady(true);
      })
      .catch(() => {
        // authFetch already redirects unauthenticated users to /login.
      });
  }, [router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-violet-100 border-t-violet-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-lg shadow-indigo-200">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="font-black">教师工作台</div>
              <div className="text-xs text-slate-400">
                欢迎，{user.display_name || user.username}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logoutUser()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:border-red-200 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
            退出
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-10 sm:px-8">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200/50 bg-violet-50 px-4 py-1.5 text-sm font-medium text-violet-600">
            <Sparkles className="h-3.5 w-3.5" />
            教师视角 · 班级学情 · 课件生成
          </div>
          <h1 className="mb-3 text-4xl font-extrabold tracking-tight">
            具身智能课程教学智能体
          </h1>
          <p className="mx-auto max-w-xl text-lg text-slate-500">
            管理班级学情，按章节生成课件，辅助日常教学工作
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Link
            href="/teacher/classes"
            className="group flex h-full flex-col rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-100/50"
          >
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-200/50 transition-all group-hover:shadow-indigo-300/60">
              <Users className="h-7 w-7" />
            </div>
            <h2 className="mb-2 text-xl font-bold text-slate-800">班级管理</h2>
            <p className="mb-6 text-sm leading-relaxed text-slate-500">
              查看名下班级的整体学情，逐个学生下钻答题记录，识别班级薄弱知识点。
            </p>
            <div className="mb-6 flex flex-wrap gap-2">
              {['班级概览', '学生下钻', '薄弱知识点', '得分率'].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600"
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-1 text-sm font-semibold text-indigo-600 transition-all group-hover:gap-2">
              进入班级管理 <ArrowRight className="h-4 w-4" />
            </div>
          </Link>

          <Link
            href="/teacher/lessons"
            className="group flex h-full flex-col rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-100/50"
          >
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-200/50 transition-all group-hover:shadow-violet-300/60">
              <BookOpenCheck className="h-7 w-7" />
            </div>
            <h2 className="mb-2 text-xl font-bold text-slate-800">课件生成</h2>
            <p className="mb-6 text-sm leading-relaxed text-slate-500">
              按章节生成幻灯片课件、AI 讲稿与课中小测，供 AI 老师讲课时使用。
            </p>
            <div className="mb-6 flex flex-wrap gap-2">
              {['章节选择', '批量生成', '讲稿预览', '课件下载'].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-600"
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-1 text-sm font-semibold text-violet-600 transition-all group-hover:gap-2">
              进入课件生成 <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
