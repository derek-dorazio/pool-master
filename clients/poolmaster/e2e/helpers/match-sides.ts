/**
 * #2184 — a bracket's matches as the API takes and gives them, on sides: side 1 and side 2, each
 * with its field row and where it plays game 1. A synced game has its away team on side 1 and its
 * home team on side 2, so a journey that thinks in home and away teams writes them through here.
 */

export const AWAY_SIDE = 1;
export const HOME_SIDE = 2;

type HomeAway = 'HOME' | 'AWAY' | 'NONE';

/** One match of a bracket load, on its sides. */
export type BracketLoadMatch = {
  matchNumber: number;
  roundNumber: number;
  sides: { sideNumber: number; sportEventParticipantId: string | null; homeAway: HomeAway }[];
  isNeutralSite: boolean;
  scheduledDate: string | null;
  advancesTo: { roundNumber: number; matchNumber: number; sideNumber: number } | null;
};

/** A load match from its home and away teams: away on side 1, home on side 2. */
export function bracketLoadMatch(match: {
  matchNumber: number;
  roundNumber: number;
  home: string | null;
  away: string | null;
  isNeutralSite: boolean;
  scheduledDate: string | null;
  advancesTo: { roundNumber: number; matchNumber: number; sideNumber: number } | null;
}): BracketLoadMatch {
  const { home, away, ...rest } = match;
  return {
    ...rest,
    sides: [
      { sideNumber: AWAY_SIDE, sportEventParticipantId: away, homeAway: match.isNeutralSite ? 'NONE' : 'AWAY' },
      { sideNumber: HOME_SIDE, sportEventParticipantId: home, homeAway: match.isNeutralSite ? 'NONE' : 'HOME' },
    ],
  };
}

/** A match as the bracket read answers it, with only what the journeys read. */
export type BracketReadMatch = {
  roundNumber: number;
  matchNumber: number;
  sides: { sideNumber: number; sportEventParticipantId: string | null }[];
};

/** The field row on a side of a read match, or null while undecided. */
export function teamOn(match: BracketReadMatch | undefined, sideNumber: number): string | null {
  return match?.sides.find((side) => side.sideNumber === sideNumber)?.sportEventParticipantId ?? null;
}
