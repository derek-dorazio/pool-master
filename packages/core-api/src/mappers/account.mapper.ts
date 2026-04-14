import type { AccountResponse, UserProfileDto } from '@poolmaster/shared/dto';
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  authProvider?: string | null;
  timezone?: string | null;
  locale?: string | null;
  timeFormat?: string | null;
  dateFormat?: string | null;
  createdAt: Date;
}

function mapAuthProvider(provider: string | null | undefined): UserProfileDto['authProvider'] {
  if (provider === 'local') return AuthProvider.EMAIL;
  if (provider === 'google') return AuthProvider.GOOGLE;
  if (provider === 'apple') return AuthProvider.APPLE;
  return undefined;
}

function mapTimeFormat(format: string | null | undefined): UserProfileDto['timeFormat'] {
  if (format === TimeFormat.TWELVE_HOUR || format === TimeFormat.TWENTY_FOUR_HOUR) return format;
  return undefined;
}

function mapDateFormat(format: string | null | undefined): UserProfileDto['dateFormat'] {
  if (format === DateFormat.MDY || format === DateFormat.DMY || format === DateFormat.YMD) return format;
  return undefined;
}

export function mapAccountUserToDto(user: UserRow): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isActive: user.isActive,
    isRootAdmin: user.isRootAdmin,
    authProvider: mapAuthProvider(user.authProvider),
    timezone: user.timezone ?? undefined,
    locale: user.locale ?? undefined,
    timeFormat: mapTimeFormat(user.timeFormat),
    dateFormat: mapDateFormat(user.dateFormat),
    createdAt: user.createdAt.toISOString(),
  };
}

export function mapAccountResponse(user: UserRow): AccountResponse {
  return {
    user: mapAccountUserToDto(user),
  };
}
