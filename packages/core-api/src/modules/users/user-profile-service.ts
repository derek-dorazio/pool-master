/**
 * The `User` profile write operations — one implementation, either caller (#202 step 3.3).
 *
 * `docs/DOMAIN-OPERATIONS.md` says "Update profile, username, preferences | `self`,
 * `rootAdmin` | A6": **one operation whose scope is a parameter**, not two operations. The
 * code had only the `self` half, inside `account/service.ts`, where the authority rule was
 * implicit in the route rather than stated anywhere. So a root admin correcting a user's
 * misspelled email had nothing to call, and the rule the document states had no
 * implementation to point at.
 *
 * Here it is stated once, in `requireWritableUser`, and the two identity-uniqueness checks —
 * previously two near-identical private methods differing only in which field they named
 * first — are one, over `UserRepository.findByIdentifier`.
 *
 * Step 3.4 folds the remaining admin and account User operations into this module; the
 * lifecycle mechanics they share already live in `user-lifecycle.ts`.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import type { DateFormat, TimeFormat, User } from '@poolmaster/shared/domain';
import { UserOperationError } from './user-errors';

/** Who is asking. Both fields come straight off the authenticated request. */
export interface UserWriteActor {
  userId: string;
  isRootAdmin: boolean;
}

export interface UserProfileUpdate {
  firstName: string;
  lastName: string;
  email: string;
}

export interface UserPreferencesUpdate {
  timezone?: string | null;
  locale?: string | null;
  timeFormat?: TimeFormat | null;
  dateFormat?: DateFormat | null;
}

export class UserProfileService {
  constructor(
    private readonly users: UserRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async updateProfile(
    actor: UserWriteActor,
    targetUserId: string,
    updates: UserProfileUpdate,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);
    const email = updates.email.trim().toLowerCase();
    await this.assertIdentifierAvailable(email, user.id, 'ACCOUNT_EMAIL_TAKEN');

    const updated = await this.users.update(user.id, {
      email,
      firstName: updates.firstName.trim(),
      lastName: updates.lastName.trim(),
    });
    this.logger?.info({
      action: 'userProfileService.updateProfile.success',
      data: { userId: updated.id, actorUserId: actor.userId },
    }, 'Updated user profile');
    return updated;
  }

  async updateUsername(
    actor: UserWriteActor,
    targetUserId: string,
    username: string,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);
    const normalized = username.trim().toLowerCase();
    await this.assertIdentifierAvailable(normalized, user.id, 'ACCOUNT_USERNAME_TAKEN');

    const updated = await this.users.update(user.id, { username: normalized });
    this.logger?.info({
      action: 'userProfileService.updateUsername.success',
      data: { userId: updated.id, actorUserId: actor.userId },
    }, 'Updated user username');
    return updated;
  }

  async updatePreferences(
    actor: UserWriteActor,
    targetUserId: string,
    updates: UserPreferencesUpdate,
  ): Promise<User> {
    const user = await this.requireWritableUser(actor, targetUserId);

    // `undefined` means "leave it"; `null` means "clear it". The port keeps that distinction,
    // so this passes the caller's intent straight through.
    const updated = await this.users.update(user.id, {
      ...(updates.timezone !== undefined && { timezone: normalizeOptional(updates.timezone) }),
      ...(updates.locale !== undefined && { locale: normalizeOptional(updates.locale) }),
      ...(updates.timeFormat !== undefined && { timeFormat: updates.timeFormat }),
      ...(updates.dateFormat !== undefined && { dateFormat: updates.dateFormat }),
    });
    this.logger?.info({
      action: 'userProfileService.updatePreferences.success',
      data: { userId: updated.id, actorUserId: actor.userId },
    }, 'Updated user preferences');
    return updated;
  }

  /**
   * Access rule A6: a `User` is written by themselves or by a root admin. A commissioner has
   * no write row here.
   *
   * Note what is NOT checked: `isActive`. Per A9 `isActive` is a read filter, not a write
   * lock, so an inactive account can still correct its own details — which is the
   * precondition for reactivating it, not a reason to freeze it.
   */
  private async requireWritableUser(actor: UserWriteActor, targetUserId: string): Promise<User> {
    if (actor.userId !== targetUserId && !actor.isRootAdmin) {
      this.logger?.warn({
        action: 'userProfileService.forbidden',
        data: { userId: targetUserId, actorUserId: actor.userId },
      }, 'Rejected user write by a caller who is neither the subject nor a root admin');
      throw new UserOperationError(
        'You may only change your own account.',
        'USER_WRITE_FORBIDDEN',
        403,
      );
    }

    const user = await this.users.findById(targetUserId);
    if (!user) {
      throw new UserOperationError('User not found', 'USER_NOT_FOUND', 404);
    }
    return user;
  }

  /**
   * Rejects an email or username already held by someone else.
   *
   * One check for both, because both columns are `@unique` and login accepts either: a
   * username that matches another account's email is just as unusable as a duplicate
   * username. `account/service.ts` had this twice, as `assertEmailAvailableForUser` and
   * `assertUsernameAvailableForUser`, identical but for the order of the `OR` arms.
   */
  private async assertIdentifierAvailable(
    identifier: string,
    targetUserId: string,
    code: 'ACCOUNT_EMAIL_TAKEN' | 'ACCOUNT_USERNAME_TAKEN',
  ): Promise<void> {
    const holder = await this.users.findByIdentifier(identifier);
    if (!holder || holder.id === targetUserId) {
      return;
    }

    this.logger?.warn({
      action: 'userProfileService.identifierTaken',
      errorCode: code,
      data: { userId: targetUserId, conflictingUserId: holder.id },
    }, 'Rejected user write because the identifier is already in use');
    throw new UserOperationError(
      code === 'ACCOUNT_EMAIL_TAKEN'
        ? 'That email address is already in use. Choose another email address.'
        : 'That username is already taken. Choose another username.',
      code,
      409,
    );
  }
}

function normalizeOptional(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
