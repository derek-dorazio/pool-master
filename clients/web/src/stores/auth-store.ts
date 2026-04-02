import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User) => void;
  clearUser: () => void;
  setLoading: (loading: boolean) => void;
}

function hydrateAuth(): { user: User | null; isAuthenticated: boolean } {
  try {
    const token = localStorage.getItem('access_token');
    const userData = localStorage.getItem('auth_user');
    if (token && userData) {
      return { user: JSON.parse(userData), isAuthenticated: true };
    }
  } catch {
    // Invalid stored data — start fresh
  }
  return { user: null, isAuthenticated: false };
}

const initial = hydrateAuth();

export const useAuthStore = create<AuthState>((set) => ({
  user: initial.user,
  isAuthenticated: initial.isAuthenticated,
  isLoading: !initial.isAuthenticated,
  setUser: (user) => {
    localStorage.setItem('auth_user', JSON.stringify(user));
    set({ user, isAuthenticated: true, isLoading: false });
  },
  clearUser: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('auth_user');
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
