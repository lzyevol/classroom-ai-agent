'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserRoundCog,
  UserX,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { fetchCurrentUser, logoutUser, type UserRole } from '@/lib/auth/auth-client';
import { Pagination } from '../learning/pagination';
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  resetAdminUserPassword,
  setAdminUserStatus,
  updateAdminUser,
} from './admin-client';
import type { AdminUser, AdminUserCreate, AdminUserUpdate, UserStatus } from './types';

const PAGE_SIZE = 10;
const ROLE_LABELS: Record<UserRole, string> = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
};
const EMPTY_CREATE: AdminUserCreate = {
  username: '',
  display_name: '',
  role: 'student',
  password: '',
  is_active: true,
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100';

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<UserRole | 'all'>('all');
  const [status, setStatus] = useState<UserStatus>('all');
  const [createForm, setCreateForm] = useState<AdminUserCreate | null>(null);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<AdminUserUpdate>({});
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    void fetchCurrentUser()
      .then((user) => {
        if (user.role !== 'admin') {
          toast.error('只有管理员可以进入用户管理');
          router.replace('/');
          return;
        }
        setReady(true);
      })
      .catch(() => undefined);
  }, [router]);

  const loadUsers = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const result = await fetchAdminUsers({
        q: query,
        role,
        status,
        page,
        pageSize: PAGE_SIZE,
      });
      setUsers(result.items);
      setTotal(result.total);
      if (result.total > 0 && result.items.length === 0 && page > 1) setPage(page - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '用户列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, query, ready, role, status]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const pageStats = useMemo(
    () => ({
      active: users.filter((user) => user.is_active && !user.deleted_at).length,
      inactive: users.filter((user) => !user.is_active && !user.deleted_at).length,
      deleted: users.filter((user) => Boolean(user.deleted_at)).length,
    }),
    [users],
  );

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await loadUsers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-violet-600" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-lg shadow-violet-200"><ShieldCheck className="h-5 w-5" /></div>
            <div><div className="font-black">系统管理工作台</div><div className="text-xs text-slate-400">账号生命周期与访问安全</div></div>
          </div>
          <button type="button" onClick={() => void logoutUser()} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:border-red-200 hover:text-red-600"><LogOut className="h-4 w-4" />退出</button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <section className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-900 p-7 text-white shadow-xl">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div><div className="text-sm font-bold text-violet-200">第一阶段 · 管理员用户管理</div><h1 className="mt-2 text-3xl font-black">用户与账号安全</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">统一管理学生、教师和管理员账号。停用、删除或重置密码后，已有登录会话会立即失效。</p></div>
            <button type="button" onClick={() => setCreateForm({ ...EMPTY_CREATE })} className="flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-black text-violet-700 shadow-lg hover:bg-violet-50"><Plus className="h-4 w-4" />新增用户</button>
          </div>
        </section>

        <section className="mb-6 grid gap-3 sm:grid-cols-4">
          {[
            { label: '筛选结果', value: total, icon: UserRoundCog, color: 'text-violet-600' },
            { label: '本页启用', value: pageStats.active, icon: UserCheck, color: 'text-emerald-600' },
            { label: '本页停用', value: pageStats.inactive, icon: UserX, color: 'text-amber-600' },
            { label: '本页已删除', value: pageStats.deleted, icon: Trash2, color: 'text-red-500' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-slate-400"><span>{label}</span><Icon className={`h-4 w-4 ${color}`} /></div>
              <div className="mt-2 text-2xl font-black">{value}</div>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <form
              className="flex min-w-64 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setQuery(searchText.trim());
              }}
            >
              <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input className={`${inputClass} pl-9`} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索用户名或姓名" /></div>
              <button className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">搜索</button>
            </form>
            <select className={`${inputClass} w-auto min-w-32`} value={role} onChange={(event) => { setRole(event.target.value as UserRole | 'all'); setPage(1); }}>
              <option value="all">全部角色</option><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option>
            </select>
            <select className={`${inputClass} w-auto min-w-32`} value={status} onChange={(event) => { setStatus(event.target.value as UserStatus); setPage(1); }}>
              <option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option><option value="deleted">已删除</option>
            </select>
            <button type="button" onClick={() => void loadUsers()} className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-500 hover:text-violet-600"><RefreshCcw className="h-4 w-4" />刷新</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead><tr className="border-b border-slate-100 text-xs font-black uppercase tracking-wider text-slate-400"><th className="px-3 py-3">用户</th><th className="px-3 py-3">角色</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">更新时间</th><th className="px-3 py-3 text-right">操作</th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-4"><div className="font-bold text-slate-800">{user.display_name}</div><div className="mt-1 text-xs text-slate-400">@{user.username}</div></td>
                    <td className="px-3 py-4"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{ROLE_LABELS[user.role]}</span></td>
                    <td className="px-3 py-4">{user.deleted_at ? <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">已删除</span> : user.is_active ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">启用</span> : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">停用</span>}</td>
                    <td className="px-3 py-4 text-xs text-slate-500">{formatDate(user.updated_at)}</td>
                    <td className="px-3 py-4">
                      {!user.deleted_at && <div className="flex justify-end gap-1">
                        <button title="编辑" onClick={() => { setEditUser(user); setEditForm({ username: user.username, display_name: user.display_name, role: user.role }); }} className="rounded-lg p-2 text-slate-400 hover:bg-violet-50 hover:text-violet-600"><Pencil className="h-4 w-4" /></button>
                        <button title="重置密码" onClick={() => { setPasswordUser(user); setNewPassword(''); }} className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"><KeyRound className="h-4 w-4" /></button>
                        <button title={user.is_active ? '停用' : '启用'} disabled={busy} onClick={() => void runAction(() => setAdminUserStatus(user.id, !user.is_active).then(() => undefined), user.is_active ? '账号已停用' : '账号已启用')} className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600">{user.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}</button>
                        <button title="删除" disabled={busy} onClick={() => { if (window.confirm(`确认软删除用户“${user.display_name}”吗？`)) void runAction(() => deleteAdminUser(user.id), '用户已删除'); }} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <div className="flex h-40 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />正在加载用户…</div>}
            {!loading && users.length === 0 && <div className="flex h-40 items-center justify-center text-sm text-slate-400">没有符合条件的用户</div>}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} totalItems={total} onPageChange={setPage} />
        </section>
      </main>

      {createForm && (
        <Modal title="新增用户" onClose={() => setCreateForm(null)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void runAction(() => createAdminUser(createForm).then(() => { setCreateForm(null); }), '用户创建成功'); }}>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-600">用户名<input required minLength={3} className={`${inputClass} mt-2`} value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} /></label><label className="text-sm font-bold text-slate-600">姓名<input required className={`${inputClass} mt-2`} value={createForm.display_name} onChange={(e) => setCreateForm({ ...createForm, display_name: e.target.value })} /></label></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-600">角色<select className={`${inputClass} mt-2`} value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label><label className="text-sm font-bold text-slate-600">初始密码<input required minLength={8} type="password" className={`${inputClass} mt-2`} value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} /></label></div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" checked={createForm.is_active} onChange={(e) => setCreateForm({ ...createForm, is_active: e.target.checked })} />创建后立即启用</label>
            <button disabled={busy} className="flex h-11 w-full items-center justify-center rounded-xl bg-violet-600 font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : '创建用户'}</button>
          </form>
        </Modal>
      )}

      {editUser && (
        <Modal title={`编辑用户 · ${editUser.display_name}`} onClose={() => setEditUser(null)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void runAction(() => updateAdminUser(editUser.id, editForm).then(() => setEditUser(null)), '用户信息已更新'); }}>
            <label className="block text-sm font-bold text-slate-600">用户名<input required minLength={3} className={`${inputClass} mt-2`} value={editForm.username ?? ''} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} /></label>
            <label className="block text-sm font-bold text-slate-600">姓名<input required className={`${inputClass} mt-2`} value={editForm.display_name ?? ''} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} /></label>
            <label className="block text-sm font-bold text-slate-600">角色<select className={`${inputClass} mt-2`} value={editForm.role ?? editUser.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label>
            <button disabled={busy} className="flex h-11 w-full items-center justify-center rounded-xl bg-violet-600 font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : '保存修改'}</button>
          </form>
        </Modal>
      )}

      {passwordUser && (
        <Modal title={`重置密码 · ${passwordUser.display_name}`} onClose={() => setPasswordUser(null)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void runAction(() => resetAdminUserPassword(passwordUser.id, newPassword).then(() => setPasswordUser(null)), '密码已重置，旧会话已失效'); }}>
            <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-700">重置后该用户在其他设备上的登录状态会立即失效。</p>
            <label className="block text-sm font-bold text-slate-600">新密码<input required minLength={8} type="password" className={`${inputClass} mt-2`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <button disabled={busy} className="flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : '确认重置密码'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
