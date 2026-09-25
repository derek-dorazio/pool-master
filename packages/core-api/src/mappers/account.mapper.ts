import {
  UserAuthProvider as PrismaUserAuthProvider,
  UserDateFormat as PrismaUserDateFormat,
  UserTimeFormat as PrismaUserTimeFormat,
} from '@prisma/client';
import type { AccountResponse, UserProfileDto } from '@poolmaster/shared/dto';
import { AuthProvider, DateFormat, TimeFormat } from '@poolmaster/shared/domain';

interface UserRow {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  authProvider?: PrismaUserAuthProvider | null;
  timezone?: string | null;
  locale?: string | null;
  timeFormat?: PrismaUserTimeFormat | null;
  dateFormat?: PrismaUserDateFormat | null;
  createdAt: Date;
}

function mapAuthProvider(provider: PrismaUserAuthProvider | null | undefined): UserProfileDto['authProvider'] {
  if (provider === PrismaUserAuthProvider.EMAIL) return AuthProvider.EMAIL;
  if (provider === PrismaUserAuthProvider.GOOGLE) return AuthProvider.GOOGLE;
  if (provider === PrismaUserAuthProvider.APPLE) return AuthProvider.APPLE;
  return undefined;
}

function mapTimeFormat(format: PrismaUserTimeFormat | null | undefined): UserProfileDto['timeFormat'] {
  if (format === PrismaUserTimeFormat.TWELVE_HOUR) return TimeFormat.TWELVE_HOUR;
  if (format === PrismaUserTimeFormat.TWENTY_FOUR_HOUR) return TimeFormat.TWENTY_FOUR_HOUR;
  return undefined;
}

function mapDateFormat(format: PrismaUserDateFormat | null | undefined): UserProfileDto['dateFormat'] {
  if (format === PrismaUserDateFormat.MDY) return DateFormat.MDY;
  if (format === PrismaUserDateFormat.DMY) return DateFormat.DMY;
  if (format === PrismaUserDateFormat.YMD) return DateFormat.YMD;
  return undefined;
}

export function mapAccountUserToDto(user: UserRow): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
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
