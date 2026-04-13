import { z } from 'zod';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const HistoryObjectSchema = JsonObjectSchema;
export const HistorySeasonChampionDtoSchema = z.object({
  contestId: z.string().describe('Contest won by the champion entry.'),
  contestName: z.string().describe('Contest display name.'),
  entryId: z.string().describe('Winning entry identifier.'),
  entryName: z.string().describe('Winning entry display name.'),
  memberId: z.string().describe('Winning member or owner identifier.'),
  memberName: z.string().describe('Winning member display name.'),
  finalScore: z.number().describe('Champion final score.'),
  prizeWon: z.number().optional().describe('Prize amount won by the champion, when tracked.'),
}).describe('Season champion summary.');
export type HistorySeasonChampionDto = z.infer<typeof HistorySeasonChampionDtoSchema>;

export const HistorySeasonHighlightsDtoSchema = z.object({
  highestScore: z.number().optional().describe('Highest score recorded during the season.'),
  lowestScore: z.number().optional().describe('Lowest score recorded during the season.'),
}).describe('Lightweight highlight metrics for a season.');
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
  highlights: HistorySeasonHighlightsDtoSchema.describe('Derived season highlights.'),
  commissionerNote: z.string().nullable().optional().describe('Optional commissioner note retained with the season archive.'),
  openedAt: DateTimeSchema.nullable().optional().describe('When the season opened, if tracked.'),
  closedAt: DateTimeSchema.nullable().optional().describe('When the season closed, if tracked.'),
  createdAt: DateTimeSchema.describe('When the season summary record was created.'),
  updatedAt: DateTimeSchema.describe('When the season summary record was last updated.'),
}).describe('League-history season summary.');
export type HistorySeasonSummaryDto = z.infer<typeof HistorySeasonSummaryDtoSchema>;

export const HistoryEntriesResponseSchema = z.object({
  entries: z.array(HistoryObjectSchema),
}).describe('Historical contest-entry response.');
export const HistoryStandingsResponseSchema = z.object({
  standings: z.array(HistoryObjectSchema),
}).describe('Historical standings response.');
export const HistoryPayoutsResponseSchema = z.object({
  payouts: z.array(HistoryObjectSchema),
}).describe('Historical payouts response.');
export const HistoryResultsResponseSchema = z.object({
  results: z.array(HistoryObjectSchema),
}).describe('Historical results response.');
export const HistorySeasonsResponseSchema = z.object({
  seasons: z.array(HistorySeasonSummaryDtoSchema),
}).describe('League-history seasons response.');
export const HistoryChampionsResponseSchema = z.object({
  champions: z.array(HistoryObjectSchema),
}).describe('Historical champions response.');
export const HistoryLeaderboardResponseSchema = z.object({
  leaderboard: z.array(HistoryObjectSchema),
}).describe('Historical leaderboard response.');
export const HistoryTrophiesResponseSchema = z.object({
  trophies: z.array(HistoryObjectSchema),
}).describe('Historical trophies response.');
export const HistoryRecordsResponseSchema = z.object({
  records: z.array(HistoryObjectSchema),
}).describe('Historical records response.');
export const HistoryRivalriesResponseSchema = z.object({
  rivalries: z.array(HistoryObjectSchema),
}).describe('Historical rivalries response.');
export const HistoryLuckScoresResponseSchema = z.object({
  luckScores: z.array(HistoryObjectSchema),
}).describe('Historical luck-score response.');
export const HistoryPowerRatingsResponseSchema = z.object({
  powerRatings: z.array(HistoryObjectSchema),
}).describe('Historical power-ratings response.');
export const HistoryConsistencyScoresResponseSchema = z.object({
  consistencyScores: z.array(HistoryObjectSchema),
}).describe('Historical consistency-score response.');
export const HistoryRankingsResponseSchema = z.object({
  rankings: z.array(HistoryObjectSchema),
}).describe('Historical rankings response.');
export const HistoryNotesResponseSchema = z.object({
  notes: z.array(HistoryObjectSchema),
}).describe('Historical commissioner-notes response.');
export const HistoryFilesResponseSchema = z.object({
  files: z.array(HistoryObjectSchema),
}).describe('Historical file-attachments response.');
