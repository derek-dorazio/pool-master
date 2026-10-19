/**
 * The contest leaderboard's arithmetic (#248: cross-sport names, since nothing here is golf's).
 * An entry's standing is its best N picks' scores summed, ranked by the contest's participant
 * scoring definition. Picks point at event field rows; a field row's score is read once, into a
 * `ParticipantScore`, and every entry joins to it.
 */
import {
  compareScores,
  PARTICIPANT_SCORING_DEFINITIONS,
  rankSortedScores,
  type ContestScoringSettings,
  type ContestScoringSettingsParse,
  type ContestSelectionConfig,
  type ParticipantScoringDefinition,
  type ParticipantScoringDefinitionId,
  type ScoreDirection,
  type ScoringFamily,
} from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingRow,
  ScoredContestEntryPickRow,
} from '../../mappers/contests.mapper';

export interface ContestCountingRule {
  type: 'BEST_N';
  count: number;
}

/** What the leaderboard reads off a contest's configuration: its counting inputs and its scoring rules. */
export interface ContestScoringConfigurationRow {
  /** The contest's typed rules; every selection type's carry `countedScores` (#93). */
  configJson: ContestSelectionConfig | null;
  participantScoringRules: Array<{
    sortOrder: number;
    /** The rule's definition and settings, as read through the definition's settings schema. */
    scoring: ContestScoringSettingsParse;
    active: boolean;
  }>;
}

/** A contest entry with its picks, as the leaderboard ranks it. */
export interface ContestLeaderboardEntryInput {
  id: string;
  entryNumber: number;
  name: string;
  squadId: string;
  squad: { name: string };
  picks: Array<{
    id: string;
    sportEventParticipantId: string;
    pickedAt: Date;
    slot: number | null;
  }>;
}

/**
 * What a scoring family adds to a participant's score beyond the number, keyed by the family
 * that scored it. One arm per family; the leaderboard mapper reads it into the family's pick
 * detail block.
 */
export type ParticipantScoreDetail =
  | {
    scoringFamily: typeof ScoringFamily.STROKE_PLAY;
    /** Rounds scored as a fixed 80 strokes because the golfer did not play them (#478). */
    unplayedRoundNumbers: number[];
  }
  | {
    /** Finish position: the score is the runner's points, so there is nothing to add. */
    scoringFamily: typeof ScoringFamily.FINISH_POSITION;
  }
  | {
    /** Head to head (#699): how the team's knockout points came about. */
    scoringFamily: typeof ScoringFamily.HEAD_TO_HEAD;
    wins: number;
    upsetBonusPoints: number;
    isAlive: boolean;
  };

/**
 * A score's detail as the arm of the family that scored it. A contest's scores all come from its
 * own sport's family, so another family's arm is a broken invariant and throws.
 */
export function participantScoreDetailFor<Family extends ScoringFamily>(
  scoringFamily: Family,
  detail: ParticipantScoreDetail,
): Extract<ParticipantScoreDetail, { scoringFamily: Family }> {
  if (detail.scoringFamily !== scoringFamily) {
    throw new Error(`Expected ${scoringFamily} score detail, got ${detail.scoringFamily}`);
  }
  return detail as Extract<ParticipantScoreDetail, { scoringFamily: Family }>;
}

/** One field row's score under the contest's scoring definition, or null while unscored. */
export interface ParticipantScore {
  sportEventParticipantId: string;
  name: string;
  score: number | null;
  detail: ParticipantScoreDetail;
  asOf: Date | null;
}

export function resolveContestCountingRule(
  configuration: ContestScoringConfigurationRow | null,
): ContestCountingRule | null {
  const rules = configuration?.configJson;
  // A prediction contest scores its game picks, not its best N field members (#716).
  const countedScores = rules == null || !('countedScores' in rules)
    ? undefined
    : rules.countedScores;

  if (!countedScores) {
    return null;
  }

  return {
    type: 'BEST_N',
    count: countedScores,
  };
}

/**
 * The scoring definition a leaderboard ranks by, read from the configuration's first active
 * participant scoring rule, with the rule's settings validated against that definition.
 *
 * There is no fallback (#246). Every configuration carries a rule — the one create writes it,
 * and the #246 migration gave one to every golf configuration that lacked it — so a missing
 * rule is a real defect, reported as `RULE_MISSING` rather than answered with a sport
 * assumption. A rule naming an id the registry does not know is `DEFINITION_UNKNOWN`:
 * ranking by a guessed direction would silently invert the standings. A rule whose `config` is
 * not a settings value of its definition is `SETTINGS_INVALID`: scoring with defaults in its
 * place would score the contest under rules its commissioner did not set.
 */
export type ContestScoringResolution =
  | {
    ok: true;
    id: ParticipantScoringDefinitionId;
    definition: ParticipantScoringDefinition;
    scoring: ContestScoringSettings;
  }
  | { ok: false; reason: ContestScoringResolutionFailure };

export type ContestScoringResolutionFailure = 'RULE_MISSING' | 'DEFINITION_UNKNOWN' | 'SETTINGS_INVALID';

export function resolveContestScoringDefinition(
  configuration: ContestScoringConfigurationRow | null,
): ContestScoringResolution {
  const rule = [...(configuration?.participantScoringRules ?? [])]
    .filter((candidate) => candidate.active)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .at(0);
  if (!rule) {
    return { ok: false, reason: 'RULE_MISSING' };
  }
  if (!rule.scoring.success) {
    return { ok: false, reason: rule.scoring.reason };
  }
  const scoring = rule.scoring.data;
  const id = scoring.participantScoringDefinitionId;
  return { ok: true, id, definition: PARTICIPANT_SCORING_DEFINITIONS[id], scoring };
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

/**
 * An entry's standing in an event of its contest it missed (#714): no picks, scored as the lineup
 * its family gives a missed event (`scoreMissedLineup`), so it ranks with the entries that played.
 */
export function buildMissedEventStanding(
  entry: ContestLeaderboardEntryInput,
  missedScore: number | null,
  countingRule: ContestCountingRule,
  direction: ScoreDirection,
): ContestEntryStandingRow {
  return {
    ...buildContestEntryStanding({ ...entry, picks: [] }, new Map(), countingRule, direction),
    score: missedScore,
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

/** An entry's score in one event of its contest, live or frozen (#713). */
export interface ContestEntryEventScore {
  entryId: string;
  sportEventId: string;
  score: number | null;
  scoredPickCount: number;
}

/** An entry as the contest total ranks it: who it is, its total, and its place by that total. */
export interface ContestEntryTotal {
  entryId: string;
  entryName: string;
  entryNumber: number;
  /** The sum of the entry's scored events; null while none is scored. */
  score: number | null;
  /** Picks scored across its events. */
  scoredPickCount: number;
  position: number | null;
  displayPosition: string | null;
}

/**
 * The contest total (#713): each entry's scores in the events it submitted, summed, and ranked
 * by the contest's scoring direction. An entry with no score in any event is unscored. In a
 * one-event contest the total is that event's score, ranked as the event ranks it.
 */
export function rankContestTotals(
  entries: readonly Pick<ContestLeaderboardEntryInput, 'id' | 'entryNumber' | 'name'>[],
  eventScores: readonly ContestEntryEventScore[],
  direction: ScoreDirection,
): ContestEntryTotal[] {
  const scoresByEntry = new Map<string, ContestEntryEventScore[]>();
  for (const eventScore of eventScores) {
    scoresByEntry.set(eventScore.entryId, [...(scoresByEntry.get(eventScore.entryId) ?? []), eventScore]);
  }
  const totals = entries.map((entry) => {
    const scores = scoresByEntry.get(entry.id) ?? [];
    const scored = scores.flatMap((eventScore) => (eventScore.score === null ? [] : [eventScore.score]));
    return {
      entryId: entry.id,
      entryName: entry.name,
      entryNumber: entry.entryNumber,
      score: scored.length > 0 ? scored.reduce((sum, score) => sum + score, 0) : null,
      scoredPickCount: scores.reduce((sum, eventScore) => sum + eventScore.scoredPickCount, 0),
    };
  });
  const sorted = totals.sort((left, right) =>
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
 * A settled contest's totals answer from its frozen standings (#713), as a settled event's
 * standings do (`applySettledContestStandings`): each entry's total and rank are the frozen
 * ones, in the frozen order, unranked last; an entry with no standing sorts after them all.
 */
export function applySettledContestTotals(
  totals: readonly ContestEntryTotal[],
  standings: readonly SettledContestEntryStanding[],
): ContestEntryTotal[] {
  const byEntryId = new Map(standings.map((standing) => [standing.contestEntryId, standing]));
  const rank = (total: ContestEntryTotal) => {
    const standing = byEntryId.get(total.entryId);
    if (!standing) return Number.MAX_SAFE_INTEGER;
    return standing.position ?? Number.MAX_SAFE_INTEGER - 1;
  };
  return totals
    .map((total) => {
      const standing = byEntryId.get(total.entryId);
      return standing
        ? { ...total, score: standing.score, position: standing.position, displayPosition: standing.displayPosition }
        : total;
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

