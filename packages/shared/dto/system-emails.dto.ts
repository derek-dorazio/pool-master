/**
 * The root admin's Notifications page (#1870): every system email with how it has gone out in the
 * last 30 days, its latest send, and a copy of that send to the admin. The DTOs carry keys and
 * enums only; the email's name, audience and when it sends are product copy the web keeps.
 */
import { z } from 'zod';
import {
  EmailMessageStatus,
  EmailSkipReason,
  EmailTemplateKey,
  EmailTemplateStatus,
  LeaguePlan,
  PlanFeature,
} from '../domain/enums';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

export const SystemEmailTemplateKeySchema = z.enum(EmailTemplateKey).describe('The system email, by its template key.');

export const SystemEmailDtoSchema = z.object({
  templateKey: SystemEmailTemplateKeySchema,
  planFeature: z.enum(PlanFeature).nullable().describe(
    'The plan feature a league needs to get this email, or null for an email every league gets '
    + '(account, membership and root admin email).',
  ),
  planStartsAt: z.enum(LeaguePlan).nullable().describe(
    'The lowest plan with planFeature under the current plan settings; every plan above it has it too. Null when planFeature is null.',
  ),
  status: z.enum(EmailTemplateStatus).describe(
    'ON or OFF by the email\'s own switch in the EMAIL_CONFIG settings (change it with the settings update), '
    + 'or ALWAYS_ON for an email with no switch (account emails and the test email), which only the overall switch stops.',
  ),
  sentLast30Days: z.number().int().min(0).describe(
    'How many of this email the transport accepted in the last 30 days, whatever SES reported after.',
  ),
  lastSentAt: DateTimeSchema.nullable().describe('When the last one was sent in the last 30 days, or null.'),
  previewSentAt: DateTimeSchema.nullable().describe(
    'When the send a preview shows went: the newest in the last 30 days whose content the outbox still keeps. '
    + 'Null when there is none (never sent, content cleared 7 days after sending, or an email that carries a secret and keeps none); '
    + 'the latest send and resend routes answer 404 SYSTEM_EMAIL_NOT_SENT then.',
  ),
}).describe('One system email on the Notifications page.');
export type SystemEmailDto = z.infer<typeof SystemEmailDtoSchema>;

export const SystemEmailListResponseSchema = z.object({
  emails: z.array(SystemEmailDtoSchema).describe('Every system email, one per template key.'),
}).describe('Every system email with its recent sends.');
export type SystemEmailListResponse = z.infer<typeof SystemEmailListResponseSchema>;

export const SystemEmailLatestSendResponseSchema = z.object({
  templateKey: SystemEmailTemplateKeySchema,
  subject: z.string().describe('The subject it was sent with.'),
  htmlBody: z.string().describe('The HTML it was sent with, exactly. Show it in a sandboxed frame: it is a whole email document.'),
  sentAt: DateTimeSchema.describe('When the transport accepted it.'),
  recipient: z.string().describe('Whom it went to, masked: the first character of the address, then the domain ("d•••@example.com").'),
}).describe('The latest send of one system email that still keeps its content: a real email, never sample data.');
export type SystemEmailLatestSendResponse = z.infer<typeof SystemEmailLatestSendResponseSchema>;

export const SystemEmailResendResponseSchema = z.object({
  status: z.enum(EmailMessageStatus).describe(
    'Where the copy stands: QUEUED for the sender, or SKIPPED when the settings or the address stopped it (see skipReason).',
  ),
  skipReason: z.enum(EmailSkipReason).nullable().describe(
    'Why it was skipped, or null: EMAIL_DISABLED when "Send system email" is off, TEMPLATE_DISABLED when this email is off, '
    + 'NOT_ALLOWED_IN_ENVIRONMENT when your address is not in "Only send to" or is a reserved domain, '
    + 'SUPPRESSED when your address bounced or complained before.',
  ),
}).describe('What happened to a copy of a system email sent to the root admin.');
export type SystemEmailResendResponse = z.infer<typeof SystemEmailResendResponseSchema>;

registerSchema('SystemEmailDto', SystemEmailDtoSchema);
registerSchema('SystemEmailListResponse', SystemEmailListResponseSchema);
registerSchema('SystemEmailLatestSendResponse', SystemEmailLatestSendResponseSchema);
registerSchema('SystemEmailResendResponse', SystemEmailResendResponseSchema);
