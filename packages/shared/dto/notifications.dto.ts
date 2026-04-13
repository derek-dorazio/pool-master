/**
 * Notification DTOs — request/response schemas for notification endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema, SuccessSchema } from './common.dto';

// --- Response Sub-schemas ---

export const NotificationDtoSchema = z.object({
  id: z.string().describe('Notification identifier.'),
  userId: z.string().optional().describe('Target user when the payload is not implicitly scoped by auth.'),
  eventType: z.string().describe('Notification category or event type.'),
  title: z.string().describe('Short notification title.'),
  body: z.string().describe('Longer notification body copy.'),
  read: z.boolean().describe('Whether the user has marked the notification as read.'),
  readAt: DateTimeSchema.nullable().optional().describe('When the notification was marked as read, if applicable.'),
  dismissed: z.boolean().optional().describe('Whether the notification has been dismissed from the feed.'),
  imageUrl: z.string().nullable().optional().describe('Optional image shown alongside the notification.'),
  actionScreen: z.string().nullable().optional().describe('Optional client route or screen hint for notification deep linking.'),
  actionParams: JsonObjectSchema.optional().describe('Optional routing parameters for the notification action target.'),
  groupKey: z.string().nullable().optional().describe('Optional grouping key for bundling related notifications.'),
  createdAt: DateTimeSchema.describe('When the notification was created.'),
}).describe('Notification feed item returned to clients.');
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

// --- Responses ---

export const NotificationListResponseSchema = z.object({
  notifications: z.array(NotificationDtoSchema).describe('Notification page or slice returned by the API.'),
  total: z.number().describe('Total number of notifications matching the current query.'),
}).describe('Notification-list response.');
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const NotificationUnreadCountResponseSchema = z.object({
  unreadCount: z.number().describe('Unread notification count for the current user.'),
}).describe('Unread-notification counter response.');

export const NotificationMarkedReadResponseSchema = SuccessSchema;

export const NotificationMarkAllReadResponseSchema = z.object({
  markedRead: z.number().describe('How many notifications were marked as read by the bulk operation.'),
}).describe('Bulk mark-all-read response.');
