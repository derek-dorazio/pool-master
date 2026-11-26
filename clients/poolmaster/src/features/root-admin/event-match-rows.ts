import { roundLabels } from '@poolmaster/shared/display-strings';
import type { GameSideResultDto, SportEventRoundMatchDto, SportEventParticipantDto } from '@/lib/api';
import { billedSides, sideResultIn, gameOne, winningSide } from '@/lib/match-sides';
import { describeEntry, sideEntry } from './bracket-copy';

/** One row of the Event page's Matches grid: the match, its sides and score read flat. */
export type EventMatchRow = {
  match: SportEventRoundMatchDto;
  id: string;
  roundNumber: number;
  roundName: string;
  matchNumber: number;
  /** "Duke vs UNC" on a neutral site, else "Away @ Home"; a side not decided yet is "TBD". */
  pairingLabel: string;
  scheduledDate: string | null;
  status: SportEventRoundMatchDto['status'];
  /** The home side's score first ("Home–Away"), with the shoot-out after it; null until either side has a score. */
  score: string | null;
  winner: string | null;
  completedAt: string | null;
  /** Each side, side 1 first: its team and how it came out of the match. */
  sides: EventMatchSideRow[];
  /** Each game in game-number order, with each side's result in it. */
  games: EventMatchGameRow[];
};

export type EventMatchSideRow = {
  sideNumber: number;
  name: string;
  outcome: SportEventRoundMatchDto['sides'][number]['outcome'];
};

export type EventMatchGameRow = {
  gameNumber: number;
  status: SportEventRoundMatchDto['status'];
  results: Array<{ sideNumber: number; name: string } & Pick<GameSideResultDto, 'score' | 'homeAway' | 'shootoutScore' | 'periodScores'>>;
};

function sideName(match: SportEventRoundMatchDto, sideNumber: number | undefined, fieldById: ReadonlyMap<string, SportEventParticipantDto>): string {
  const entry = sideNumber === undefined ? undefined : sideEntry(match, sideNumber, fieldById);
  return entry === undefined ? 'TBD' : describeEntry(entry);
}

/** The score with the home side first (at a neutral site, side 2), and the shoot-out after it. */
function scoreOf(match: SportEventRoundMatchDto): string | null {
  const { first, second } = billedSides(match);
  if (!first || !second || (first.score === null && second.score === null)) return null;
  const score = `${String(second.score ?? 0)}–${String(first.score ?? 0)}`;
  const game = gameOne(match);
  const firstKicks = sideResultIn(game, first.sideNumber)?.shootoutScore ?? null;
  const secondKicks = sideResultIn(game, second.sideNumber)?.shootoutScore ?? null;
  return firstKicks === null || secondKicks === null
    ? score
    : `${score} (${String(secondKicks)}–${String(firstKicks)} shoot-out)`;
}

/** The Matches grid's rows, in match order, each named by its round's slot and its two sides. */
export function eventMatchRows(
  matches: readonly SportEventRoundMatchDto[],
  field: readonly SportEventParticipantDto[],
): EventMatchRow[] {
  const nameOfRound = roundLabels(matches);
  const fieldById = new Map(field.map((entry) => [entry.id, entry]));
  return matches.map((match) => {
    const { first, second, isNeutralSite } = billedSides(match);
    const away = sideName(match, first?.sideNumber, fieldById);
    const home = sideName(match, second?.sideNumber, fieldById);
    const winner = winningSide(match);
    return {
      match,
      id: match.id,
      roundNumber: match.roundNumber,
      roundName: nameOfRound(match.roundNumber),
      matchNumber: match.matchNumber,
      pairingLabel: isNeutralSite ? `${home} vs ${away}` : `${away} @ ${home}`,
      scheduledDate: match.scheduledDate,
      status: match.status,
      score: scoreOf(match),
      winner: winner === undefined ? null : sideName(match, winner.sideNumber, fieldById),
      completedAt: match.completedAt,
      sides: [...match.sides]
        .sort((left, right) => left.sideNumber - right.sideNumber)
        .map((side) => ({ sideNumber: side.sideNumber, name: sideName(match, side.sideNumber, fieldById), outcome: side.outcome })),
      games: [...match.games]
        .sort((left, right) => left.gameNumber - right.gameNumber)
        .map((game) => ({
          gameNumber: game.gameNumber,
          status: game.status,
          results: [...game.sideResults]
            .sort((left, right) => left.sideNumber - right.sideNumber)
            .map(({ sideNumber, score, homeAway, shootoutScore, periodScores }) => ({ sideNumber, name: sideName(match, sideNumber, fieldById), score, homeAway, shootoutScore, periodScores })),
        })),
    };
  });
}
