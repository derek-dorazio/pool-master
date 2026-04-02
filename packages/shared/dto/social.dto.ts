/**
 * Social DTOs — request/response schemas for social feed endpoints.
 */
import { z } from 'zod';

// --- Response Sub-schemas ---

export const FeedItemDtoSchema = z.object({
  id: z.string(),
  type: z.string(),
  authorName: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
  replyCount: z.number(),
  likeCount: z.number(),
});
export type FeedItemDto = z.infer<typeof FeedItemDtoSchema>;

// --- Responses ---

export const FeedResponseSchema = z.object({
  items: z.array(FeedItemDtoSchema),
  hasMore: z.boolean(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;
