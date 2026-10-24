import { formatSelectionTypeName } from '@poolmaster/shared/domain';
import type { PerpetualTrophyDto, PerpetualTrophyPlateDto } from '@/lib/api';
import { joinNames } from './cup-view';

/** A perpetual trophy's name, from its series and way of picking: "Super Bowl Squares". */
export function perpetualTrophyName(trophy: Pick<PerpetualTrophyDto, 'seriesName' | 'selectionType'>): string {
  return `${trophy.seriesName} ${formatSelectionTypeName(trophy.selectionType)}`;
}

/**
 * A plate's line on a squad's trophy case, with the sports league so the men's and women's
 * trophies of a shared series tell apart: "2026 US Open Bracket (ATP)".
 */
export function describeWonPlate({ trophy, plate }: WonPlate): string {
  return `${plate.year} ${perpetualTrophyName(trophy)} (${trophy.sportLeagueName})`;
}

/** Who a plate names: "Gimme Putts", "Gimme Putts and Fore Play", or "No result" when nobody placed. */
export function describePlateWinners(plate: PerpetualTrophyPlateDto): string {
  return plate.winners.length ? joinNames(plate.winners.map((squad) => squad.squadName)) : 'No result';
}

/** One plate a squad won, with the trophy it is on. */
export interface WonPlate {
  trophy: PerpetualTrophyDto;
  plate: PerpetualTrophyPlateDto;
}

/** The plates a squad's name is on, newest year first, then by trophy. */
export function platesWonBy(trophies: PerpetualTrophyDto[], squadId: string): WonPlate[] {
  return trophies
    .flatMap((trophy) => trophy.plates
      .filter((plate) => plate.winners.some((squad) => squad.squadId === squadId))
      .map((plate) => ({ trophy, plate })))
    .sort((left, right) => right.plate.year - left.plate.year);
}
