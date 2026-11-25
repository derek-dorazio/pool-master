/**
 * The one reduction of a BALLDONTLIE game to the place the vendor itself puts it in (league model
 * slice 8, #2005): its season type and the vendor's own week or round for it, as the code the
 * sport league's slot provider mappings name (`REG:5`, `POST:3`). The code is the vendor's value
 * as it stands, never PoolMaster's numbering: which slot it is, and whether a code is synced at
 * all, is the mappings' to say. A code no mapping includes (a preseason week, an all-star game's
 * week) is not synced, and the sync raises a finding for it.
 */

import type { ProviderSlotPlay } from '@poolmaster/shared/domain';

/** The vendor's two season types a game's code starts with. */
export const ProviderSeasonType = {
  REGULAR_SEASON: 'REG',
  POSTSEASON: 'POST',
} as const;
export type ProviderSeasonType = (typeof ProviderSeasonType)[keyof typeof ProviderSeasonType];

/** A game's code: its season type and the vendor's week or round for it. */
export function providerSlotCode(seasonType: ProviderSeasonType, place: number): string {
  return `${seasonType}:${String(place)}`;
}

/** One game as the reduction reads it: its code and its start, in epoch milliseconds. */
export interface CodedGame {
  code: string;
  start: number;
}

/** The places an event's games are in, each once with its games' earliest and latest start, earliest first. */
export function slotPlaysOf(games: readonly CodedGame[]): ProviderSlotPlay[] {
  const byCode = new Map<string, { first: number; last: number }>();
  for (const game of games) {
    const span = byCode.get(game.code);
    byCode.set(game.code, span === undefined
      ? { first: game.start, last: game.start }
      : { first: Math.min(span.first, game.start), last: Math.max(span.last, game.start) });
  }
  return [...byCode]
    .map(([code, span]) => ({ code, startsAt: new Date(span.first), endsAt: new Date(span.last) }))
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}
