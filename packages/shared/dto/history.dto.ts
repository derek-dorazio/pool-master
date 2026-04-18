import { z } from 'zod';
import { JsonObjectSchema } from './common.dto';

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
