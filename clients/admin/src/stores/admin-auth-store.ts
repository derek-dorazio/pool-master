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

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  adminUser: null,
  isAuthenticated: false,
  isLoading: true,
  setAdminUser: (user) => set({ adminUser: user, isAuthenticated: true, isLoading: false }),
  clearAdminUser: () => {
    localStorage.removeItem('admin_token');
    set({ adminUser: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (loading) => set({ isLoading: loading }),
}));
