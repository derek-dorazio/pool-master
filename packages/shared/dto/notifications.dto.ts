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

// --- Responses ---

export const NotificationListResponseSchema = z.object({
  notifications: z.array(NotificationDtoSchema),
  total: z.number(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const NotificationUnreadCountResponseSchema = z.object({
  unreadCount: z.number(),
});

export const NotificationMarkedReadResponseSchema = SuccessSchema;

export const NotificationMarkAllReadResponseSchema = z.object({
  markedRead: z.number(),
});
