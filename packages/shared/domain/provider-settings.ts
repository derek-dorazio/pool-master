/**
 * A data provider's settings and its own leagues (#1997, plans/league-model-redesign.md §4): one
 * Provider row per provider and one ProviderLeague row per league it serves, seeded by migration
 * and edited on the Providers page. Each environment's database holds its own values; the API key
 * and webhook secret stay in Secrets Manager.
 */
import type { ProviderCode, ProviderWebhookEventSet, Sport } from './enums';

/** The ranges each provider setting is held to, in the API and the database alike. */
export const PROVIDER_REQUESTS_PER_MINUTE_RANGE = { min: 1, max: 6000 } as const;
export const PROVIDER_POLL_MINUTES_RANGE = { min: 1, max: 240 } as const;
export const PROVIDER_LEAGUE_MINUTES_RANGE = { min: 1, max: 1440 } as const;

/** One of a provider's own leagues. */
export interface ProviderLeagueSettings {
  id: string;
  providerId: string;
  /** The provider's own code for the league (`nfl`), as its API names it. */
  code: string;
  /** The provider's own name for the league. */
  name: string;
  sport: Sport;
  webhookEventSet: ProviderWebhookEventSet;
  /** How long a game may go between two of its notifications in normal play, in minutes. */
  quietAfterMinutes: number;
  /** How long one of its games usually takes from its scheduled start, in minutes. */
  typicalGameMinutes: number;
  isEnabled: boolean;
}

/** One data provider, with its leagues by code. */
export interface ProviderSettings {
  id: string;
  code: ProviderCode;
  name: string;
  baseUrl: string;
  /** The provider plan's request limit a minute. */
  requestsPerMinute: number;
  /** Whether its webhooks are taken: only while its signing secret is set too. */
  webhooksEnabled: boolean;
  /** A notified event's safety-net poll while in play, in minutes. */
  webhookPollMinutes: number;
  /** A notified event played in rounds, polled this often while a round is under way, in minutes. */
  webhookRoundPollMinutes: number;
  hasPlayerStats: boolean;
  isEnabled: boolean;
  leagues: ProviderLeagueSettings[];
}

/** What a root admin may change on a provider. */
export type ProviderSettingsUpdate = Partial<Pick<ProviderSettings,
  'baseUrl' | 'requestsPerMinute' | 'webhooksEnabled' | 'webhookPollMinutes' | 'webhookRoundPollMinutes' | 'hasPlayerStats' | 'isEnabled'>>;

/** What a root admin may change on one of a provider's leagues. */
export type ProviderLeagueSettingsUpdate = Partial<Pick<ProviderLeagueSettings, 'quietAfterMinutes' | 'typicalGameMinutes' | 'isEnabled'>>;
