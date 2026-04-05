import { create } from 'zustand';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

interface AdminAuthState {
  adminUser: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAdminUser: (user: AdminUser) => void;
  clearAdminUser: () => void;
  setLoading: (loading: boolean) => void;
}

function hydrateAdminAuth(): { adminUser: AdminUser | null; isAuthenticated: boolean } {
  try {
    const token = localStorage.getItem('admin_access_token') ?? localStorage.getItem('admin_token');
    const adminUserData = localStorage.getItem('admin_user');
    if (token && adminUserData) {
      return { adminUser: JSON.parse(adminUserData), isAuthenticated: true };
    }
  } catch {
    // Invalid stored data — start fresh
  }

  return { adminUser: null, isAuthenticated: false };
}

const initial = hydrateAdminAuth();

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  adminUser: initial.adminUser,
  isAuthenticated: initial.isAuthenticated,
  isLoading: false,
  setAdminUser: (user) => {
    localStorage.setItem('admin_user', JSON.stringify(user));
    set({ adminUser: user, isAuthenticated: true, isLoading: false });
  },
  clearAdminUser: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_access_token');
    localStorage.removeItem('admin_user');
    set({ adminUser: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (loading) => set({ isLoading: loading }),
}));
