import { z } from 'zod';

export const ScoringConfigValidationResponseSchema = z.object({
  valid: z.boolean(),
  config: z.record(z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.unknown()).optional(),
});
export type ScoringConfigValidationResponse = z.infer<typeof ScoringConfigValidationResponseSchema>;

export const ScoreBreakdownDtoSchema = z.object({
  participantId: z.string(),
  participantName: z.string().nullable().optional(),
  contextLabel: z.string().nullable().optional(),
  statPoints: z.number(),
  positionPoints: z.number(),
  bonusPoints: z.number(),
  penaltyPoints: z.number(),
  multipliedTotal: z.number(),
  dnfAdjustment: z.number(),
  finalScore: z.number(),
});
export type ScoreBreakdownDto = z.infer<typeof ScoreBreakdownDtoSchema>;

export const LeaderboardEntryDtoSchema = z.object({
  entryId: z.string(),
  rank: z.number(),
  totalScore: z.number(),
  isTied: z.boolean(),
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDtoSchema>;

export const ScoringLeaderboardResponseSchema = z.object({
  contestId: z.string(),
  leaderboard: z.array(LeaderboardEntryDtoSchema),
});
export type ScoringLeaderboardResponse = z.infer<typeof ScoringLeaderboardResponseSchema>;

export const EntryContestScoreDtoSchema = z.object({
  contestId: z.string(),
  entryId: z.string(),
  eventTimestamp: z.string().datetime(),
  pointsEarned: z.number(),
  runningTotal: z.number(),
  participantBreakdowns: z.array(ScoreBreakdownDtoSchema),
});
export type EntryContestScoreDto = z.infer<typeof EntryContestScoreDtoSchema>;

export const EntryScoreDetailResponseSchema = z.object({
  entryId: z.string(),
  contestId: z.string(),
  totalScore: z.number(),
  timeline: z.array(EntryContestScoreDtoSchema),
});
export type EntryScoreDetailResponse = z.infer<typeof EntryScoreDetailResponseSchema>;

export const ParticipantEventScoreDtoSchema = z.object({
  contestId: z.string(),
  participantId: z.string(),
  eventTimestamp: z.string(),
  stats: z.record(z.number()),
  points: z.number(),
  breakdown: ScoreBreakdownDtoSchema,
});
export type ParticipantEventScoreDto = z.infer<typeof ParticipantEventScoreDtoSchema>;

export const ParticipantScoreHistoryResponseSchema = z.object({
  participantId: z.string(),
  contestId: z.string(),
  scores: z.array(ParticipantEventScoreDtoSchema),
  totalPoints: z.number(),
});
export type ParticipantScoreHistoryResponse = z.infer<typeof ParticipantScoreHistoryResponseSchema>;

export const RollupResultResponseSchema = z.object({
  contestId: z.string(),
  entriesUpdated: z.number(),
  rankChanges: z.number(),
  rolledUpAt: z.string().datetime(),
});
export type RollupResultResponse = z.infer<typeof RollupResultResponseSchema>;

export const ScoringHealthResponseSchema = z.object({
  status: z.string(),
  service: z.string(),
  rollupRunning: z.boolean(),
  activeContests: z.number(),
  timestamp: z.string().datetime(),
});
export type ScoringHealthResponse = z.infer<typeof ScoringHealthResponseSchema>;
