/**
 * A sport league's sync provider as a narrow read needs it (#1997): the id its selected provider
 * mapping's provider gives its events and that provider's name, or null when the league is not synced.
 */
import type { Prisma } from '@prisma/client';
import { providerSourceIdOf } from '@poolmaster/shared/domain';

/** Select it beside a sport league's other columns. */
export const SYNC_PROVIDER_SELECT = {
  selectedProviderMapping: { select: { providerLeague: { select: { provider: { select: { code: true, name: true } } } } } },
} satisfies Prisma.SportLeagueSelect;

export type SyncProviderRow = Prisma.SportLeagueGetPayload<{ select: typeof SYNC_PROVIDER_SELECT }>;

/** The provider id the league's synced events carry; null when the league is not synced. */
export function syncProviderIdOf(row: SyncProviderRow): string | null {
  const provider = row.selectedProviderMapping?.providerLeague.provider;
  return provider === undefined ? null : providerSourceIdOf(provider.code);
}

/** That provider's name (#1999), so no reader looks it up by id; null when the league is not synced. */
export function syncProviderNameOf(row: SyncProviderRow): string | null {
  return row.selectedProviderMapping?.providerLeague.provider.name ?? null;
}
