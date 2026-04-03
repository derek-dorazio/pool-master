/**
 * Notification DTOs — request/response schemas for notification endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema, SuccessSchema } from './common.dto';

// --- Response Sub-schemas ---

export const NotificationDtoSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  eventType: z.string(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  readAt: DateTimeSchema.nullable().optional(),
  dismissed: z.boolean().optional(),
  imageUrl: z.string().nullable().optional(),
  actionScreen: z.string().nullable().optional(),
  actionParams: JsonObjectSchema.optional(),
  groupKey: z.string().nullable().optional(),
  createdAt: DateTimeSchema,
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

export const NotificationPreferencesDtoSchema = z.object({
  doNotDisturb: z.boolean(),
  dndSchedule: JsonObjectSchema.optional(),
  categories: JsonObjectSchema,
});
export type NotificationPreferencesDto = z.infer<typeof NotificationPreferencesDtoSchema>;

export const NotificationDeviceDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  platform: z.string(),
  token: z.string(),
  appVersion: z.string().nullable().optional(),
  osVersion: z.string().nullable().optional(),
  deviceModel: z.string().nullable().optional(),
  isActive: z.boolean(),
  registeredAt: DateTimeSchema,
  lastActiveAt: DateTimeSchema,
});

// --- Responses ---

export const NotificationListResponseSchema = z.object({
  notifications: z.array(NotificationDtoSchema),
  total: z.number(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const NotificationUnreadCountResponseSchema = z.object({
  unreadCount: z.number(),
});

export const NotificationPreferencesResponseSchema = z.object({
  preferences: NotificationPreferencesDtoSchema,
});

export const NotificationDeviceResponseSchema = z.object({
  device: NotificationDeviceDtoSchema,
});

export const NotificationDeviceListResponseSchema = z.object({
  devices: z.array(NotificationDeviceDtoSchema),
});

export const NotificationMarkedReadResponseSchema = SuccessSchema;

export const NotificationMarkAllReadResponseSchema = z.object({
  markedRead: z.number(),
});

export const NotificationUnsubscribeResponseSchema = SuccessSchema.extend({
  category: z.string(),
  enabled: z.literal(false),
});

export const NotificationDispatchResponseSchema = JsonObjectSchema;

export const NotificationScheduleResponseSchema = z.object({
  scheduled: z.boolean(),
  id: z.string(),
});

export const NotificationCancelledResponseSchema = z.object({
  cancelled: z.number(),
});

export const NotificationAnalyticsResponseSchema = z.object({
  period: z.object({
    days: z.number(),
    since: DateTimeSchema,
  }),
  total: z.number(),
  deliveryRate: z.number(),
  sent: z.number(),
  suppressed: z.number(),
  failed: z.number(),
  byChannel: z.record(
    z.object({
      sent: z.number(),
      suppressed: z.number(),
      failed: z.number(),
    }),
  ),
  suppressionReasons: z.record(z.number()),
});
