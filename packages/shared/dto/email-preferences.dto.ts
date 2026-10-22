/**
 * Email preference DTOs (#844 slice 5): which categories of email a user gets, and the one-click
 * unsubscribe an email's link and List-Unsubscribe header lead to.
 */
import { z } from 'zod';
import { EmailSuppressionReason, OptionalEmailCategory } from '../domain/enums';
import { registerSchema } from './schema-registry';

export const OptionalEmailCategorySchema = z.nativeEnum(OptionalEmailCategory).describe(
  'A category of email a member can turn off: COMMISSIONER_UPDATES, CONTEST_UPDATES, LIVE_STANDINGS, '
  + 'RESULTS or RECEIPTS. Account and membership emails are always sent.',
);

export const EmailPreferenceDtoSchema = z.object({
  category: OptionalEmailCategorySchema,
  enabled: z.boolean().describe('Whether the user gets emails in this category.'),
}).describe('One category of email and whether the user gets it.');
export type EmailPreferenceDto = z.infer<typeof EmailPreferenceDtoSchema>;

export const EmailPreferencesResponseSchema = z.object({
  preferences: z.array(EmailPreferenceDtoSchema).describe('Every category a member can turn off, in a fixed order.'),
  emailSuppression: z.nativeEnum(EmailSuppressionReason).nullable().describe(
    'Why no email reaches the account\'s address any more, or null: BOUNCE when mail to it bounced for good, '
    + 'COMPLAINT when an email was marked as spam. Changing the account\'s email fixes it.',
  ),
}).describe('Which categories of email the user gets, and whether their address can be emailed at all.');
export type EmailPreferencesResponse = z.infer<typeof EmailPreferencesResponseSchema>;

export const EmailPreferenceUpdateRequestSchema = EmailPreferenceDtoSchema.describe(
  'Turns one category of email on or off.',
);
export type EmailPreferenceUpdateRequest = z.infer<typeof EmailPreferenceUpdateRequestSchema>;

export const EmailUnsubscribeQuerySchema = z.object({
  token: z.string().min(1).describe('The token from the email\'s unsubscribe link.'),
}).describe('The unsubscribe link\'s token.');
export type EmailUnsubscribeQuery = z.infer<typeof EmailUnsubscribeQuerySchema>;

export const EmailUnsubscribeResponseSchema = z.object({
  category: OptionalEmailCategorySchema.describe('The category of email that is now off.'),
}).describe('The category the unsubscribe link turned off.');
export type EmailUnsubscribeResponse = z.infer<typeof EmailUnsubscribeResponseSchema>;

registerSchema('OptionalEmailCategory', OptionalEmailCategorySchema);
registerSchema('EmailPreferenceDto', EmailPreferenceDtoSchema);
registerSchema('EmailPreferencesResponse', EmailPreferencesResponseSchema);
registerSchema('EmailPreferenceUpdateRequest', EmailPreferenceUpdateRequestSchema);
registerSchema('EmailUnsubscribeQuery', EmailUnsubscribeQuerySchema);
registerSchema('EmailUnsubscribeResponse', EmailUnsubscribeResponseSchema);
