import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const ConsentRecordDtoSchema = z.object({
  id: z.string().describe('Consent-record identifier.'),
  userId: z.string().describe('User who recorded the consent decision.'),
  consentType: z.string().describe('Consent category, such as terms acceptance or age affirmation.'),
  granted: z.boolean().describe('Whether the user granted the consent at this point in time.'),
  version: z.string().describe('Policy or consent-text version acknowledged by the user.'),
  minimumAgeThreshold: z.number().int().nullable().optional().describe('Minimum age that had to be affirmed when the consent required an age gate.'),
  ageAffirmed: z.boolean().nullable().optional().describe('Whether the user affirmed they met the required age threshold.'),
  ipAddress: z.string().nullable().optional().describe('Captured request IP when the consent was recorded, if retained.'),
  userAgent: z.string().nullable().optional().describe('Captured client user agent when the consent was recorded, if retained.'),
  createdAt: DateTimeSchema.describe('When the consent decision was recorded.'),
}).describe('Stored consent record returned from consent-history APIs.');

export const ConsentHistoryResponseSchema = z.object({
  consents: z.array(ConsentRecordDtoSchema),
}).describe('Consent-history response for the authenticated user.');

export const ConsentRecordRequestSchema = z.object({
  consentType: z.string().describe('Consent category being recorded.'),
  granted: z.boolean().describe('Whether the user accepts or declines the consent.'),
  version: z.string().describe('Policy version presented to the user.'),
  minimumAgeThreshold: z.number().int().min(13).max(18).nullable().optional().describe('Optional age-gate threshold that the user was asked to affirm.'),
  ageAffirmed: z.boolean().nullable().optional().describe('Optional age affirmation captured alongside the consent.'),
}).describe('Authenticated request payload for recording a consent decision.');

export const ConsentRecordResponseSchema = z.object({
  consent: ConsentRecordDtoSchema,
}).describe('Response returned after recording a consent decision.');
