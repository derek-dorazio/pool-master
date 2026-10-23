/**
 * The root admin's test email (#910): one email to one address from the Email settings, through
 * the same outbox and settings as every system email, to check the setup works.
 */
import { z } from 'zod';
import { EmailMessageStatus, EmailSkipReason } from '../domain/enums';
import { registerSchema } from './schema-registry';

export const EmailTestRequestSchema = z.object({
  to: z.string().trim().email('Enter an email address.').describe('The one address the test email goes to.'),
}).describe('Where to send a test email.');
export type EmailTestRequest = z.infer<typeof EmailTestRequestSchema>;

export const EmailTestResponseSchema = z.object({
  status: z.nativeEnum(EmailMessageStatus).describe(
    'Where the test email stands once the sender has had its try: SENT when the provider took it, '
    + 'SKIPPED when the settings or the address stopped it (see skipReason), QUEUED when the first '
    + 'try failed and a retry is due (see error), or FAILED.',
  ),
  skipReason: z.nativeEnum(EmailSkipReason).nullable().describe(
    'Why it was skipped, or null: EMAIL_DISABLED when "Send system email" is off, '
    + 'NOT_ALLOWED_IN_ENVIRONMENT when the address is not in "Only send to" or is a reserved domain, '
    + 'SUPPRESSED when the address bounced or complained before.',
  ),
  error: z.string().nullable().describe('The provider\'s error from the last failed try, or null.'),
}).describe('What happened to a test email.');
export type EmailTestResponse = z.infer<typeof EmailTestResponseSchema>;

registerSchema('EmailTestRequest', EmailTestRequestSchema);
registerSchema('EmailTestResponse', EmailTestResponseSchema);
