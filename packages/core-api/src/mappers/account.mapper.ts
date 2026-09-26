import type { AccountResponse, UserProfileDto } from '@poolmaster/shared/dto';
import type { User } from '@poolmaster/shared/domain';

/**
 * Canonical `User` → the profile DTO.
 *
 * #202 — this took a Prisma row and held the THIRD copy of the row→domain enum mapping
 * (after `admin/user-service.ts` and `prisma-user-repository.ts`). Enum mapping belongs at
 * the row boundary, which is the adapter; by the time a user reaches a mapper it already
 * carries domain enums, so this is now a projection and nothing else.
 */
export function mapAccountUserToDto(user: User): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    isRootAdmin: user.isRootAdmin === true,
    authProvider: user.authProvider,
    timezone: user.timezone,
    locale: user.locale,
    timeFormat: user.timeFormat,
    dateFormat: user.dateFormat,
    createdAt: user.createdAt.toISOString(),
  };
}

export function mapAccountResponse(user: User): AccountResponse {
  return {
    user: mapAccountUserToDto(user),
  };
}
