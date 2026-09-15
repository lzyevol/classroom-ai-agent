import type { UserRole } from '@/lib/auth/auth-client';

export type UserStatus = 'all' | 'active' | 'inactive' | 'deleted';

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminUserCreate {
  username: string;
  display_name: string;
  role: UserRole;
  password: string;
  is_active: boolean;
}

export interface AdminUserUpdate {
  username?: string;
  display_name?: string;
  role?: UserRole;
}

