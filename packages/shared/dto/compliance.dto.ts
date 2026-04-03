import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema, SuccessSchema } from './common.dto';

export const AgeVerificationResponseSchema = z.object({
  allowed: z.boolean(),
  age: z.number(),
  reason: z.string().optional(),
});

export const ConsentRecordDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  consentType: z.string(),
  granted: z.boolean(),
  version: z.string(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: DateTimeSchema,
});

export const ConsentHistoryResponseSchema = z.object({
  consents: z.array(ConsentRecordDtoSchema),
});

export const ConsentPreferencesDtoSchema = z.object({
  marketingEmails: z.boolean(),
  analytics: z.boolean(),
  thirdPartyIntegrations: z.boolean(),
  doNotSell: z.boolean(),
});

export const DataExportAcceptedResponseSchema = z.object({
  requestId: z.string(),
  message: z.string(),
});

export const DataExportResponseSchema = JsonObjectSchema;

export const DataExportStatusDtoSchema = z.object({
  status: z.enum(['none', 'pending', 'ready']),
  requestedAt: DateTimeSchema.nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: DateTimeSchema.nullable(),
  nextAllowedAt: DateTimeSchema.nullable(),
});

export const DataExportStatusResponseSchema = DataExportStatusDtoSchema;

export const AccountDeletionAcceptedResponseSchema = z.object({
  requestId: z.string(),
  message: z.string(),
});

export const AccountDeletionRequestSchema = z.object({
  reason: z.string().optional(),
});

export const AccountDeletionCancelledResponseSchema = SuccessSchema.extend({
  message: z.string(),
});

export const SelfExclusionCreatedResponseSchema = z.object({
  exclusionId: z.string(),
});

export const ActivityLimitDtoSchema = z.object({
  enabled: z.boolean(),
  weeklyContestLimit: z.number().int().min(1).max(100),
});

export const ActivityLimitResponseSchema = z.object({
  activityLimit: ActivityLimitDtoSchema,
});

export const ActivityLimitUpdateRequestSchema = ActivityLimitDtoSchema;

export const SessionReminderDtoSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number(),
});

export const SessionReminderResponseSchema = z.object({
  sessionReminder: SessionReminderDtoSchema,
});

export const SessionReminderUpdateRequestSchema = SessionReminderDtoSchema;

export const SelfExclusionDurationSchema = z.enum(['24H', '7D', '30D', '6M', '1Y', 'INDEFINITE']);
export type SelfExclusionDuration = z.infer<typeof SelfExclusionDurationSchema>;

export const SelfExclusionDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  exclusionType: z.string(),
  duration: z.string(),
  endsAt: DateTimeSchema.nullable().optional(),
  isActive: z.boolean(),
  startedAt: DateTimeSchema,
  reactivatedAt: DateTimeSchema.nullable().optional(),
});

export const ActiveExclusionResponseSchema = z.object({
  exclusion: SelfExclusionDtoSchema.nullable(),
});

export const EnforcementCreatedResponseSchema = z.object({
  enforcementId: z.string(),
});

export const EnforcementActionDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  level: z.string(),
  reason: z.string(),
  trigger: z.string(),
  enforcedBy: z.string().nullable().optional(),
  endsAt: DateTimeSchema.nullable().optional(),
  appealStatus: z.string().nullable().optional(),
  createdAt: DateTimeSchema,
});

export const EnforcementHistoryResponseSchema = z.object({
  enforcement: z.array(EnforcementActionDtoSchema),
});

export const RetentionCleanupResponseSchema = z.record(z.number());
