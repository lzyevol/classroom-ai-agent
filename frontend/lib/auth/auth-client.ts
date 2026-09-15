'use client';

export type UserRole = 'student' | 'teacher' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
}

interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  expires_at: string;
  user: AuthUser;
}

const TOKEN_KEY = 'classroom_auth_token';
const USER_KEY = 'classroom_auth_user';
const BACKEND = '/backend';

function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  window.location.assign('/login');
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(USER_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as AuthUser;
  } catch {
    window.localStorage.removeItem(USER_KEY);
    return null;
  }
}

function storeSession(response: LoginResponse): void {
  window.localStorage.setItem(TOKEN_KEY, response.access_token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(response.user));
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export async function loginUser(
  username: string,
  password: string,
  expectedRole?: UserRole,
): Promise<AuthUser> {
  const response = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || '登录失败，请检查用户名和密码');
  }
  const result = (await response.json()) as LoginResponse;
  if (expectedRole && result.user.role !== expectedRole) {
    await fetch(BACKEND + '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + result.access_token },
    }).catch(() => undefined);
    const roleLabels: Record<UserRole, string> = {
      student: '学生端',
      teacher: '教师端',
      admin: '管理员端',
    };
    throw new Error('该账号不属于' + roleLabels[expectedRole] + '，请切换登录入口');
  }
  storeSession(result);
  return result.user;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  if (!token) {
    redirectToLogin();
    throw new Error('请先登录');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearAuthSession();
    redirectToLogin();
  }
  return response;
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const response = await authFetch(`${BACKEND}/api/auth/me`, { cache: 'no-store' });
  if (!response.ok) throw new Error('获取当前用户失败');
  const user = (await response.json()) as AuthUser;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function logoutUser(): Promise<void> {
  try {
    const token = getAuthToken();
    if (token) {
      await fetch(`${BACKEND}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } finally {
    clearAuthSession();
    redirectToLogin();
  }
}
