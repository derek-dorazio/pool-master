export {
  applyCountingMethod,
  applyMultiplierRules,
  evaluateBonusRules,
  evaluateCondition,
  evaluatePenaltyRules,
  evaluatePositionRules,
  evaluateStatRules,
  handleDNF,
  scoreEntry,
  scoreParticipant,
} from './scoring-engine';
export type {
  EntryScoreResult,
  ParticipantScoringData,
  ScoreBreakdown,
  StatDeltas,
} from './scoring-engine';

export {
  evaluateTiebreaker,
  rankWithTiebreakers,
} from './tiebreaker';
export type {
  TiebreakerData,
  TiebreakerResult,
} from './tiebreaker';

export {
  STAT_SCHEMAS,
  getStatSchema,
  listSports,
  validateStatKeys,
} from './stat-schemas';
export type { StatValidationError } from './stat-schemas';
