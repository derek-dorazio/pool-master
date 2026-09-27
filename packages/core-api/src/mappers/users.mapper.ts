/**
 * The one `User` → `UserDto` projection (#202 step 3.4).
 *
 * There were FOUR before this: `auth.mapper.ts`'s `toUserDto` over a Prisma-shaped row,
 * `account.mapper.ts`'s `mapAccountUserToDto`, a private one in `admin/user-handler.ts`, and
 * `auth-service.ts`'s `mapUserProfile` producing a `UserProfile` that was a fifth User shape.
 * Three of the four also carried their own copy of the row→domain enum mapping, which belongs
 * at the row boundary — the adapter — and nowhere else.
 *
 * It takes the canonical domain `User`, which every producer now has: both User services and
 * `AuthService` read through `UserRepository`.
 */
import type { User } from '@poolmaster/shared/domain';
import type { UserDto } from '@poolmaster/shared/dto';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    // Optional on the domain type because a row may not carry it; the DTO states it either
    // way, because "we do not know whether you are an admin" is not a thing a client can act on.
    isRootAdmin: user.isRootAdmin === true,
    authProvider: user.authProvider,
    timezone: user.timezone,
    locale: user.locale,
    timeFormat: user.timeFormat,
    dateFormat: user.dateFormat,
    createdAt: user.createdAt.toISOString(),
  };
}
