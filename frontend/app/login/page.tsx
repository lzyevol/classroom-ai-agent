'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  LockKeyhole,
  School,
  ShieldCheck,
} from 'lucide-react';
import { loginUser, type UserRole } from '@/lib/auth/auth-client';

const PORTALS = [
  {
    role: 'student',
    label: '学生端',
    title: '进入学生学习空间',
    description: '上课、教材问答、章节练习和个人学习记录',
    username: 'student',
    password: 'student123',
    icon: GraduationCap,
  },
  {
    role: 'teacher',
    label: '教师端',
    title: '进入教师教学空间',
    description: '查看负责班级和学生学习情况',
    username: 'teacher',
    password: 'teacher123',
    icon: School,
  },
  {
    role: 'admin',
    label: '管理员端',
    title: '进入系统管理空间',
    description: '管理用户、班级与系统权限',
    username: 'admin',
    password: 'admin123',
    icon: ShieldCheck,
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<UserRole>('student');
  const [username, setUsername] = useState('student');
  const [password, setPassword] = useState('student123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const selectedPortal = PORTALS.find((portal) => portal.role === selectedRole) ?? PORTALS[0];

  function selectPortal(role: UserRole) {
    const portal = PORTALS.find((item) => item.role === role) ?? PORTALS[0];
    setSelectedRole(role);
    setUsername(portal.username);
    setPassword(portal.password);
    setError('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await loginUser(username.trim(), password, selectedRole);
      router.replace(user.role === 'student' ? '/' : `/${user.role}`);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-6 sm:px-6 lg:flex lg:items-center lg:justify-center lg:py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-28 top-[-7rem] h-80 w-80 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="absolute bottom-[-9rem] right-[-5rem] h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:42px_42px]" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl shadow-black/30 lg:min-h-[680px] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 top-20 h-64 w-64 rounded-full border border-white/10" />
          <div className="absolute -right-12 top-32 h-64 w-64 rounded-full border border-white/10" />
          <div>
            <div className="mb-12 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/20 backdrop-blur">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <div className="text-lg font-black tracking-tight">具身智能课程教学智能体</div>
                <div className="text-xs text-indigo-200">Embodied Intelligence Classroom</div>
              </div>
            </div>

            <div className="max-w-md">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-indigo-100 backdrop-blur">
                <LockKeyhole className="h-3.5 w-3.5" />
                按角色加载对应权限
              </span>
              <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight">
                一个入口，连接
                <br />
                学习、教学与管理
              </h1>
              <p className="mt-5 text-sm leading-7 text-indigo-100/80">
                学生、教师和管理员使用各自账号登录。系统会根据真实登录角色控制可访问的数据和功能。
              </p>
            </div>
          </div>

          <div className="space-y-3 text-sm text-indigo-100/90">
            {['学生数据相互隔离', '教师仅查看负责班级', '管理员统一管理权限'].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center bg-white px-5 py-8 sm:px-10 lg:px-14 lg:py-12">
          <div className="mx-auto w-full max-w-xl">
            <div className="mb-7 lg:hidden">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-200">
                <BookOpen className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-black text-slate-900">具身智能课程教学智能体</h1>
              <p className="mt-1 text-sm text-slate-500">选择身份后登录对应端</p>
            </div>

            <div className="mb-7">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600">选择登录入口</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">你要进入哪个端？</h2>
              <p className="mt-2 text-sm text-slate-500">登录后仍可退出并切换其他身份。</p>
            </div>

            <div className="mb-7 grid grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="选择登录角色">
              {PORTALS.map((portal) => {
                const Icon = portal.icon;
                const selected = portal.role === selectedRole;
                return (
                  <button
                    key={portal.role}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => selectPortal(portal.role)}
                    className={
                      selected
                        ? 'relative rounded-2xl border-2 border-violet-500 bg-violet-50 px-2 py-4 text-violet-700 shadow-sm transition sm:px-4'
                        : 'relative rounded-2xl border-2 border-slate-100 bg-white px-2 py-4 text-slate-500 transition hover:border-violet-200 hover:bg-violet-50/40 hover:text-violet-600 sm:px-4'
                    }
                  >
                    {selected && (
                      <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-violet-500 ring-4 ring-violet-100" />
                    )}
                    <Icon className="mx-auto h-6 w-6" />
                    <span className="mt-2 block text-xs font-black sm:text-sm">{portal.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="font-bold text-slate-800">{selectedPortal.title}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{selectedPortal.description}</div>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">用户名</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  placeholder={'请输入' + selectedPortal.label + '账号'}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-700">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  placeholder="请输入密码"
                />
              </label>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !username.trim() || !password}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {loading ? '正在登录' + selectedPortal.label + '…' : '登录' + selectedPortal.label}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              当前为本地演示账号，切换入口会自动填写对应账号
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
