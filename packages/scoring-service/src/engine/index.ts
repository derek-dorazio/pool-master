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

export { scoreBracket } from './bracket-scoring';
export type {
  BracketEntryResult,
  BracketMatchResult,
  BracketPickResult,
  BracketPredictionInput,
} from './bracket-scoring';

export { scoreRotisserie } from './rotisserie-scoring';
export type {
  RotisserieConfig,
  RotisserieEntryResult,
  RotisserieEntryStats,
} from './rotisserie-scoring';

export {
  calculateRecords,
  evaluateMatchup,
  scoreHeadToHead,
} from './head-to-head-scoring';
export type {
  H2HRecord,
  Matchup,
  MatchupResult,
  PeriodScores,
} from './head-to-head-scoring';

export {
  scoreStrokePlayEntry,
  scoreStrokePlayParticipant,
} from './stroke-play-scoring';
export type {
  StrokePlayEntryResult,
  StrokePlayParticipant,
  StrokePlayResult,
} from './stroke-play-scoring';
