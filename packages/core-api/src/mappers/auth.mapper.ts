/**
 * Auth response envelopes.
 *
 * #202 step 3.4 — the `User` projection is no longer here. It lived here over a local
 * `UserRow` interface, one of four copies; `users.mapper.ts` owns the only one now, over the
 * canonical domain `User`.
 */
import type { AuthResponse, MeResponse, TokenRefreshResponse } from '@poolmaster/shared/dto';
import type { User } from '@poolmaster/shared/domain';
import { toUserDto } from './users.mapper';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  sessionId: string;
}

export function toAuthResponse(user: User, tokens: TokenPair): AuthResponse {
  return {
    user: toUserDto(user),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken: tokens.csrfToken,
      expiresIn: tokens.expiresIn,
    },
  };
}

export function toMeResponse(user: User): MeResponse {
  return {
    user: toUserDto(user),
  };
}

// #206 — `tokens.sessionId` is deliberately not mapped out. It lives in the access token's
// `sid` claim, which the browser cannot read (httpOnly) and does not need: the client-log
// ingest route reads it from the token server-side.
export function toTokenRefreshResponse(tokens: TokenPair): TokenRefreshResponse {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    csrfToken: tokens.csrfToken,
    expiresIn: tokens.expiresIn,
  };
}
