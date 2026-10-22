/**
 * The "your password was changed" email (#848, plans/password-recovery.md Q5.1). It tells a
 * person whose account was taken over that something happened, so it goes after a reset by link
 * and after an own password change, but not after a root admin's reset, which already involves
 * a person.
 *
 * Queued after the password write has committed. A failure is logged and never undoes the change
 * or reaches the caller: the password is already changed either way.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import { EmailMessageStatus, EmailTemplateKey } from '@poolmaster/shared/domain';
import type { EmailService } from '../email';

export class PasswordChangedNotifier {
  constructor(
    private readonly users: UserRepository,
    private readonly email: EmailService,
    private readonly appBaseUrl: string,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async notify(userId: string, changedAt: Date): Promise<void> {
    try {
      const user = await this.users.findById(userId);
      if (!user) return;
      const email = await this.email.send(EmailTemplateKey.PASSWORD_CHANGED, {
        to: { email: user.email, userId: user.id, timeZone: user.timezone },
        // One email per change: the outbox records an email once per template, about and recipient.
        about: changedAt.toISOString(),
        data: {
          firstName: user.firstName,
          username: user.username,
          changedAt,
          forgotPasswordUrl: `${this.appBaseUrl}/forgot-password`,
        },
      });
      if (email.status === EmailMessageStatus.SKIPPED) {
        this.logger?.warn({
          action: 'authService.passwordChanged.emailSkipped',
          data: { userId, reason: email.skipReason },
        }, 'Password changed email skipped by email settings or the allow list');
        return;
      }
      this.logger?.info({
        action: 'authService.passwordChanged.emailQueued',
        data: { userId },
      }, 'Queued password changed email');
    } catch (err) {
      this.logger?.error({
        action: 'authService.passwordChanged.emailFailed',
        data: { userId },
        err,
      }, 'Password changed email failed; the password change stands');
    }
  }
}
