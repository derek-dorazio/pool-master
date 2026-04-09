import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const HistoryObjectSchema = JsonObjectSchema;
export const HistorySeasonChampionDtoSchema = z.object({
  contestId: z.string(),
  contestName: z.string(),
  entryId: z.string(),
  entryName: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  finalScore: z.number(),
  prizeWon: z.number().optional(),
});
export type HistorySeasonChampionDto = z.infer<typeof HistorySeasonChampionDtoSchema>;

export const HistorySeasonHighlightsDtoSchema = z.object({
  highestScore: z.number().optional(),
  lowestScore: z.number().optional(),
});
export type HistorySeasonHighlightsDto = z.infer<typeof HistorySeasonHighlightsDtoSchema>;

export const HistorySeasonSummaryDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  seasonName: z.string(),
  sport: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  numMembers: z.number(),
  numContests: z.number(),
  totalPrizePool: z.number(),
  champions: z.array(HistorySeasonChampionDtoSchema),
  highlights: HistorySeasonHighlightsDtoSchema,
  commissionerNote: z.string().nullable().optional(),
  openedAt: DateTimeSchema.nullable().optional(),
  closedAt: DateTimeSchema.nullable().optional(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type HistorySeasonSummaryDto = z.infer<typeof HistorySeasonSummaryDtoSchema>;

export const HistoryEntriesResponseSchema = z.object({
  entries: z.array(HistoryObjectSchema),
});
export const HistoryStandingsResponseSchema = z.object({
  standings: z.array(HistoryObjectSchema),
});
export const HistoryPayoutsResponseSchema = z.object({
  payouts: z.array(HistoryObjectSchema),
});
export const HistoryResultsResponseSchema = z.object({
  results: z.array(HistoryObjectSchema),
});
export const HistorySeasonsResponseSchema = z.object({
  seasons: z.array(HistorySeasonSummaryDtoSchema),
});
export const HistoryChampionsResponseSchema = z.object({
  champions: z.array(HistoryObjectSchema),
});
export const HistoryLeaderboardResponseSchema = z.object({
  leaderboard: z.array(HistoryObjectSchema),
});
export const HistoryTrophiesResponseSchema = z.object({
  trophies: z.array(HistoryObjectSchema),
});
export const HistoryRecordsResponseSchema = z.object({
  records: z.array(HistoryObjectSchema),
});
export const HistoryRivalriesResponseSchema = z.object({
  rivalries: z.array(HistoryObjectSchema),
});
export const HistoryLuckScoresResponseSchema = z.object({
  luckScores: z.array(HistoryObjectSchema),
});
export const HistoryPowerRatingsResponseSchema = z.object({
  powerRatings: z.array(HistoryObjectSchema),
});
export const HistoryConsistencyScoresResponseSchema = z.object({
  consistencyScores: z.array(HistoryObjectSchema),
});
export const HistoryRankingsResponseSchema = z.object({
  rankings: z.array(HistoryObjectSchema),
});
export const HistoryNotesResponseSchema = z.object({
  notes: z.array(HistoryObjectSchema),
});
export const HistoryFilesResponseSchema = z.object({
  files: z.array(HistoryObjectSchema),
});
