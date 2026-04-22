import { z } from 'zod';
import { DateFormat, TimeFormat } from '@poolmaster/shared/domain';
import { SuccessSchema } from './common.dto';
import { AuthenticatedSessionUserDtoSchema } from './auth.dto';

export const AccountProfileUpdateRequestSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Updated first name for the account profile.'),
  lastName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Updated last name for the account profile.'),
}).describe('Self-service profile update payload for the authenticated account.');
export type AccountProfileUpdateRequest = z.infer<typeof AccountProfileUpdateRequestSchema>;

export const AccountPreferencesUpdateRequestSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .nullable()
    .optional()
    .describe('Preferred IANA timezone, or null to clear it.'),
  locale: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe('Preferred locale, or null to clear it.'),
  timeFormat: z
    .enum([TimeFormat.TWELVE_HOUR, TimeFormat.TWENTY_FOUR_HOUR])
    .nullable()
    .optional()
    .describe('Preferred clock display format, or null to clear it.'),
  dateFormat: z
    .enum([DateFormat.MDY, DateFormat.DMY, DateFormat.YMD])
    .nullable()
    .optional()
    .describe('Preferred date display format, or null to clear it.'),
}).describe('Self-service preferences update payload for the authenticated account.');
export type AccountPreferencesUpdateRequest = z.infer<typeof AccountPreferencesUpdateRequestSchema>;

export const AccountPasswordChangeRequestSchema = z.object({
  currentPassword: z
    .string()
    .min(1)
    .max(128)
    .describe('Existing password that must match before the password can be changed.'),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .describe('New password to persist for future sign-in attempts.'),
  confirmNewPassword: z
    .string()
    .min(8)
    .max(128)
    .describe('Repeat of the new password to guard against confirmation mistakes.'),
}).describe('Self-service password-change payload for the authenticated account.');
export type AccountPasswordChangeRequest = z.infer<typeof AccountPasswordChangeRequestSchema>;

export const AccountDeleteRequestSchema = z.object({
  email: z
    .string()
    .email()
    .describe('Exact email confirmation required before permanently deleting the inactive account.'),
}).describe('Self-service confirmation payload for permanently deleting an inactive account.');
export type AccountDeleteRequest = z.infer<typeof AccountDeleteRequestSchema>;

export const AccountResponseSchema = z.object({
  user: AuthenticatedSessionUserDtoSchema,
}).describe('Self-service account response envelope for authenticated account lifecycle actions.');
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

export const AccountPasswordChangeResponseSchema = SuccessSchema.describe(
  'Minimal success response returned after changing the authenticated account password.',
);
export type AccountPasswordChangeResponse = z.infer<typeof AccountPasswordChangeResponseSchema>;

export const AccountDeleteResponseSchema = SuccessSchema.describe(
  'Minimal success response returned after permanently deleting an inactive account.',
);
export type AccountDeleteResponse = z.infer<typeof AccountDeleteResponseSchema>;
