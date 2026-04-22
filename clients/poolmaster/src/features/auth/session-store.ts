import { create } from 'zustand';
import type {
  GetCurrentUserResponses,
  InactivateAccountResponses,
  ReactivateAccountResponses,
  UpdateAccountPreferencesResponses,
  UpdateAccountProfileResponses,
} from '@/lib/api';
import { logger } from '@/lib/logger';

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

      logger.debug(
        {
          action: 'auth.session.set',
          data: {
            userId: user.id,
            hasIncomingSessionId: Boolean(user.sessionId),
            hasExistingSessionId: Boolean(state.sessionId),
            hasResolvedSessionId: Boolean(resolvedSessionId),
          },
        },
        'Updated auth session state',
      );

      return {
        user: {
          ...user,
          sessionId: resolvedSessionId,
        },
        sessionId: resolvedSessionId,
      };
    }),
  setSessionId: (sessionId) =>
    set((state) => {
      logger.debug(
        {
          action: 'auth.session.sessionIdUpdated',
          data: {
            hasSessionId: Boolean(sessionId),
            hasUser: Boolean(state.user),
          },
        },
        'Updated auth session id',
      );

      return {
        sessionId,
        user: state.user
          ? {
            ...state.user,
            sessionId: sessionId ?? state.user.sessionId,
          }
          : null,
      };
    }),
  clearSession: () =>
    set((state) => {
      logger.info(
        {
          action: 'auth.session.cleared',
          data: {
            hadUser: Boolean(state.user),
            hadSessionId: Boolean(state.sessionId),
          },
        },
        'Cleared auth session state',
      );

      return {
        user: null,
        sessionId: null,
      };
    }),
}));
