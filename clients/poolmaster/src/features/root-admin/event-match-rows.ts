import { MatchResultSource, MatchSide } from '@poolmaster/shared/domain';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { describeEntry, sideEntry } from './bracket-copy';

/** Who set a match's result, as the Matches grid names it. */
export const MATCH_RESULT_SOURCE_LABELS: Record<MatchResultSource, string> = {
  [MatchResultSource.PROVIDER]: 'Feed',
  [MatchResultSource.ADMIN]: 'Admin',
};

/** One row of the Event page's Matches grid: the match, its sides and score read flat. */
export type EventMatchRow = {
  match: SportEventMatchDto;
  id: string;
  roundNumber: number;
  roundLabel: string;
  matchNumber: number;
  /** "Duke vs UNC" on a neutral site, else "Away @ Home"; a side not decided yet is "TBD". */
  pairing: string;
  scheduledDate: string | null;
  status: SportEventMatchDto['status'];
  /** "Home–Away", with the shoot-out after it; null until either side has a score. */
  score: string | null;
  winner: string | null;
  resultSource: SportEventMatchDto['resultSource'];
  completedAt: string | null;
};

function sideName(match: SportEventMatchDto, side: MatchSide, fieldById: ReadonlyMap<string, SportEventParticipantDto>): string {
  const entry = sideEntry(match, side, fieldById);
  return entry === undefined ? 'TBD' : describeEntry(entry);
}

function scoreOf(match: SportEventMatchDto): string | null {
  if (match.homeScore === null && match.awayScore === null) return null;
  const score = `${String(match.homeScore ?? 0)}–${String(match.awayScore ?? 0)}`;
  return match.homeShootoutScore === null || match.awayShootoutScore === null
    ? score
    : `${score} (${String(match.homeShootoutScore)}–${String(match.awayShootoutScore)} shoot-out)`;
}

/** The Matches grid's rows, in match order, each named by its round and its two sides. */
export function eventMatchRows(
  matches: readonly SportEventMatchDto[],
  field: readonly SportEventParticipantDto[],
  roundLabel: (roundNumber: number, roundCount: number) => string,
  roundCount: number,
): EventMatchRow[] {
  const fieldById = new Map(field.map((entry) => [entry.id, entry]));
  return matches.map((match) => {
    const home = sideName(match, MatchSide.HOME, fieldById);
    const away = sideName(match, MatchSide.AWAY, fieldById);
    return {
      match,
      id: match.id,
      roundNumber: match.roundNumber,
      roundLabel: roundLabel(match.roundNumber, roundCount),
      matchNumber: match.matchNumber,
      pairing: match.isNeutralSite ? `${home} vs ${away}` : `${away} @ ${home}`,
      scheduledDate: match.scheduledDate,
      status: match.status,
      score: scoreOf(match),
      winner: match.winnerSide === null ? null : match.winnerSide === MatchSide.HOME ? home : away,
      resultSource: match.resultSource,
      completedAt: match.completedAt,
    };
  });
}
