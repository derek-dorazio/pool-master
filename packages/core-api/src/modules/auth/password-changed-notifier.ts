/**
 * The "your password was changed" email (#848, plans/password-recovery.md Q5.1). It tells a
 * person whose account was taken over that something happened, so it goes after a reset by link
 * and after an own password change, but not after a root admin's reset, which already involves
 * a person.
 *
 * Sent after the password write has committed. A failure is logged and never undoes the change
 * or reaches the caller: the password is already changed either way.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { UserRepository } from '@poolmaster/shared/db';
import { AccountEmailTemplateKey, type EmailService } from '../email';

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
      const delivery = await this.email.send(AccountEmailTemplateKey.PASSWORD_CHANGED, {
        to: { email: user.email, timeZone: user.timezone },
        data: {
          firstName: user.firstName,
          username: user.username,
          changedAt,
          forgotPasswordUrl: `${this.appBaseUrl}/forgot-password`,
        },
      });
      if (delivery.skipped) {
        this.logger?.warn({
          action: 'authService.passwordChanged.emailSkipped',
          data: { userId, reason: delivery.skipped },
        }, 'Password changed email skipped by email settings');
        return;
      }
      this.logger?.info({
        action: 'authService.passwordChanged.emailSent',
        data: { userId },
      }, 'Handed password changed email to mail delivery');
    } catch (err) {
      this.logger?.error({
        action: 'authService.passwordChanged.emailFailed',
        data: { userId },
        err,
      }, 'Password changed email failed; the password change stands');
    }
  }
}
