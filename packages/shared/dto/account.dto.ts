import { z } from 'zod';
import { SuccessSchema } from './common.dto';
import { UserProfileDtoSchema } from './auth.dto';

export const AccountDeleteRequestSchema = z.object({
  email: z
    .string()
    .email()
    .describe('Exact email confirmation required before permanently deleting the inactive account.'),
}).describe('Self-service confirmation payload for permanently deleting an inactive account.');
export type AccountDeleteRequest = z.infer<typeof AccountDeleteRequestSchema>;

export const AccountResponseSchema = z.object({
  user: UserProfileDtoSchema,
}).describe('Self-service account response envelope for authenticated account lifecycle actions.');
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

export const AccountDeleteResponseSchema = SuccessSchema.describe(
  'Minimal success response returned after permanently deleting an inactive account.',
);
export type AccountDeleteResponse = z.infer<typeof AccountDeleteResponseSchema>;
