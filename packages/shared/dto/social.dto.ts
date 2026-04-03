/**
 * Social DTOs — request/response schemas for social feed endpoints.
 */
import { z } from 'zod';
import { DateTimeSchema, SuccessSchema } from './common.dto';

// --- Response Sub-schemas ---

export const FeedItemDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  authorId: z.string(),
  type: z.string(),
  authorName: z.string(),
  content: z.string(),
  isPinned: z.boolean(),
  reactions: z.record(z.array(z.string())),
  replyCount: z.number(),
  parentId: z.string().optional(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type FeedItemDto = z.infer<typeof FeedItemDtoSchema>;

export const FeedPostDtoSchema: z.ZodType<any> = FeedItemDtoSchema.extend({
  replies: z.lazy(() => z.array(FeedPostDtoSchema)).optional(),
});

// --- Responses ---

export const FeedResponseSchema = z.object({
  posts: z.array(FeedItemDtoSchema),
  nextCursor: z.string().optional(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

export const FeedPostResponseSchema = FeedPostDtoSchema;

export const FeedReactionResponseSchema = z.object({
  added: z.boolean(),
});

export const FeedPinResponseSchema = SuccessSchema;
