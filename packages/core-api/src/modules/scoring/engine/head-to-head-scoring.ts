/**
 * Head-to-Head Scoring Engine — weekly matchup scoring.
 *
 * Entries are paired each period (week/round). Each pair compares their
 * period scores. The winner gets a win, the loser a loss, and ties are
 * possible. Season record is accumulated across all periods.
 */

/** A single matchup between two entries for a period. */
export interface Matchup {
  period: number;
  entryIdA: string;
  entryIdB: string;
}

/** Period scores for all entries. */
export interface PeriodScores {
  period: number;
  scores: Record<string, number>; // entryId → score for this period
}

/** Result of a single matchup. */
export interface MatchupResult {
  period: number;
  entryIdA: string;
  entryIdB: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null; // null if tie
}

/** Season record for an entry. */
export interface H2HRecord {
  entryId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  winPct: number;
}

/**
 * Evaluate a single matchup given the period scores.
 */
export function evaluateMatchup(
  matchup: Matchup,
  periodScores: PeriodScores,
): MatchupResult {
  const scoreA = periodScores.scores[matchup.entryIdA] ?? 0;
  const scoreB = periodScores.scores[matchup.entryIdB] ?? 0;

  let winnerId: string | null = null;
  if (scoreA > scoreB) winnerId = matchup.entryIdA;
  else if (scoreB > scoreA) winnerId = matchup.entryIdB;

  return {
    period: matchup.period,
    entryIdA: matchup.entryIdA,
    entryIdB: matchup.entryIdB,
    scoreA,
    scoreB,
    winnerId,
  };
}

/**
 * Calculate season records from all matchup results.
 */
export function calculateRecords(
  matchupResults: MatchupResult[],
  entryIds: string[],
): H2HRecord[] {
  const records = new Map<string, H2HRecord>();

  for (const id of entryIds) {
    records.set(id, {
      entryId: id,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      winPct: 0,
    });
  }

  for (const result of matchupResults) {
    const recA = records.get(result.entryIdA);
    const recB = records.get(result.entryIdB);

    if (recA) {
      recA.pointsFor += result.scoreA;
      recA.pointsAgainst += result.scoreB;
      if (result.winnerId === result.entryIdA) recA.wins++;
      else if (result.winnerId === result.entryIdB) recA.losses++;
      else recA.ties++;
    }

    if (recB) {
      recB.pointsFor += result.scoreB;
      recB.pointsAgainst += result.scoreA;
      if (result.winnerId === result.entryIdB) recB.wins++;
      else if (result.winnerId === result.entryIdA) recB.losses++;
      else recB.ties++;
    }
  }

  // Calculate win percentages
  for (const rec of records.values()) {
    const totalGames = rec.wins + rec.losses + rec.ties;
    rec.winPct = totalGames > 0 ? (rec.wins + rec.ties * 0.5) / totalGames : 0;
  }

  return [...records.values()].sort((a, b) => {
    // Sort by win%, then points for as tiebreaker
    if (a.winPct !== b.winPct) return b.winPct - a.winPct;
    return b.pointsFor - a.pointsFor;
  });
}

/**
 * Score a full season of head-to-head matchups.
 *
 * Takes all matchups and all period scores, evaluates each matchup,
 * and returns sorted season standings.
 */
export function scoreHeadToHead(
  matchups: Matchup[],
  periodScoresArray: PeriodScores[],
  entryIds: string[],
): { matchupResults: MatchupResult[]; standings: H2HRecord[] } {
  // Index period scores by period number
  const periodMap = new Map<number, PeriodScores>();
  for (const ps of periodScoresArray) {
    periodMap.set(ps.period, ps);
  }

  // Evaluate all matchups
  const matchupResults: MatchupResult[] = [];
  for (const matchup of matchups) {
    const periodScores = periodMap.get(matchup.period);
    if (!periodScores) continue;
    matchupResults.push(evaluateMatchup(matchup, periodScores));
  }

  const standings = calculateRecords(matchupResults, entryIds);

  return { matchupResults, standings };
}
