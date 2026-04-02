/**
 * Notification DTOs — request/response schemas for notification endpoints.
 */
import { z } from 'zod';

// --- Response Sub-schemas ---

export const NotificationDtoSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: z.string().datetime(),
  linkTo: z.string().nullable().optional(),
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

export const NotificationPreferencesDtoSchema = z.object({
  email: z.boolean(),
  push: z.boolean(),
  inApp: z.boolean(),
  draftReminders: z.boolean(),
  scoreUpdates: z.boolean(),
  leagueActivity: z.boolean(),
});
export type NotificationPreferencesDto = z.infer<typeof NotificationPreferencesDtoSchema>;

// --- Responses ---

export const NotificationListResponseSchema = z.object({
  notifications: z.array(NotificationDtoSchema),
  unreadCount: z.number(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;
