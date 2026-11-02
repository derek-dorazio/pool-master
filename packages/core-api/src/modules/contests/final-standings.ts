import type { ContestEntryRepository, ContestEntryStandingRepository } from '@poolmaster/shared/db';
import { ContestFormat, type Contest, type ParticipantScoringDefinitionId } from '@poolmaster/shared/domain';
import { loadContestScoringConfiguration, type ContestLeaderboardReadDeps } from './contest-leaderboard-reads';
import { resolveContestScoringDefinition } from './contest-leaderboard-calculator';

/** A settled contest's final places, as `readFinalStandings` reads them. */
export interface ContestFinalStandings {
  /** A roster contest's scoring definition, whose format writes its totals; null for a count. */
  scoringDefinitionId: ParticipantScoringDefinitionId | null;
  /** Best first. */
  entries: Array<{ entryId: string; entryName: string; squadId: string; squadName: string; position: number | null; displayPosition: string | null; score: number | null }>;
}

export type FinalStandingsReadDeps = Pick<ContestLeaderboardReadDeps, 'configurations' | 'scoringRules'> & {
  standings: Pick<ContestEntryStandingRepository, 'findByContest'>;
  entries: Pick<ContestEntryRepository, 'findByContestWithSquad'>;
};

/**
 * A settled contest's final places, best first, from the standings frozen at settlement: what
 * the league championship and the final results email both take (#845 F1, #863, #1355). Empty
 * for a contest that ended with no scores. A roster contest names its scoring definition, whose
 * format writes its totals; every other format's totals are counts (points, weeks survived,
 * quarters won).
 */
export async function readFinalStandings(deps: FinalStandingsReadDeps, contest: Contest): Promise<ContestFinalStandings> {
  const [standings, entries] = await Promise.all([
    deps.standings.findByContest(contest.id),
    deps.entries.findByContestWithSquad(contest.id),
  ]);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const scoring = contest.contestFormat === ContestFormat.ROSTER && standings.length > 0
    ? resolveContestScoringDefinition(await loadContestScoringConfiguration(deps, contest.id))
    : null;
  return {
    scoringDefinitionId: scoring?.ok ? scoring.id : null,
    entries: standings
      .flatMap((standing) => {
        const entry = entryById.get(standing.contestEntryId);
        return entry ? [{ standing, entry }] : [];
      })
      .sort((left, right) =>
        (left.standing.position ?? Number.MAX_SAFE_INTEGER) - (right.standing.position ?? Number.MAX_SAFE_INTEGER)
        || left.entry.entryNumber - right.entry.entryNumber
        || left.entry.name.localeCompare(right.entry.name))
      .map(({ standing, entry }) => ({
        entryId: entry.id,
        entryName: entry.name,
        squadId: entry.squadId,
        squadName: entry.squadName,
        position: standing.position,
        displayPosition: standing.displayPosition,
        score: standing.totalScore,
      })),
  };
}
