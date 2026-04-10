import { create } from 'zustand';

export type PoolmasterSessionMode = 'member';

export type PoolmasterSessionUser = {
  id: string;
  email: string;
  displayName: string;
};

type SessionState = {
  mode: PoolmasterSessionMode | null;
  user: PoolmasterSessionUser | null;
  setMemberSession: (user: PoolmasterSessionUser) => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  mode: null,
  user: null,
  setMemberSession: (user) =>
    set({
      mode: 'member',
      user,
    }),
  clearSession: () =>
    set({
      mode: null,
      user: null,
    }),
}));
