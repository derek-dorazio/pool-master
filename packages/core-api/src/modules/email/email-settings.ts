/**
 * EMAIL_CONFIG (#450): whether system email is sent, which templates are on, and who it may go
 * to. Root admins change it on /manage/settings; every core-api task sees a save within the
 * settings refresh. Transport and sender address stay in env (`EMAIL_PROVIDER`, `SMTP_*`,
 * `SES_*`), since they describe how the deployment is wired. EmailService reads it on every
 * email it records, and the sender reads the rate on every batch.
 */

import { EmailConfigSchema } from '@poolmaster/shared/dto';
import type { EmailConfig } from '@poolmaster/shared/dto';
import { AppEnvironment, readAppEnv } from '../../core/config';
import { defineSettingsGroup } from '../platform/settings-group';
import type { EmailService } from './email-service';

export const EMAIL_SETTINGS = defineSettingsGroup<EmailConfig>({
  key: 'EMAIL_CONFIG',
  title: 'Email',
  description: 'Whether system email is sent, which emails, and who it may go to.',
  schema: EmailConfigSchema,
  // QA sends nothing until a root admin turns it on, normally with an allow list; everywhere else must send.
  defaults: (env) => ({
    enabled: readAppEnv(env) !== AppEnvironment.QA,
    allowedRecipients: [],
    sendRatePerSecond: 10,
    entryReminderHours: [48, 24, 3],
    standingsBufferMinutes: 30,
    weeklyDigestHour: 3,
    templates: {
      LEAGUE_MEMBER_INVITE: true,
      LEAGUE_JOIN_SUCCESS: true,
      SQUAD_OWNER_INVITE: true,
      SQUAD_OWNER_ADDED: true,
      CONTEST_ENTRY_COMPLETED: true,
      CONTEST_STARTED_SUMMARY: true,
      CONTEST_ENTRY_REMINDER: true,
      CONTEST_OPENED: true,
      CONTEST_STANDINGS: true,
      CONTEST_RESULTS: true,
      CONTEST_EVENT_CHANGED: true,
      EVENT_COMING_UP: true,
      EVENT_READY_FOR_CONTESTS: true,
      EVENT_WEEKLY_DIGEST: true,
      LEAGUE_MEMBER_JOINED: true,
      CONTEST_NOT_OPEN: true,
      EVENT_STILL_DRAFT: true,
      YEAR_IN_REVIEW: true,
    },
  }),
});

/** What a route module that sends email is registered with: the app's one email service. */
export interface MailModuleOptions {
  email: EmailService;
}
