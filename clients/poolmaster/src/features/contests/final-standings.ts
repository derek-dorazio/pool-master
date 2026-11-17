import { formatAndList, formatOrdinal, type TrophyMetal, type WinnersPlace } from '@/features/shared/ui';

/** One entry on a final board, as the winners banner reads it. */
export type FinalRow = {
  entryName: string;
  isMine: boolean;
  /** The entry's place; null for an entry the board never placed. */
  position: number | null;
  /** Its score as the board words it, such as "11 pts". */
  score: string;
};

/** What a final contest's winners banner shows (#1768). */
export type FinalStandings = {
  runnersUp: WinnersPlace[];
  winner: WinnersPlace;
  yourFinish: string | null;
};

const METALS: Readonly<Record<number, TrophyMetal>> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

function placeAt(position: number, rows: FinalRow[], metal: TrophyMetal): WinnersPlace {
  const ordinal = formatOrdinal(position);
  return {
    label: rows.length > 1 ? `Tied for ${ordinal}` : position === 1 ? 'Winner' : ordinal,
    metal,
    names: rows.map((row) => row.entryName),
    score: rows[0]?.score ?? '',
  };
}

/**
 * A final board's winners (#1768): the entries at 1st, then those at 2nd and 3rd where the board
 * has them, each tie naming everyone at the place; a tie for 1st shows only the tied winners; and
 * the viewer's finish, every entry of theirs best first, "of" every entry on the board. Null when
 * the board placed nobody.
 */
export function describeFinalStandings(rows: readonly FinalRow[], locale?: string): FinalStandings | null {
  const placed = rows
    .filter((row): row is FinalRow & { position: number } => row.position !== null)
    .sort((a, b) => a.position - b.position);
  const byPosition = new Map<number, FinalRow[]>();
  for (const row of placed) {
    byPosition.set(row.position, [...(byPosition.get(row.position) ?? []), row]);
  }
  if (placed.length === 0) {
    return null;
  }
  const first = placed[0].position;
  const winners = byPosition.get(first) ?? [];
  // A tie for 1st is the whole banner: it names everyone tied, with no runners-up beneath them.
  const runnersUp = winners.length > 1 ? [] : [2, 3]
    .filter((position) => position > first && byPosition.has(position))
    .map((position) => placeAt(position, byPosition.get(position) ?? [], METALS[position] ?? 'bronze'));
  const mine = placed.filter((row) => row.isMine).map((row) => formatOrdinal(row.position));
  return {
    runnersUp,
    winner: placeAt(first, winners, 'gold'),
    yourFinish: mine.length ? `You finished ${formatAndList(mine, locale)} of ${String(rows.length)}` : null,
  };
}
