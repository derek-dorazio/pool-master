import type { AccountResponse, UserProfileDto } from '@poolmaster/shared/dto';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isRootAdmin: boolean;
  authProvider?: string | null;
  timezone?: string | null;
  locale?: string | null;
  createdAt: Date;
}

function mapAuthProvider(provider: string | null | undefined): UserProfileDto['authProvider'] {
  if (provider === 'local') return 'email';
  if (provider === 'google') return 'google';
  if (provider === 'apple') return 'apple';
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
    avatarUrl: null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function mapAccountResponse(user: UserRow): AccountResponse {
  return {
    user: mapAccountUserToDto(user),
  };
}
