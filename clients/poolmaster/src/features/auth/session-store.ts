import { create } from 'zustand';
import type {
  GetCurrentUserResponses,
  InactivateAccountResponses,
  ReactivateAccountResponses,
  UpdateAccountPreferencesResponses,
  UpdateAccountProfileResponses,
} from '@/lib/api';

export type PoolmasterSessionUser = GetCurrentUserResponses[200]['user'];
export type StoredPoolmasterSessionUser =
  Omit<PoolmasterSessionUser, 'sessionId'> & { sessionId: string | null };
type AccountSessionUserUpdate =
  | UpdateAccountProfileResponses[200]['user']
  | UpdateAccountPreferencesResponses[200]['user']
  | ReactivateAccountResponses[200]['user']
  | InactivateAccountResponses[200]['user'];
type PoolmasterSessionUserUpdate =
  | PoolmasterSessionUser
  | AccountSessionUserUpdate;

type SessionState = {
  user: StoredPoolmasterSessionUser | null;
  sessionId: string | null;
  setSession: (user: PoolmasterSessionUserUpdate) => void;
  setSessionId: (sessionId: string | null) => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  user: null,
  sessionId: null,
  setSession: (user) =>
    set((state) => {
      const resolvedSessionId = user.sessionId ?? state.sessionId ?? null;

      return {
        user: {
          ...user,
          sessionId: resolvedSessionId,
        },
        sessionId: resolvedSessionId,
      };
    }),
  setSessionId: (sessionId) =>
    set((state) => ({
      sessionId,
      user: state.user
        ? {
          ...state.user,
          sessionId: sessionId ?? state.user.sessionId,
        }
        : null,
    })),
  clearSession: () =>
    set({
      user: null,
      sessionId: null,
    }),
}));
