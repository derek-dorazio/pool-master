/**
 * Which categories of email a member gets (#844 slice 5, plans/email-delivery-ses.md §7, Q7.1):
 * one switch per category a member can turn off, the same for every league, set on their account
 * or by an email's one-click unsubscribe. Account and membership emails have no switch.
 *
 * Who may read or change whose switches is the users module's rule (A6); this service is handed a
 * user it may act on, except for an unsubscribe, whose token is its whole authority.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { EmailOptOutRepository, EmailSuppressionRepository, UserRepository } from '@poolmaster/shared/db';
import {
  OptionalEmailCategory,
  type EmailSuppressionReason,
  type User,
} from '@poolmaster/shared/domain';
import type { UnsubscribeTokens } from './unsubscribe-tokens';

export interface EmailPreferences {
  preferences: { category: OptionalEmailCategory; enabled: boolean }[];
  /** Why the account's address gets no email at all, when it bounced for good or complained. */
  emailSuppression: EmailSuppressionReason | null;
}

export class EmailUnsubscribeLinkInvalidError extends Error {
  readonly code = 'EMAIL_UNSUBSCRIBE_LINK_INVALID';

  constructor() {
    super('This unsubscribe link is not valid.');
    this.name = 'EmailUnsubscribeLinkInvalidError';
  }
}

export interface EmailPreferencesServiceOptions {
  users: Pick<UserRepository, 'findById'>;
  optOuts: EmailOptOutRepository;
  suppressions: Pick<EmailSuppressionRepository, 'findByEmail'>;
  tokens: UnsubscribeTokens;
  logger?: FastifyBaseLogger;
}

export class EmailPreferencesService {
  constructor(private readonly options: EmailPreferencesServiceOptions) {}

  async read(user: User): Promise<EmailPreferences> {
    const [optedOut, suppression] = await Promise.all([
      this.options.optOuts.findByUser(user.id),
      this.options.suppressions.findByEmail(user.email),
    ]);
    return {
      preferences: Object.values(OptionalEmailCategory).map((category) => ({
        category,
        enabled: !optedOut.includes(category),
      })),
      emailSuppression: suppression?.suppressionReason ?? null,
    };
  }

  async set(user: User, category: OptionalEmailCategory, enabled: boolean, logger = this.options.logger): Promise<EmailPreferences> {
    await this.options.optOuts.setOptedOut(user.id, category, !enabled);
    logger?.info({
      action: 'emailPreferences.set',
      data: { userId: user.id, category, enabled },
    }, enabled ? 'Turned a category of email on' : 'Turned a category of email off');
    return this.read(user);
  }

  /** Turns off the category an unsubscribe link names, for the user it names. */
  async unsubscribe(token: string, logger = this.options.logger): Promise<OptionalEmailCategory> {
    const target = this.options.tokens.read(token);
    // A link for an account since deleted is as dead as a forged one.
    const user = target ? await this.options.users.findById(target.userId) : null;
    if (!target || !user) {
      logger?.warn({ action: 'emailPreferences.unsubscribe.invalid' }, 'Refused an unsubscribe link this app did not issue');
      throw new EmailUnsubscribeLinkInvalidError();
    }
    await this.options.optOuts.setOptedOut(user.id, target.category, true);
    logger?.info({
      action: 'emailPreferences.unsubscribe',
      data: { userId: user.id, category: target.category },
    }, 'Unsubscribed from a category of email by its link');
    return target.category;
  }
}
