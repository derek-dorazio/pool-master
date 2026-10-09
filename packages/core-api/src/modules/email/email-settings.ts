/**
 * EMAIL_CONFIG (#450): whether system email is sent, which templates are on, and the Reply-To
 * address. Root admins change it on /manage/settings; every core-api task sees a save within
 * the settings refresh. Transport and sender address stay in env (`EMAIL_PROVIDER`, `SMTP_*`,
 * `SES_*`), since they describe how the deployment is wired.
 */

import type { FastifyBaseLogger } from 'fastify';
import { EmailConfigSchema, EmailTemplateKeySchema } from '@poolmaster/shared/dto';
import type { EmailConfig } from '@poolmaster/shared/dto';
import { AppEnvironment, readAppEnv } from '../../core/config';
import { defineSettingsGroup } from '../platform/settings-group';
import type {
  MailDeliveryMessage,
  MailDeliveryProvider,
  MailDeliveryResult,
} from './mail-delivery';

export const EMAIL_SETTINGS = defineSettingsGroup<EmailConfig>({
  key: 'EMAIL_CONFIG',
  title: 'Email',
  description: 'Whether system email is sent, which emails, and their Reply-To address.',
  schema: EmailConfigSchema,
  // QA sends nothing until real delivery is set up (#120); everywhere else must send.
  defaults: (env) => ({
    enabled: readAppEnv(env) !== AppEnvironment.QA,
    replyTo: null,
    templates: {
      LEAGUE_MEMBER_INVITE: true,
      LEAGUE_JOIN_SUCCESS: true,
      CONTEST_ENTRY_COMPLETED: true,
      CONTEST_STARTED_SUMMARY: true,
    },
  }),
});

/** What a route module that sends email is registered with: the app's one mail delivery. */
export interface MailModuleOptions {
  mailDelivery: MailDeliveryProvider;
}

/**
 * Wraps the transport and checks EMAIL_CONFIG on every send. An email that is switched off is
 * skipped and logged with ids only, never the body, and still reports success, so invite by
 * email creates the invitation either way.
 */
export class SettingsAwareMailDeliveryProvider implements MailDeliveryProvider {
  constructor(
    private readonly transport: MailDeliveryProvider,
    private readonly readConfig: () => EmailConfig,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  get providerName() {
    return this.transport.providerName;
  }

  send(message: MailDeliveryMessage): Promise<MailDeliveryResult> {
    const config = this.readConfig();
    const skipped = skipReason(config, message.metadata?.templateKey);
    if (skipped) {
      this.logger?.info({
        action: 'mailDelivery.skip',
        data: {
          reason: skipped,
          toCount: (Array.isArray(message.to) ? message.to : [message.to]).length,
          templateKey: message.metadata?.templateKey ?? null,
          leagueId: message.metadata?.leagueId ?? null,
          contestId: message.metadata?.contestId ?? null,
          entryId: message.metadata?.entryId ?? null,
          invitationId: message.metadata?.invitationId ?? null,
        },
      }, 'Email is switched off in settings; skipped sending email');
      return Promise.resolve({ provider: this.transport.providerName, skipped });
    }
    return this.transport.send({
      ...message,
      replyTo: message.replyTo ?? config.replyTo ?? undefined,
    });
  }
}

function skipReason(
  config: EmailConfig,
  templateKey: string | undefined,
): MailDeliveryResult['skipped'] {
  if (!config.enabled) return 'emailDisabled';
  const template = EmailTemplateKeySchema.safeParse(templateKey);
  if (template.success && !config.templates[template.data]) return 'templateDisabled';
  return undefined;
}
