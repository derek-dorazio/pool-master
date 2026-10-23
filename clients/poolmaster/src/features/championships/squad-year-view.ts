import { CupStatus, CupTrophy } from '@poolmaster/shared/domain';
import type { ChampionshipStandingRowDto, SquadChampionshipDto, SquadCupDto, SquadDto } from '@/lib/api';
import { CUP_SHOWN_FROM_COUNTED, formatCupPoints, formatPlace } from './cup-view';

/** The squad's own counts, as the Championship tab's tiles count them for every squad. */
export const SQUAD_MEDAL_TILES: { key: string; label: string; count: (row: SquadChampionshipDto) => number }[] = [
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
export function describeSquadChampionship(row: SquadChampionshipDto): string {
  if (row.contestsCounted === 0) {
    return 'No championship contest has counted yet';
  }
  const place = `${formatPlace(row)} of ${row.squadCount} · ${formatCupPoints(row.points)} points`;
  if (row.pointsBehindLeader > 0) {
    return `${place} · ${formatCupPoints(row.pointsBehindLeader)} behind 1st`;
  }
  const isShared = row.displayPosition.startsWith('T');
  if (row.isOver) {
    return `${place} · ${isShared ? 'Co-champion' : 'Champion'}`;
  }
  return `${place} · ${isShared ? 'Shares the lead' : 'Leads'}`;
}

/** The squad's championship row in the finish matrix's shape, so the squad page reuses the matrix. */
export function squadMatrixRow(
  squad: Pick<SquadDto, 'id' | 'name' | 'iconKey' | 'isActive'>,
  row: SquadChampionshipDto,
): ChampionshipStandingRowDto {
  return {
    squadId: squad.id,
    squadName: squad.name,
    squadIconKey: squad.iconKey,
    squadIsActive: squad.isActive,
    position: row.position,
    displayPosition: row.displayPosition,
    points: row.points,
    finishes: row.finishes,
    podiums: row.podiums,
    topTens: row.topTens,
    played: row.played,
  };
}

/** The squad's cups on show: every crowned one, and an open one once two of its contests have counted, as on All years. */
export function squadCupsOnShow(cups: SquadCupDto[]): SquadCupDto[] {
  return cups.filter((cup) => cup.status === CupStatus.CROWNED || cup.contestsCounted >= CUP_SHOWN_FROM_COUNTED);
}

/** A squad's cup line: its place of N and points, and its trophy once crowned. */
export function describeSquadCup(cup: SquadCupDto): string {
  const line = `${formatPlace(cup)} of ${cup.squadCount} · ${formatCupPoints(cup.points)} points`;
  return cup.trophy === null ? line : `${line} · ${CUP_TROPHY_LABELS[cup.trophy]}`;
}
