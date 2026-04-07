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
export type FeedPostDto = z.infer<typeof FeedPostDtoSchema>;

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

export const ConversationDtoSchema = z.object({
  id: z.string(),
  participantName: z.string(),
  participantInitials: z.string(),
  participantAvatarUrl: z.string().nullable(),
  lastMessage: z.string(),
  lastMessageAt: DateTimeSchema,
  unreadCount: z.number(),
});
export type ConversationDto = z.infer<typeof ConversationDtoSchema>;

export const DirectMessageDtoSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  content: z.string(),
  createdAt: DateTimeSchema,
  isOwn: z.boolean(),
  delivered: z.boolean(),
  read: z.boolean(),
});
export type DirectMessageDto = z.infer<typeof DirectMessageDtoSchema>;

export const ChatMessageDtoSchema = z.object({
  id: z.string(),
  type: z.enum(['user', 'system']),
  authorName: z.string(),
  authorInitials: z.string(),
  content: z.string(),
  createdAt: DateTimeSchema,
  isOwn: z.boolean(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;

export const ShareLeaderboardEntryDtoSchema = z.object({
  rank: z.number(),
  name: z.string(),
  score: z.string(),
});
export type ShareLeaderboardEntryDto = z.infer<typeof ShareLeaderboardEntryDtoSchema>;

export const ShareCardDtoSchema = z.object({
  id: z.string(),
  type: z.enum(['contest_result', 'season_champion', 'achievement']),
  title: z.string(),
  sport: z.string(),
  sportIcon: z.string(),
  winnerName: z.string(),
  winnerAvatarUrl: z.string().nullable(),
  winnerScore: z.string(),
  leaderboard: z.array(ShareLeaderboardEntryDtoSchema),
  dateRange: z.string(),
  imageUrl: z.string().nullable(),
  ogTitle: z.string(),
  ogDescription: z.string(),
});
export type ShareCardDto = z.infer<typeof ShareCardDtoSchema>;

export const RecapStandingEntryDtoSchema = z.object({
  rank: z.number(),
  name: z.string(),
  initials: z.string(),
  points: z.number(),
  change: z.number(),
});
export type RecapStandingEntryDto = z.infer<typeof RecapStandingEntryDtoSchema>;

export const RecapHighlightDtoSchema = z.object({
  icon: z.string(),
  title: z.string(),
  detail: z.string(),
});
export type RecapHighlightDto = z.infer<typeof RecapHighlightDtoSchema>;

export const RecapUpcomingEventDtoSchema = z.object({
  name: z.string(),
  dateTime: DateTimeSchema,
  daysUntil: z.number(),
});
export type RecapUpcomingEventDto = z.infer<typeof RecapUpcomingEventDtoSchema>;

export const RecapDtoSchema = z.object({
  weekLabel: z.string(),
  standings: z.array(RecapStandingEntryDtoSchema),
  highlights: z.array(RecapHighlightDtoSchema),
  upcoming: z.array(RecapUpcomingEventDtoSchema),
});
export type RecapDto = z.infer<typeof RecapDtoSchema>;
