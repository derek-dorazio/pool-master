/**
 * Auth mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  AuthResponse,
  AuthenticatedSessionUserDto,
  MeResponse,
  TokenRefreshResponse,
  UserProfileDto,
} from '@poolmaster/shared/dto';
import type { DateFormat, TimeFormat } from '@poolmaster/shared/domain';

interface UserRow {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  timezone?: string | null;
  locale?: string | null;
  timeFormat?: TimeFormat | null;
  dateFormat?: DateFormat | null;
  createdAt: Date;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  sessionId: string;
}

export function toUserProfileDto(user: UserRow): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    isRootAdmin: user.isRootAdmin,
    timezone: user.timezone ?? undefined,
    locale: user.locale ?? undefined,
    timeFormat: user.timeFormat ?? undefined,
    dateFormat: user.dateFormat ?? undefined,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAuthenticatedSessionUserDto(
  user: UserRow,
  sessionId: string,
): AuthenticatedSessionUserDto {
  return {
    ...toUserProfileDto(user),
    sessionId,
  };
}

export function toAuthResponse(user: UserRow, tokens: TokenPair): AuthResponse {
  return {
    user: toAuthenticatedSessionUserDto(user, tokens.sessionId),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken: tokens.csrfToken,
      expiresIn: tokens.expiresIn,
    },
  };
}

export function toMeResponse(user: UserRow, sessionId: string): MeResponse {
  return {
    user: toAuthenticatedSessionUserDto(user, sessionId),
  };
}

export function toTokenRefreshResponse(tokens: TokenPair): TokenRefreshResponse {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    csrfToken: tokens.csrfToken,
    expiresIn: tokens.expiresIn,
    sessionId: tokens.sessionId,
  };
}
