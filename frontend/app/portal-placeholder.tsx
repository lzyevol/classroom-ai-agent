'use client';

import {
  BookOpen,
  CheckCircle2,
  Construction,
  LogOut,
  School,
  ShieldCheck,
} from 'lucide-react';
import { logoutUser, type AuthUser } from '@/lib/auth/auth-client';

interface PortalPlaceholderProps {
  user: AuthUser;
}

const PORTAL_CONTENT = {
  teacher: {
    label: '教师端',
    title: '教师工作台即将上线',
    description: '教师身份与班级权限已经接通，后续将在这里开发班级、学生学习情况和教学管理功能。',
    icon: School,
    checks: ['只能查看自己负责的班级', '可以查看负责班级中的学生', '不能访问其他教师的班级数据'],
  },
  admin: {
    label: '管理员端',
    title: '管理员工作台即将上线',
    description: '管理员身份与全局权限已经接通，后续将在这里开发用户、班级和系统权限管理功能。',
    icon: ShieldCheck,
    checks: ['可以查看系统用户', '可以查看全部班级与学生', '具备全局数据管理权限'],
  },
} as const;

export function PortalPlaceholder({ user }: PortalPlaceholderProps) {
  if (user.role === 'student') return null;
  const portal = PORTAL_CONTENT[user.role];
  const Icon = portal.icon;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex h-16 items-center justify-between border-b border-slate-200/80 bg-white px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-200">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-black text-slate-900">具身智能课程教学智能体</div>
            <div className="text-[11px] text-slate-400">{portal.label}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logoutUser()}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-500 transition hover:border-violet-300 hover:text-violet-600"
        >
          <LogOut className="h-4 w-4" />
          切换身份
        </button>
      </header>

      <main className="mx-auto flex max-w-5xl items-center px-5 py-16 sm:min-h-[calc(100vh-4rem)] sm:px-8 sm:py-20">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/60 md:grid-cols-[0.85fr_1.15fr]">
          <div className="flex min-h-72 flex-col justify-between bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-8 text-white sm:p-10">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                <Icon className="h-7 w-7" />
              </div>
              <div className="mt-6 text-sm font-semibold text-indigo-200">当前已登录</div>
              <h1 className="mt-1 text-3xl font-black">{portal.label}</h1>
            </div>
            <div className="mt-10 border-t border-white/15 pt-5">
              <div className="text-lg font-black">{user.display_name}</div>
              <div className="mt-1 text-sm text-indigo-200">账号：{user.username}</div>
            </div>
          </div>

          <div className="p-8 sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
              <Construction className="h-3.5 w-3.5" />
              功能建设中
            </div>
            <h2 className="mt-5 text-2xl font-black text-slate-900 sm:text-3xl">{portal.title}</h2>
            <p className="mt-4 text-sm leading-7 text-slate-500">{portal.description}</p>

            <div className="mt-7 space-y-3 rounded-2xl bg-slate-50 p-5">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">当前权限已生效</div>
              {portal.checks.map((check) => (
                <div key={check} className="flex items-start gap-3 text-sm font-medium text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  {check}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void logoutUser()}
              className="mt-8 flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-bold text-white transition hover:bg-violet-700"
            >
              <LogOut className="h-4 w-4" />
              返回登录页切换身份
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
