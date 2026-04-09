import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PoolmasterSessionMode = 'member' | 'root-admin';

export type PoolmasterSessionUser = {
  id: string;
  email: string;
  displayName: string;
};

export type PoolmasterSessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type SessionState = {
  mode: PoolmasterSessionMode | null;
  tokens: PoolmasterSessionTokens | null;
  user: PoolmasterSessionUser | null;
  setMemberSession: (session: {
    tokens: PoolmasterSessionTokens;
    user: PoolmasterSessionUser;
  }) => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      mode: null,
      tokens: null,
      user: null,
      setMemberSession: ({ tokens, user }) =>
        set({
          mode: 'member',
          tokens,
          user,
        }),
      clearSession: () =>
        set({
          mode: null,
          tokens: null,
          user: null,
        }),
    }),
    {
      name: 'poolmaster-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        tokens: state.tokens,
        user: state.user,
      }),
    },
  ),
);
