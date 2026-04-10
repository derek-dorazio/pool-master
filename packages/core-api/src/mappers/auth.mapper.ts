/**
 * Auth mappers — convert internal domain/Prisma objects to DTOs.
 */
import type { AuthResponse, UserProfileDto, MeResponse } from '@poolmaster/shared/dto';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  timezone?: string | null;
  locale?: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
}

export function toUserProfileDto(user: UserRow): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone ?? undefined,
    locale: user.locale ?? undefined,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAuthResponse(user: UserRow, tokens: TokenPair): AuthResponse {
  return {
    user: toUserProfileDto(user),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken: tokens.csrfToken,
      expiresIn: tokens.expiresIn,
    },
  };
}

export function toMeResponse(user: UserRow): MeResponse {
  return {
    user: toUserProfileDto(user),
  };
}
