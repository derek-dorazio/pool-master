import { create } from 'zustand';
import type { GetCurrentUserResponses } from '@/lib/api';

export type PoolmasterSessionUser = GetCurrentUserResponses[200]['user'];

type SessionState = {
  user: PoolmasterSessionUser | null;
  setSession: (user: PoolmasterSessionUser) => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  user: null,
  setSession: (user) =>
    set({
      user,
    }),
  clearSession: () =>
    set({
      user: null,
    }),
}));
