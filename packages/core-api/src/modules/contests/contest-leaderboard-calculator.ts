/**
 * The contest leaderboard's arithmetic (#248: cross-sport names, since nothing here is golf's).
 * An entry's standing is its best N picks' scores summed, ranked by the contest's participant
 * scoring definition. Picks point at event field rows; a field row's score is read once, into a
 * `ParticipantScore`, and every entry joins to it.
 */
import {
  compareScores,
  PARTICIPANT_SCORING_DEFINITIONS,
  ParticipantScoringDefinitionIdSchema,
  rankSortedScores,
  type ContestEntryStatus,
  type GolfContestConfig,
  type ParticipantScoringDefinition,
  type ParticipantScoringDefinitionId,
  type ScoreDirection,
} from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingRow,
  ScoredContestEntryPickRow,
} from '../../mappers/contests.mapper';
import type { Unvalidated } from '../../core/unvalidated';

export interface ContestCountingRule {
  type: 'BEST_N_GOLFERS';
  count: number;
}

/** What the leaderboard reads off a contest's configuration: its counting inputs and its scoring rules. */
export interface ContestScoringConfigurationRow {
  configJson: unknown;
  rosterSize: number | null;
  pickCount: number | null;
  rounds: number | null;
  participantScoringRules: Array<{
    participantScoringDefinitionId: string;
    sortOrder: number;
    active: boolean;
  }>;
}

/** A contest entry with its picks, as the leaderboard ranks it. */
export interface ContestLeaderboardEntryInput {
  id: string;
  entryNumber: number;
  name: string;
  status: ContestEntryStatus;
  squadId: string;
  squad: { name: string };
  picks: Array<{
    id: string;
    sportEventParticipantId: string;
    pickedAt: Date;
    slot: number | null;
  }>;
}

/** One field row's score under the contest's scoring definition, or null while unscored. */
export interface ParticipantScore {
  sportEventParticipantId: string;
  name: string;
  score: number | null;
  /** Rounds scored as a fixed 80 strokes because the golfer did not play them (#478). */
  unplayedRoundNumbers: number[];
  asOf: Date | null;
}

export function resolveContestCountingRule(
  configuration: ContestScoringConfigurationRow | null,
): ContestCountingRule | null {
  const configJson = configuration?.configJson;
  const configRecord =
    configJson && typeof configJson === 'object' && !Array.isArray(configJson)
      ? configJson as Unvalidated<GolfContestConfig>
      : null;
  const countedScores = readPositiveInteger(configRecord?.countedScores)
    ?? readPositiveInteger(configuration?.rosterSize)
    ?? readPositiveInteger(configuration?.pickCount);

  if (!countedScores) {
    return null;
  }

  return {
    type: 'BEST_N_GOLFERS',
    count: countedScores,
  };
}

/**
 * The scoring definition a leaderboard ranks by, read from the configuration's first active
 * participant scoring rule.
 *
 * There is no fallback (#246). Every configuration carries a rule — the one create writes it,
 * and the #246 migration gave one to every golf configuration that lacked it — so a missing
 * rule is a real defect, reported as `RULE_MISSING` rather than answered with a sport
 * assumption. A rule naming an id the registry does not know is `DEFINITION_UNKNOWN`:
 * ranking by a guessed direction would silently invert the standings.
 */
export type ContestScoringResolution =
  | { ok: true; id: ParticipantScoringDefinitionId; definition: ParticipantScoringDefinition }
  | { ok: false; reason: 'RULE_MISSING' | 'DEFINITION_UNKNOWN' };

export function resolveContestScoringDefinition(
  configuration: ContestScoringConfigurationRow | null,
): ContestScoringResolution {
  const rule = [...(configuration?.participantScoringRules ?? [])]
    .filter((candidate) => candidate.active)
    .sort((left, right) => left.sortOrder - right.sortOrder)[0];
  if (!rule) {
    return { ok: false, reason: 'RULE_MISSING' };
  }
  const id = ParticipantScoringDefinitionIdSchema.safeParse(rule.participantScoringDefinitionId);
  return id.success
    ? { ok: true, id: id.data, definition: PARTICIPANT_SCORING_DEFINITIONS[id.data] }
    : { ok: false, reason: 'DEFINITION_UNKNOWN' };
}

export function buildContestEntryStanding(
  entry: ContestLeaderboardEntryInput,
  scoreById: Map<string, ParticipantScore>,
  countingRule: ContestCountingRule,
  direction: ScoreDirection,
): ContestEntryStandingRow {
  const scoredPicks = entry.picks
    .map((pick) => ({
      pick,
      participant: scoreById.get(pick.sportEventParticipantId) ?? null,
    }))
    .filter((row): row is {
      pick: ContestLeaderboardEntryInput['picks'][number];
      participant: ParticipantScore;
    } => row.participant !== null && row.participant.score !== null)
    .sort((left, right) =>
      compareScores(direction, left.participant.score, right.participant.score)
      || left.participant.name.localeCompare(right.participant.name)
      || left.pick.id.localeCompare(right.pick.id),
    );
  const countingPickIds = new Set(
    scoredPicks.slice(0, countingRule.count).map((row) => row.pick.id),
  );
  const picks: ScoredContestEntryPickRow[] = entry.picks
    .map((pick) => {
      const participant = scoreById.get(pick.sportEventParticipantId);
      if (!participant) {
        return null;
      }
      const isCounting = countingPickIds.has(pick.id);
      return {
        pickId: pick.id,
        sportEventParticipantId: pick.sportEventParticipantId,
        pickedAt: pick.pickedAt,
        slot: pick.slot,
        isCounting,
        isDropped: participant.score !== null && !isCounting,
        participant,
      };
    })
    .filter((pick): pick is ScoredContestEntryPickRow => pick !== null)
    .sort((left, right) => compareScoredContestEntryPicks(direction, left, right));
  const countingScores: number[] = [];
  for (const pick of picks) {
    if (pick.isCounting && pick.participant.score !== null) {
      countingScores.push(pick.participant.score);
    }
  }

  return {
    entryId: entry.id,
    entryName: entry.name,
    entryNumber: entry.entryNumber,
    squadId: entry.squadId,
    squadName: entry.squad.name,
    status: entry.status,
    score: countingScores.length > 0
      ? countingScores.reduce((sum, score) => sum + score, 0)
      : null,
    position: null,
    displayPosition: null,
    countingPickLimit: countingRule.count,
    scoredPickCount: scoredPicks.length,
    picks,
  };
}

export function rankContestEntryStandings(
  entries: ContestEntryStandingRow[],
  direction: ScoreDirection,
): ContestEntryStandingRow[] {
  const sorted = [...entries].sort((left, right) =>
    compareScores(direction, left.score, right.score)
    || left.entryNumber - right.entryNumber
    || left.entryName.localeCompare(right.entryName)
    || left.entryId.localeCompare(right.entryId),
  );
  const ranks = rankSortedScores(sorted.map((entry) => entry.score));
  return sorted.map((entry, index) => ({ ...entry, ...ranks[index] }));
}

/** A settled entry's frozen standing, as settlement wrote it. */
export interface SettledContestEntryStanding {
  contestEntryId: string;
  position: number | null;
  displayPosition: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  score: number | null;
}

/**
 * A settled contest's leaderboard answers from its frozen standings, not from live event
 * scores: after settlement a provider correction must not silently rewrite the result. Each
 * entry's rank, total and pick counts come from its standing, and the order is the frozen one
 * (unranked last). Per-pick rows stay as the live read built them — the standing freezes the
 * entry's result, not the event's scorecard. An entry with no standing (none is expected once
 * a contest settles) keeps its live values and sorts after every settled entry.
 */
export function applySettledContestStandings(
  entries: ContestEntryStandingRow[],
  standings: readonly SettledContestEntryStanding[],
): ContestEntryStandingRow[] {
  const byEntryId = new Map(standings.map((standing) => [standing.contestEntryId, standing]));
  const rank = (entry: ContestEntryStandingRow) => {
    const standing = byEntryId.get(entry.entryId);
    if (!standing) return Number.MAX_SAFE_INTEGER;
    return standing.position ?? Number.MAX_SAFE_INTEGER - 1;
  };
  return entries
    .map((entry) => {
      const standing = byEntryId.get(entry.entryId);
      if (!standing) return entry;
      return {
        ...entry,
        score: standing.score,
        position: standing.position,
        displayPosition: standing.displayPosition,
        countingPickLimit: standing.countingPickLimit,
        scoredPickCount: standing.scoredPickCount,
      };
    })
    .sort((left, right) =>
      rank(left) - rank(right)
      || left.entryNumber - right.entryNumber
      || left.entryName.localeCompare(right.entryName)
      || left.entryId.localeCompare(right.entryId),
    );
}

/**
 * Picks in display order: scored picks best first, then unscored picks by roster slot and pick
 * time. Not a merit rule for the unscored ones — only a stable order.
 */
function compareScoredContestEntryPicks(
  direction: ScoreDirection,
  left: ScoredContestEntryPickRow,
  right: ScoredContestEntryPickRow,
): number {
  const leftScore = left.participant.score;
  const rightScore = right.participant.score;
  if (leftScore !== null && rightScore !== null) {
    return compareScores(direction, leftScore, rightScore)
      || left.participant.name.localeCompare(right.participant.name)
      || left.pickId.localeCompare(right.pickId);
  }
  if (leftScore !== null) return -1;
  if (rightScore !== null) return 1;

  return compareSlots(left.slot, right.slot)
    || left.pickedAt.getTime() - right.pickedAt.getTime()
    || left.pickId.localeCompare(right.pickId);
}

/** Roster slots order ascending, with an unslotted pick last. Not a score: no direction. */
function compareSlots(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}
