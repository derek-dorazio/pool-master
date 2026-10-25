/**
 * The "your email address was changed" email and its undo link (#903 A5).
 *
 * When an account's email changes, the old address hears about it, as it is the one place
 * someone who took the account over can't read. A password reset can't be its "wasn't you?" link:
 * a reset goes to the account's address, which is now the new one. So the email carries its own
 * link, which puts the old address back, replaces the password with a random one nobody knows
 * (whoever changed the address knew the old one) and signs the account out everywhere; the person
 * then sets a new password through the usual reset, which now reaches them.
 *
 * The link is a random 256-bit token stored only as its SHA-256, like a reset link, usable once
 * and live for 7 days. Using one cancels the account's links from later changes, so whoever made
 * a later change can't undo the undo; a link from an earlier change still works, so changing the
 * address twice can't shut the first owner out.
 *
 * The email is queued after the change has committed. A failure is logged and never undoes the
 * change or reaches the caller.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import { EMAIL_CHANGE_UNDO_LINK_DAYS, type ApiErrorCode } from '@poolmaster/shared/dto';
import { EmailMessageStatus, EmailTemplateKey, type User } from '@poolmaster/shared/domain';
import type { EmailChangedBy, EmailService } from '../email';
import { cancelOpenPasswordResetTokens, revokeUserSessions } from '../users/user-lifecycle';
import { SlidingWindowRateLimiter } from '../../core/sliding-window-rate-limiter';
import { BCRYPT_ROUNDS, hashResetToken, readPerMinuteLimit } from './password-reset-service';

/** An account's undo rows older than this are deleted on its next email change. */
const UNDO_ROW_RETENTION_DAYS = 30;
/**
 * Per client address, per minute, per core-api task. As with reset links, the token's entropy is
 * what stops guessing. Override with `EMAIL_CHANGE_UNDOS_PER_MIN`.
 */
const DEFAULT_UNDOS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export class EmailChangeUndoError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EmailChangeUndoError';
  }
}

export interface EmailChange {
  /** The account after the change. */
  user: User;
  oldEmail: string;
  changedBy: EmailChangedBy;
  changedAt: Date;
}

export interface EmailChangeUndoServiceDeps {
  users: Pick<UserRepository, 'findHolderOtherThan'>;
  prisma: PrismaClient;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
  now?: () => Date;
  undosPerMinute?: number;
}

export class EmailChangeUndoService {
  private readonly now: () => Date;
  private readonly undoLimiter: SlidingWindowRateLimiter;

  constructor(private readonly deps: EmailChangeUndoServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.undoLimiter = new SlidingWindowRateLimiter(
      deps.undosPerMinute ?? readPerMinuteLimit('EMAIL_CHANGE_UNDOS_PER_MIN', DEFAULT_UNDOS_PER_MINUTE),
      MINUTE_MS,
      () => this.now().getTime(),
    );
  }

  /** Issues an undo link for `change` and emails it to the old address. Never throws. */
  async tellOldAddress(change: EmailChange): Promise<void> {
    const { user, oldEmail, changedBy, changedAt } = change;
    try {
      const token = randomBytes(32).toString('base64url');
      const issued = await this.deps.prisma.$transaction(async (tx) => {
        await tx.emailChangeUndoToken.deleteMany({
          where: { userId: user.id, createdAt: { lt: new Date(changedAt.getTime() - UNDO_ROW_RETENTION_DAYS * DAY_MS) } },
        });
        return tx.emailChangeUndoToken.create({
          select: { id: true },
          data: {
            userId: user.id,
            tokenHash: hashResetToken(token),
            oldEmail,
            expiresAt: new Date(changedAt.getTime() + EMAIL_CHANGE_UNDO_LINK_DAYS * DAY_MS),
            createdAt: changedAt,
          },
        });
      });
      const email = await this.deps.email.send(EmailTemplateKey.EMAIL_CHANGED, {
        to: { email: oldEmail, userId: user.id, timeZone: user.timezone },
        about: issued.id,
        data: {
          firstName: user.firstName,
          username: user.username,
          newEmail: user.email,
          changedAt,
          changedBy,
          undoUrl: buildUndoUrl(this.deps.appBaseUrl, token),
          undoDays: EMAIL_CHANGE_UNDO_LINK_DAYS,
        },
      });
      if (email.status === EmailMessageStatus.SKIPPED) {
        this.deps.logger?.warn({
          action: 'userService.emailChanged.emailSkipped',
          data: { userId: user.id, reason: email.skipReason },
        }, 'Email changed email skipped by email settings or the allow list');
        return;
      }
      this.deps.logger?.info({
        action: 'userService.emailChanged.emailQueued',
        data: { userId: user.id, changedBy },
      }, 'Queued email changed email to the old address');
    } catch (err) {
      this.deps.logger?.error({
        action: 'userService.emailChanged.emailFailed',
        data: { userId: user.id },
        err,
      }, 'Email changed email failed; the email change stands');
    }
  }

  /** Throws `EMAIL_CHANGE_UNDO_RATE_LIMITED` when this address has tried too many links. */
  assertUndoAllowed(clientAddress: string): void {
    if (this.undoLimiter.hit(clientAddress).allowed) return;
    this.deps.logger?.warn({
      action: 'authService.emailChangeUndo.rateLimited',
    }, 'Rejected email change undo: too many from this address');
    throw new EmailChangeUndoError('Too many tries. Wait a minute and try again.', 'EMAIL_CHANGE_UNDO_RATE_LIMITED', 429);
  }

  /**
   * Puts back the address a live link was sent to, replaces the password with a random one, cancels
   * the links from later changes and the open reset links, and signs the account out everywhere,
   * in one transaction. Unknown, used, cancelled and expired links are one answer,
   * `EMAIL_CHANGE_UNDO_LINK_INVALID`.
   */
  async undo(token: string): Promise<void> {
    const tokenHash = hashResetToken(token);
    const now = this.now();
    const live = { tokenHash, usedAt: null, cancelledAt: null, expiresAt: { gt: now } };
    const link = await this.deps.prisma.emailChangeUndoToken.findFirst({
      where: live,
      select: { userId: true, oldEmail: true },
    });
    if (!link) this.rejectDeadLink();
    // Login takes an email or a username, so the address must be neither for any other account.
    if (await this.deps.users.findHolderOtherThan(link.oldEmail, link.userId)) this.rejectTakenAddress(link.userId);
    // Hashed before the transaction, as bcrypt is slow. Not a null hash: a reset treats an account
    // without one as passwordless and sends nothing.
    const unknownPasswordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);

    let undone: boolean;
    try {
      undone = await this.deps.prisma.$transaction(async (tx) => {
        // The claim and the check are one statement, so two clicks at once cannot both win.
        const claimed = await tx.emailChangeUndoToken.updateMany({ where: live, data: { usedAt: now } });
        if (claimed.count !== 1) return false;
        const { createdAt } = await tx.emailChangeUndoToken.findUniqueOrThrow({ where: { tokenHash }, select: { createdAt: true } });
        await tx.emailChangeUndoToken.updateMany({
          where: { userId: link.userId, usedAt: null, cancelledAt: null, createdAt: { gte: createdAt } },
          data: { cancelledAt: now },
        });
        await tx.user.update({ where: { id: link.userId }, data: { email: link.oldEmail } });
        // An account that signs in without a password stays without one.
        await tx.user.updateMany({ where: { id: link.userId, passwordHash: { not: null } }, data: { passwordHash: unknownPasswordHash } });
        await cancelOpenPasswordResetTokens(tx, link.userId, now);
        await revokeUserSessions(tx, link.userId);
        return true;
      });
    } catch (err) {
      // Another account took the address between the check above and this write.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') this.rejectTakenAddress(link.userId);
      throw err;
    }
    if (!undone) this.rejectDeadLink();
    this.deps.logger?.info({
      action: 'authService.emailChangeUndo.confirmed',
      data: { userId: link.userId },
    }, 'Put back the old email address, replaced the password and signed the account out everywhere');
  }

  private rejectTakenAddress(userId: string): never {
    this.deps.logger?.warn({
      action: 'authService.emailChangeUndo.addressTaken',
      data: { userId },
    }, 'Rejected email change undo: another account has the old address now');
    throw new EmailChangeUndoError(
      'Another account uses that email address now, so it can\'t be put back.',
      'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN',
      409,
    );
  }

  private rejectDeadLink(): never {
    this.deps.logger?.warn({
      action: 'authService.emailChangeUndo.linkInvalid',
    }, 'Rejected email change undo with a dead link');
    throw new EmailChangeUndoError(
      'This link has expired or has already been used.',
      'EMAIL_CHANGE_UNDO_LINK_INVALID',
      400,
    );
  }
}

/** The token rides in the URL fragment, as a reset link's does, so it stays out of server logs. */
function buildUndoUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/undo-email-change#token=${token}`;
}
