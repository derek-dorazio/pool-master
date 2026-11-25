/**
 * ProviderRegistry — the provider adapters running in this task, by Provider code (#2073).
 *
 * A sport league's provider is the one its selected provider mapping names, never one chosen for
 * its sport: two leagues of one sport may sync from different providers. The active service tier
 * calls only explicitly configured providers; there is no in-process fallback provider, since one
 * would mask real configuration and ingestion defects.
 */

import type { ProviderCode, SportLeagueProviderMapping } from '@poolmaster/shared/domain';
import type { SportDataProvider } from './provider-interface';

/**
 * A sport league whose provider cannot be resolved (#2073): it has no selected provider mapping
 * (422 SPORT_LEAGUE_NOT_SYNCED), or the provider that mapping names is not running in this task
 * (404 PROVIDER_NOT_FOUND). Neither falls back to another provider of the sport.
 */
export class LeagueProviderNotResolvedError extends Error {
  readonly statusCode: 404 | 422;

  constructor(message: string, readonly code: 'SPORT_LEAGUE_NOT_SYNCED' | 'PROVIDER_NOT_FOUND') {
    super(message);
    this.name = 'LeagueProviderNotResolvedError';
    this.statusCode = code === 'PROVIDER_NOT_FOUND' ? 404 : 422;
  }
}

/** A sport league as resolving its provider needs it: its selected mapping's provider. */
export interface LeagueProviderSource<M extends Pick<SportLeagueProviderMapping, 'providerCode' | 'providerName'>> {
  name: string;
  selectedProviderMapping: M | null;
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderCode, SportDataProvider>();
  /** The same adapters by the id their feeds carry, for events and runs that name them by it. */
  private readonly bySource = new Map<string, SportDataProvider>();

  /** Registers a Provider's running adapter, in place of any earlier one of the same code. */
  register(provider: SportDataProvider): void {
    const replaced = this.providers.get(provider.providerCode);
    if (replaced !== undefined) this.bySource.delete(replaced.providerId);
    this.providers.set(provider.providerCode, provider);
    this.bySource.set(provider.providerId, provider);
  }

  /** The running adapter of this Provider, or null when it is not running here. */
  byCode(code: ProviderCode): SportDataProvider | null {
    return this.providers.get(code) ?? null;
  }

  /**
   * The running adapter whose feed carries this provider id (`balldontlie`), as events and sync
   * runs name it; null for an id no Provider carries, or one not running here.
   */
  bySourceId(providerId: string): SportDataProvider | null {
    return this.bySource.get(providerId) ?? null;
  }

  /**
   * The provider a sport league syncs from: the one its selected provider mapping names, with that
   * mapping. Throws `LeagueProviderNotResolvedError` for a league with no selected mapping, or whose
   * provider is not running here.
   */
  forLeague<M extends Pick<SportLeagueProviderMapping, 'providerCode' | 'providerName'>>(league: LeagueProviderSource<M>): { provider: SportDataProvider; mapping: M } {
    const mapping = league.selectedProviderMapping;
    if (mapping === null) {
      throw new LeagueProviderNotResolvedError(`${league.name} has no selected provider mapping, so no provider syncs it.`, 'SPORT_LEAGUE_NOT_SYNCED');
    }
    const provider = this.byCode(mapping.providerCode);
    if (provider === null) {
      throw new LeagueProviderNotResolvedError(`${league.name} syncs from ${mapping.providerName}, which is not running here.`, 'PROVIDER_NOT_FOUND');
    }
    return { provider, mapping };
  }

  /** Every running adapter. */
  all(): SportDataProvider[] {
    return [...this.providers.values()];
  }
}
