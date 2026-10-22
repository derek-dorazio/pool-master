/**
 * Password recovery by email (#847, plans/password-recovery.md).
 *
 * A person who forgot their password asks for a link by email or username, and the link sets a
 * new one. The link is the whole authority, so it is a random 256-bit token stored only as its
 * SHA-256, usable once, live for 10 minutes, and cancelled by a newer request or any password
 * change. SHA-256 is enough because the token has 256 bits of entropy; bcrypt is for
 * low-entropy secrets like passwords.
 *
 * The request never says whether an account matched: the handler answers before this service
 * looks anything up, and every outcome here (sent, no match, over the per-account limit, send
 * failed) is only logged.
 */

import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import { PASSWORD_RESET_LINK_MINUTES, type ApiErrorCode } from '@poolmaster/shared/dto';
import { AccountEmailTemplateKey, type EmailService } from '../email';
import { cancelOpenPasswordResetTokens, revokeUserSessions } from '../users/user-lifecycle';
import { SlidingWindowRateLimiter } from '../../core/sliding-window-rate-limiter';
import { PasswordChangedNotifier } from './password-changed-notifier';

/** Reset emails one account may be sent per hour. Over it the request still answers 202. */
const RESET_EMAILS_PER_ACCOUNT_PER_HOUR = 3;
/** An account's reset rows older than this are deleted on its next request. */
const RESET_ROW_RETENTION_DAYS = 30;
/**
 * Per client address, per minute, per core-api task. The token's entropy, not this limit, is
 * what stops guessing, so a per-task ceiling (doubled with two tasks) is enough. Override with
 * `PASSWORD_RESET_REQUESTS_PER_MIN` and `PASSWORD_RESET_CONFIRMS_PER_MIN`, remembering they are
 * per process.
 */
const DEFAULT_REQUESTS_PER_MINUTE = 5;
const DEFAULT_CONFIRMS_PER_MINUTE = 10;
const BCRYPT_ROUNDS = 12;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export class PasswordResetError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'PasswordResetError';
  }
}

export interface PasswordResetServiceDeps {
  users: UserRepository;
  prisma: PrismaClient;
  email: EmailService;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
  now?: () => Date;
  requestsPerMinute?: number;
  confirmsPerMinute?: number;
}

export class PasswordResetService {
  private readonly now: () => Date;
  private readonly requestLimiter: SlidingWindowRateLimiter;
  private readonly confirmLimiter: SlidingWindowRateLimiter;
  private readonly passwordChanged: PasswordChangedNotifier;

  constructor(private readonly deps: PasswordResetServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.passwordChanged = new PasswordChangedNotifier(
      deps.users,
      deps.email,
      deps.appBaseUrl,
      deps.logger,
    );
    const nowMs = () => this.now().getTime();
    this.requestLimiter = new SlidingWindowRateLimiter(
      deps.requestsPerMinute
        ?? readPerMinuteLimit('PASSWORD_RESET_REQUESTS_PER_MIN', DEFAULT_REQUESTS_PER_MINUTE),
      MINUTE_MS,
      nowMs,
    );
    this.confirmLimiter = new SlidingWindowRateLimiter(
      deps.confirmsPerMinute
        ?? readPerMinuteLimit('PASSWORD_RESET_CONFIRMS_PER_MIN', DEFAULT_CONFIRMS_PER_MINUTE),
      MINUTE_MS,
      nowMs,
    );
  }

  /** Throws `PASSWORD_RESET_RATE_LIMITED` when this address has asked for too many links. */
  assertRequestAllowed(clientAddress: string): void {
    this.assertAddressAllowed(this.requestLimiter, clientAddress, 'request');
  }

  /** Throws `PASSWORD_RESET_RATE_LIMITED` when this address has tried too many links. */
  assertConfirmAllowed(clientAddress: string): void {
    this.assertAddressAllowed(this.confirmLimiter, clientAddress, 'confirm');
  }

  /**
   * Issues a link and emails it, when `identifier` (already trimmed and lower-cased by the DTO)
   * names an account with a password that is under its hourly limit. Never throws for any of
   * those outcomes and never reports which one happened, so the caller can answer the same way
   * for all of them.
   */
  async requestReset(identifier: string): Promise<void> {
    const logger = this.deps.logger;
    try {
      const user = await this.deps.users.findByIdentifier(identifier);
      if (!user) {
        logger?.warn({
          action: 'authService.passwordReset.unmatched',
        }, 'Password reset requested for no matching account');
        return;
      }
      const credentials = await this.deps.prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (!credentials?.passwordHash) {
        logger?.warn({
          action: 'authService.passwordReset.passwordless',
          data: { userId: user.id },
        }, 'Password reset requested for an account that signs in without a password');
        return;
      }

      const now = this.now();
      const issuedThisHour = await this.deps.prisma.passwordResetToken.count({
        where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      });
      if (issuedThisHour >= RESET_EMAILS_PER_ACCOUNT_PER_HOUR) {
        logger?.warn({
          action: 'authService.passwordReset.accountRateLimited',
          data: { userId: user.id, issuedThisHour },
        }, 'Password reset not sent: account is over its hourly limit');
        return;
      }

      const token = randomBytes(32).toString('base64url');
      await this.deps.prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.deleteMany({
          where: {
            userId: user.id,
            createdAt: { lt: new Date(now.getTime() - RESET_ROW_RETENTION_DAYS * DAY_MS) },
          },
        });
        // One live link per account: a new request cancels the earlier ones.
        await cancelOpenPasswordResetTokens(tx, user.id, now);
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashResetToken(token),
            expiresAt: new Date(now.getTime() + PASSWORD_RESET_LINK_MINUTES * MINUTE_MS),
            createdAt: now,
          },
        });
      });
      logger?.info({
        action: 'authService.passwordReset.requested',
        data: { userId: user.id },
      }, 'Issued password reset link');

      // Sent now, not queued: the link is dead in 10 minutes.
      const delivery = await this.deps.email.send(AccountEmailTemplateKey.PASSWORD_RESET, {
        to: { email: user.email, timeZone: user.timezone },
        data: {
          firstName: user.firstName,
          username: user.username,
          resetUrl: buildResetUrl(this.deps.appBaseUrl, token),
          expiresInMinutes: PASSWORD_RESET_LINK_MINUTES,
        },
      });
      if (delivery.skipped) {
        logger?.warn({
          action: 'authService.passwordReset.emailSkipped',
          data: { userId: user.id, reason: delivery.skipped },
        }, 'Password reset email skipped by email settings');
        return;
      }
      logger?.info({
        action: 'authService.passwordReset.emailSent',
        data: { userId: user.id },
      }, 'Handed password reset email to mail delivery');
    } catch (err) {
      // The caller has already been answered; a failure here only ever reaches the log.
      logger?.error({
        action: 'authService.passwordReset.requestFailed',
        err,
      }, 'Password reset request failed after the reply');
    }
  }

  /**
   * Sets a new password with a live link, then cancels the account's other links and signs it
   * out everywhere, all in one transaction. Unknown, used, cancelled and expired links are one
   * answer, `PASSWORD_RESET_LINK_INVALID`: telling them apart helps nobody and leaks a little.
   */
  async confirmReset(token: string, newPassword: string, confirmNewPassword: string): Promise<void> {
    if (newPassword !== confirmNewPassword) {
      throw new PasswordResetError(
        'New password confirmation does not match.',
        'PASSWORD_CONFIRMATION_MISMATCH',
        400,
      );
    }
    const tokenHash = hashResetToken(token);
    const now = this.now();
    // A cheap look before the costly hash, so dead links do not pay for bcrypt. The conditional
    // claim below is still what guards the race.
    const live = await this.deps.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (!live) this.rejectDeadLink();
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const userId = await this.deps.prisma.$transaction(async (tx) => {
      // The claim and the check are one statement, so two clicks at once cannot both win.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      const { userId: claimedUserId } = await tx.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash },
        select: { userId: true },
      });
      await tx.user.update({ where: { id: claimedUserId }, data: { passwordHash } });
      await cancelOpenPasswordResetTokens(tx, claimedUserId, now);
      await revokeUserSessions(tx, claimedUserId);
      return claimedUserId;
    });

    if (!userId) this.rejectDeadLink();
    this.deps.logger?.info({
      action: 'authService.passwordReset.confirmed',
      data: { userId },
    }, 'Reset password with a reset link and signed the account out everywhere');
    await this.passwordChanged.notify(userId, now);
  }

  private rejectDeadLink(): never {
    this.deps.logger?.warn({
      action: 'authService.passwordReset.linkInvalid',
    }, 'Rejected password reset with a dead link');
    throw new PasswordResetError(
      'This reset link has expired or has already been used.',
      'PASSWORD_RESET_LINK_INVALID',
      400,
    );
  }

  private assertAddressAllowed(
    limiter: SlidingWindowRateLimiter,
    clientAddress: string,
    step: 'request' | 'confirm',
  ): void {
    const { allowed } = limiter.hit(clientAddress);
    if (allowed) return;
    this.deps.logger?.warn({
      action: 'authService.passwordReset.rateLimited',
      data: { step },
    }, 'Rejected password reset call: too many from this address');
    throw new PasswordResetError(
      'Too many tries. Wait a minute and try again.',
      'PASSWORD_RESET_RATE_LIMITED',
      429,
    );
  }
}

/** The stored form of a reset token: SHA-256, hex. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The token rides in the URL fragment, which browsers never send to a server, so it stays out of
 * CloudFront and API logs and out of `Referer` headers.
 */
function buildResetUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/reset-password#token=${token}`;
}

function readPerMinuteLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a whole number of at least 1, got "${raw}".`);
  }
  return parsed;
}
