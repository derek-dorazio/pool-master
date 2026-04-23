/**
 * ProviderRegistry — manages explicit provider registration, lookup, and health
 * reporting.
 *
 * The active service tier must only call explicitly configured external data
 * providers. Hidden in-process fallback providers are not allowed because they
 * mask real configuration and ingestion defects.
 */

import type { Sport } from '@poolmaster/shared/domain';
import type { SportDataProvider, ProviderHealthStatus } from './provider-interface';

type Priority = 'PRIMARY';

interface RegisteredProvider {
  provider: SportDataProvider;
  priority: Priority;
  sport: Sport;
  health: ProviderHealthStatus;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();

  /** Registers a provider for a specific sport with a priority. */
  register(sport: Sport, provider: SportDataProvider, priority: Priority): void {
    const key = `${sport}:${priority}`;
    this.providers.set(key, {
      provider,
      priority,
      sport,
      health: {
        providerId: provider.providerId,
        status: 'HEALTHY',
        errorRateLastHour: 0,
        latencyMsP95: 0,
      },
    });
  }

  /** Gets the explicitly configured provider for a sport. */
  getProvider(sport: Sport): SportDataProvider | null {
    const primary = this.providers.get(`${sport}:PRIMARY`);
    return primary?.provider ?? null;
  }

  /** Gets a specific provider by ID. */
  getProviderById(providerId: string): SportDataProvider | null {
    for (const reg of this.providers.values()) {
      if (reg.provider.providerId === providerId) {
        return reg.provider;
      }
    }
    return null;
  }

  /** Returns all registered providers for a sport. */
  getProvidersForSport(sport: Sport): SportDataProvider[] {
    const result: SportDataProvider[] = [];
    const primary = this.providers.get(`${sport}:PRIMARY`);
    if (primary) result.push(primary.provider);
    return result;
  }

  /** Returns all unique registered providers. */
  getAllProviders(): SportDataProvider[] {
    const seen = new Set<string>();
    const result: SportDataProvider[] = [];
    for (const reg of this.providers.values()) {
      if (!seen.has(reg.provider.providerId)) {
        seen.add(reg.provider.providerId);
        result.push(reg.provider);
      }
    }
    return result;
  }

  /** Updates health status for a provider. */
  updateHealth(providerId: string, health: ProviderHealthStatus): void {
    for (const [, reg] of this.providers) {
      if (reg.provider.providerId === providerId) {
        reg.health = health;
      }
    }
  }

  /** Returns health report for all registered providers. */
  getHealthReport(): ProviderHealthStatus[] {
    const seen = new Set<string>();
    const report: ProviderHealthStatus[] = [];
    for (const reg of this.providers.values()) {
      if (!seen.has(reg.provider.providerId)) {
        seen.add(reg.provider.providerId);
        report.push(reg.health);
      }
    }
    return report;
  }

  /** Returns all sports that have at least one registered provider. */
  getSupportedSports(): Sport[] {
    const sports = new Set<Sport>();
    for (const reg of this.providers.values()) {
      sports.add(reg.sport);
    }
    return Array.from(sports);
  }
}
