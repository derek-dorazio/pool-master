import { z } from 'zod';
import { ScoringConfigSchema } from '../domain/scoring-config';

export const ScoringConfigValidationRequestSchema = ScoringConfigSchema;
export type ScoringConfigValidationRequest = z.infer<typeof ScoringConfigValidationRequestSchema>;

export const ScoringConfigValidationResponseSchema = z.object({
  valid: z.boolean().describe('Whether the supplied scoring configuration passed validation.'),
  config: z.record(z.unknown()).optional().describe('Normalized scoring configuration after validation, when available.'),
  warnings: z.array(z.string()).optional().describe('Non-blocking warnings surfaced during validation.'),
  errors: z.array(z.unknown()).optional().describe('Validation errors returned when the config is invalid.'),
}).describe('Scoring-configuration validation response.');
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
  finalScore: z.number().describe('Final score contribution after all components and adjustments.'),
}).describe('Participant score breakdown within an entry or event.');
export type ScoreBreakdownDto = z.infer<typeof ScoreBreakdownDtoSchema>;

export const LeaderboardEntryDtoSchema = z.object({
  entryId: z.string().describe('Entry identifier.'),
  rank: z.number().describe('Current leaderboard rank.'),
  totalScore: z.number().describe('Current total score for the entry.'),
  isTied: z.boolean().describe('Whether the rank is shared with another entry.'),
}).describe('Condensed leaderboard entry.');
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDtoSchema>;

export const ScoringLeaderboardResponseSchema = z.object({
  contestId: z.string().describe('Contest whose leaderboard is being returned.'),
  leaderboard: z.array(LeaderboardEntryDtoSchema).describe('Current contest leaderboard.'),
}).describe('Scoring leaderboard response.');
export type ScoringLeaderboardResponse = z.infer<typeof ScoringLeaderboardResponseSchema>;

export const EntryContestScoreDtoSchema = z.object({
  contestId: z.string(),
  entryId: z.string(),
  eventTimestamp: z.string().datetime(),
  pointsEarned: z.number(),
  runningTotal: z.number(),
  participantBreakdowns: z.array(ScoreBreakdownDtoSchema).describe('Per-participant contributions at this scoring event timestamp.'),
}).describe('Timeline score event for a single contest entry.');
export type EntryContestScoreDto = z.infer<typeof EntryContestScoreDtoSchema>;

export const EntryScoreDetailResponseSchema = z.object({
  entryId: z.string(),
  contestId: z.string(),
  totalScore: z.number(),
  timeline: z.array(EntryContestScoreDtoSchema).describe('Score timeline for the contest entry.'),
}).describe('Contest-entry score detail response.');
export type EntryScoreDetailResponse = z.infer<typeof EntryScoreDetailResponseSchema>;

export const ParticipantEventScoreDtoSchema = z.object({
  contestId: z.string(),
  participantId: z.string(),
  eventTimestamp: z.string(),
  stats: z.record(z.number()),
  points: z.number(),
  breakdown: ScoreBreakdownDtoSchema.describe('Detailed point breakdown for the participant score event.'),
}).describe('Single participant scoring event.');
export type ParticipantEventScoreDto = z.infer<typeof ParticipantEventScoreDtoSchema>;

export const ParticipantScoreHistoryResponseSchema = z.object({
  participantId: z.string(),
  contestId: z.string(),
  scores: z.array(ParticipantEventScoreDtoSchema),
  totalPoints: z.number().describe('Total points accumulated by the participant in the contest.'),
}).describe('Participant score-history response.');
export type ParticipantScoreHistoryResponse = z.infer<typeof ParticipantScoreHistoryResponseSchema>;

export const RollupResultResponseSchema = z.object({
  contestId: z.string(),
  entriesUpdated: z.number(),
  rankChanges: z.number(),
  rolledUpAt: z.string().datetime().describe('When the standings rollup completed.'),
}).describe('Standings-rollup response.');
export type RollupResultResponse = z.infer<typeof RollupResultResponseSchema>;

export const ScoringHealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  eventDriven: z.literal(true).describe(
    'Always true: the scoring path is event-driven via live_score.persisted '
    + '(plans/117 §11.3). The legacy `rollupRunning` / `activeContests` fields '
    + 'were removed in pool-master-rop.78.8 along with the periodic rollup interval.',
  ),
  timestamp: z.string().datetime().describe('When the scoring-health snapshot was recorded.'),
}).describe('Scoring-service health response.');
export type ScoringHealthResponse = z.infer<typeof ScoringHealthResponseSchema>;
