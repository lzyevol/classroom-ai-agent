import { authFetch } from '@/lib/auth/auth-client';
import type {
  AdminUser,
  AdminUserCreate,
  AdminUserPage,
  AdminUserUpdate,
  UserStatus,
} from './types';
import type { UserRole } from '@/lib/auth/auth-client';

const BASE = '/backend/api/admin';

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { detail?: string } | null;
  return new Error(body?.detail || fallback);
}

export async function fetchAdminUsers(input: {
  q?: string;
  role?: UserRole | 'all';
  status?: UserStatus;
  page: number;
  pageSize: number;
}): Promise<AdminUserPage> {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(input.pageSize),
    status: input.status ?? 'all',
  });
  if (input.q) params.set('q', input.q);
  if (input.role && input.role !== 'all') params.set('role', input.role);
  const response = await authFetch(`${BASE}/users?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw await apiError(response, '用户列表加载失败');
  return response.json() as Promise<AdminUserPage>;
}

export async function createAdminUser(input: AdminUserCreate): Promise<AdminUser> {
  const response = await authFetch(`${BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, '创建用户失败');
  return response.json() as Promise<AdminUser>;
}

export async function updateAdminUser(
  userId: string,
  input: AdminUserUpdate,
): Promise<AdminUser> {
  const response = await authFetch(`${BASE}/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, '更新用户失败');
  return response.json() as Promise<AdminUser>;
}

export async function resetAdminUserPassword(userId: string, password: string): Promise<void> {
  const response = await authFetch(
    `${BASE}/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
  );
  if (!response.ok) throw await apiError(response, '重置密码失败');
}

export async function setAdminUserStatus(
  userId: string,
  isActive: boolean,
): Promise<AdminUser> {
  const response = await authFetch(`${BASE}/users/${encodeURIComponent(userId)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!response.ok) throw await apiError(response, isActive ? '启用用户失败' : '停用用户失败');
  return response.json() as Promise<AdminUser>;
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const response = await authFetch(`${BASE}/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await apiError(response, '删除用户失败');
}

