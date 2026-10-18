/**
 * A bracket contest's standings (#721): each submitted entry's standing picks scored against the
 * bracket's results and ranked, with the final's total points as the tiebreaker. One read for the
 * live bracket leaderboard and for settlement, so the two cannot drift apart, as
 * contest-leaderboard-reads.ts is for roster contests. The rules are in bracket-picks.ts.
 */
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntryWithSquad,
  SportEventMatchRepository,
} from '@poolmaster/shared/db';
import { MatchStatus } from '@poolmaster/shared/domain';
import {
  finalTotalPoints,
  rankBracketStandings,
  resolveBracketPicks,
  scoreBracketPicks,
  type BracketScore,
} from '../scoring-families/head-to-head/bracket-picks';
import { knockoutSeeds } from '../scoring-families/head-to-head/score-team';
import { resolveContestScoringDefinition, type ContestScoringResolutionFailure } from './contest-leaderboard-calculator';
import {
  loadContestScoringConfiguration,
  loadEventField,
  type ContestLeaderboardReadDeps,
} from './contest-leaderboard-reads';

export interface BracketStandingsReadDeps extends ContestLeaderboardReadDeps {
  predictions: Pick<ContestEntryMatchPredictionRepository, 'findByEntriesAndEvent'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
}

export interface BracketEntryStanding {
  entry: ContestEntryWithSquad;
  score: BracketScore;
  position: number;
  displayPosition: string;
}

export interface BracketStandings {
  /** The final's combined score once it is played: what the tiebreakers are measured against. */
  finalTotalPoints: number | null;
  /** The bracket's games, cancelled ones left out: an entry picks each one. */
  gameCount: number;
  /** Ranked, best first. */
  entries: BracketEntryStanding[];
}

/** Why a bracket cannot be scored: its rule failed to resolve, or names another definition than knockout round points. */
export type BracketScoringFailure = ContestScoringResolutionFailure | 'NOT_KNOCKOUT_ROUND_POINTS';

/** A bracket contest whose scoring rule cannot score it. Contest setup refuses every such rule. */
export class BracketScoringUnavailableError extends Error {
  constructor(contestId: string, readonly reason: BracketScoringFailure) {
    super(`Contest ${contestId}'s bracket cannot be scored: ${reason}`);
    this.name = 'BracketScoringUnavailableError';
  }
}

/** The contest's entries that submitted the event, scored and ranked. */
export async function loadBracketStandings(
  deps: BracketStandingsReadDeps,
  contestId: string,
  sportEventId: string,
): Promise<BracketStandings> {
  const [configuration, entries, matches, field] = await Promise.all([
    loadContestScoringConfiguration(deps, contestId),
    deps.entries.findByContestWithSquad(contestId, { submittedFor: sportEventId }),
    deps.matches.findBySportEvent(sportEventId),
    loadEventField(deps, sportEventId),
  ]);
  const scoring = resolveContestScoringDefinition(configuration);
  if (!scoring.ok) {
    throw new BracketScoringUnavailableError(contestId, scoring.reason);
  }
  if (scoring.scoring.participantScoringDefinitionId !== 'KNOCKOUT_ROUND_POINTS') {
    throw new BracketScoringUnavailableError(contestId, 'NOT_KNOCKOUT_ROUND_POINTS');
  }
  const settings = scoring.scoring.config;
  const games = matches.filter((match) => match.status !== MatchStatus.CANCELLED);
  const seedOf = knockoutSeeds(field.map((row) => row.entry));
  const predictions = await deps.predictions.findByEntriesAndEvent(entries.map((entry) => entry.id), sportEventId);

  const scored = entries.map((entry) => {
    const picks = predictions.filter((prediction) => prediction.contestEntryId === entry.id);
    const { kept } = resolveBracketPicks(games, picks, seedOf);
    return { entry, score: scoreBracketPicks(games, kept, seedOf, settings) };
  });
  const finalTotal = finalTotalPoints(games);
  const ranks = new Map(rankBracketStandings(
    scored.map(({ entry, score }) => ({ entryId: entry.id, points: score.points, tiebreakerValue: entry.tiebreakerValue ?? null })),
    finalTotal,
  ).map((rank) => [rank.entryId, rank]));
  return {
    finalTotalPoints: finalTotal,
    gameCount: games.length,
    entries: scored
      .flatMap(({ entry, score }) => {
        const rank = ranks.get(entry.id);
        return rank ? [{ entry, score, position: rank.position, displayPosition: rank.displayPosition }] : [];
      })
      .sort((left, right) => left.position - right.position || left.entry.entryNumber - right.entry.entryNumber || left.entry.name.localeCompare(right.entry.name)),
  };
}
