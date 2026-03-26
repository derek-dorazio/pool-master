/**
 * Fallback participant photos — sport/position-specific silhouettes
 * used when a participant has no photo_url from the data provider.
 */

import type { Sport } from '@poolmaster/shared/domain';

const FALLBACK_PHOTOS: Record<string, Record<string, string>> = {
  GOLF: {
    default: '/assets/participants/golf-silhouette.webp',
  },
  NFL: {
    QB: '/assets/participants/nfl-qb-silhouette.webp',
    WR: '/assets/participants/nfl-wr-silhouette.webp',
    RB: '/assets/participants/nfl-rb-silhouette.webp',
    TE: '/assets/participants/nfl-te-silhouette.webp',
    K: '/assets/participants/nfl-k-silhouette.webp',
    DEF: '/assets/participants/nfl-def-silhouette.webp',
    default: '/assets/participants/nfl-player-silhouette.webp',
  },
  NBA: {
    default: '/assets/participants/nba-player-silhouette.webp',
  },
  F1: {
    default: '/assets/participants/f1-helmet-silhouette.webp',
  },
  NASCAR: {
    default: '/assets/participants/nascar-car-silhouette.webp',
  },
  NCAA_BASKETBALL: {
    default: '/assets/participants/ncaa-team-logo-placeholder.webp',
  },
  NCAA_FOOTBALL: {
    default: '/assets/participants/ncaa-team-logo-placeholder.webp',
  },
  NCAA_HOCKEY: {
    default: '/assets/participants/ncaa-team-logo-placeholder.webp',
  },
  TENNIS: {
    default: '/assets/participants/tennis-silhouette.webp',
  },
  HORSE_RACING: {
    default: '/assets/participants/horse-silhouette.webp',
  },
  SOCCER: {
    default: '/assets/participants/soccer-player-silhouette.webp',
  },
  NHL: {
    default: '/assets/participants/nhl-player-silhouette.webp',
  },
  MLB: {
    default: '/assets/participants/mlb-player-silhouette.webp',
  },
  UFC: {
    default: '/assets/participants/ufc-fighter-silhouette.webp',
  },
};

const GENERIC_FALLBACK = '/assets/participants/generic-silhouette.webp';

/**
 * Returns the appropriate fallback photo URL for a participant.
 * Checks sport + position first, then sport default, then generic.
 */
export function getFallbackPhoto(sport: Sport, position?: string): string {
  const sportPhotos = FALLBACK_PHOTOS[sport];
  if (!sportPhotos) return GENERIC_FALLBACK;

  if (position && sportPhotos[position]) {
    return sportPhotos[position];
  }

  return sportPhotos['default'] ?? GENERIC_FALLBACK;
}

/**
 * Returns the photo URL for a participant, falling back to a silhouette
 * if no photo is available.
 */
export function resolvePhotoUrl(
  photoUrl: string | undefined,
  sport: Sport,
  position?: string,
): string {
  return photoUrl ?? getFallbackPhoto(sport, position);
}
