import type { ProviderLeagueSettings, ProviderLeagueSettingsUpdate, ProviderSettings, ProviderSettingsUpdate } from '../domain';

/** The Provider and ProviderLeague tables (#1997). */
export interface ProviderSettingsRepository {
  /** Every provider with its leagues, by code, in one query. */
  findAll(): Promise<ProviderSettings[]>;
  /** One provider with its leagues; null when there is none. */
  findById(id: string): Promise<ProviderSettings | null>;
  /** Changes a provider's settings; 'NOT_FOUND' when there is none. */
  update(id: string, updates: ProviderSettingsUpdate): Promise<ProviderSettings | 'NOT_FOUND'>;
  /** Changes one of a provider's leagues; null when the provider has no such league. */
  updateLeague(providerId: string, leagueId: string, updates: ProviderLeagueSettingsUpdate): Promise<ProviderLeagueSettings | null>;
}
