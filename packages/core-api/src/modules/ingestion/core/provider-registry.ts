/**
 * ProviderRegistry — manages explicit provider registration and lookup.
 *
 * The active service tier must only call explicitly configured external data
 * providers. Hidden in-process fallback providers are not allowed because they
 * mask real configuration and ingestion defects.
 */

import type { Sport } from '@poolmaster/shared/domain';
import type { SportDataProvider } from './provider-interface';

/**
 * PRIMARY is the provider a sport's catalog browse and new links default to; a sport has at
 * most one. SECONDARY providers also serve the sport, for the events linked to them, so two
 * providers can feed the same sport at once (#1495).
 */
export type ProviderPriority = 'PRIMARY' | 'SECONDARY';

export class ProviderRegistry {
  private readonly providersById = new Map<string, SportDataProvider>();
  /** Each sport's providers by id, with the priority each serves it at. */
  private readonly sportProviders = new Map<Sport, Map<string, ProviderPriority>>();

  /**
   * Registers a provider for a sport. A PRIMARY replaces the sport's previous primary.
   */
  register(sport: Sport, provider: SportDataProvider, priority: ProviderPriority): void {
    const forSport = this.sportProviders.get(sport) ?? new Map<string, ProviderPriority>();
    if (priority === 'PRIMARY') {
      for (const [providerId, existing] of forSport) {
        if (existing === 'PRIMARY') forSport.delete(providerId);
      }
    }
    forSport.set(provider.providerId, priority);
    this.sportProviders.set(sport, forSport);
    this.providersById.set(provider.providerId, provider);
  }

  /** The sport's PRIMARY provider. */
  getProvider(sport: Sport): SportDataProvider | null {
    for (const [providerId, priority] of this.sportProviders.get(sport) ?? []) {
      if (priority === 'PRIMARY') return this.getProviderById(providerId);
    }
    return null;
  }

  /** Every provider serving the sport, primary or not. */
  getProvidersForSport(sport: Sport): SportDataProvider[] {
    return [...(this.sportProviders.get(sport)?.keys() ?? [])]
      .flatMap((providerId) => this.getProviderById(providerId) ?? []);
  }

  /** A provider by id, while it still serves some sport. */
  getProviderById(providerId: string): SportDataProvider | null {
    const servesASport = [...this.sportProviders.values()].some((forSport) => forSport.has(providerId));
    return servesASport ? this.providersById.get(providerId) ?? null : null;
  }

  /** Returns all unique registered providers. */
  getAllProviders(): SportDataProvider[] {
    return [...this.providersById.keys()].flatMap((providerId) => this.getProviderById(providerId) ?? []);
  }

  /** Returns all sports that have at least one registered provider. */
  getSupportedSports(): Sport[] {
    return [...this.sportProviders.entries()]
      .filter(([, forSport]) => forSport.size > 0)
      .map(([sport]) => sport);
  }
}
