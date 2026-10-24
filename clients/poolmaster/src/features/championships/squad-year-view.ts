import { CupTrophy, TrophyKind } from '@poolmaster/shared/domain';
import type { ChampionshipStandingRowDto, SquadChampionshipDto, SquadCupDto, SquadTrophyDto, SquadYearDto } from '@/lib/api';
import { historyCupsOnShow, historyYearTitle } from './championship-view';
import { formatCupPoints, formatPlace } from './cup-view';

/** The squad's own counts, as the Championship tab's tiles count them for every squad. */
export const SQUAD_MEDAL_TILES: { key: string; label: string; count: (row: ChampionshipStandingRowDto) => number }[] = [
  { key: 'firsts', label: '1sts', count: (row) => row.finishes[0] },
  { key: 'seconds', label: '2nds', count: (row) => row.finishes[1] },
  { key: 'thirds', label: '3rds', count: (row) => row.finishes[2] },
  { key: 'podiums', label: 'Podiums', count: (row) => row.podiums },
  { key: 'top-tens', label: 'Top tens', count: (row) => row.topTens },
  { key: 'played', label: 'Played', count: (row) => row.played },
];

/** A cup trophy as a squad's cup row names it. */
export const CUP_TROPHY_LABELS: Record<CupTrophy, string> = {
  [CupTrophy.CHAMPION]: 'Champion',
  [CupTrophy.RUNNER_UP]: 'Runner-up',
  [CupTrophy.THIRD]: '3rd place',
};

/** The squad's championship line: its place of N and how far it is from 1st, or that nothing has counted. */
export function describeSquadChampionship(championship: SquadChampionshipDto): string {
  if (championship.contestsCounted === 0) {
    return 'No championship contest has counted yet';
  }
  const { standing } = championship;
  const place = `${formatPlace(standing)} of ${championship.squadCount} · ${formatCupPoints(standing.points)} points`;
  if (championship.pointsBehindLeader > 0) {
    return `${place} · ${formatCupPoints(championship.pointsBehindLeader)} behind 1st`;
  }
  const isShared = standing.displayPosition.startsWith('T');
  if (championship.isOver) {
    return `${place} · ${isShared ? 'Co-champion' : 'Champion'}`;
  }
  return `${place} · ${isShared ? 'Shares the lead' : 'Leads'}`;
}

/** A squad's cup line: its place of N and points, and its trophy once crowned. */
export function describeSquadCup(cup: SquadCupDto): string {
  const line = `${formatPlace(cup.standing)} of ${cup.squadCount} · ${formatCupPoints(cup.standing.points)} points`;
  return cup.standing.trophy === null ? line : `${line} · ${CUP_TROPHY_LABELS[cup.standing.trophy]}`;
}

/** A trophy on the squad's shelf: "2025 NFL Cup · Champion". */
export function describeSquadTrophy(trophy: SquadTrophyDto): string {
  return `${trophy.name} · ${CUP_TROPHY_LABELS[trophy.trophy]}`;
}

/** Whether a trophy is a league championship's, for its icon and link. */
export function isChampionshipTrophy(trophy: SquadTrophyDto): boolean {
  return trophy.kind === TrophyKind.CHAMPIONSHIP;
}

/** The cups on show that the squad placed in: every active squad has a 0-point row, which the strip leaves out. */
function cupsPlacedOnShow(cups: SquadCupDto[]): SquadCupDto[] {
  return historyCupsOnShow(cups).filter((cup) => cup.standing.contestsCounted > 0);
}

/** The years the squad's All years strip lists: each one it placed in the championship or in a cup on show. */
export function squadYearsPlaced(years: SquadYearDto[]): SquadYearDto[] {
  return years.filter((year) => (year.championship?.standing.played ?? 0) > 0 || cupsPlacedOnShow(year.cups).length > 0);
}

/** A year's line in the strip: its championship place, then each cup on show it placed in, with its trophy or place. */
export function describeSquadYearLine(year: SquadYearDto, currentYear: number): { title: string; detail: string } {
  const parts = [
    ...(year.championship && year.championship.standing.played > 0
      ? [`Championship ${formatPlace(year.championship.standing)} of ${year.championship.squadCount}`]
      : []),
    ...cupsPlacedOnShow(year.cups).map((cup) => `${cup.name} ${cup.standing.trophy === null ? formatPlace(cup.standing) : CUP_TROPHY_LABELS[cup.standing.trophy].toLowerCase()}`),
  ];
  return { title: historyYearTitle({ year: year.year, isOver: year.year < currentYear }), detail: parts.join(' · ') };
}
