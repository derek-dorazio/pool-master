/**
 * BALLDONTLIE's Provider row and its leagues as the migration seeds them (#1997), for tests that
 * build the adapter, its webhooks or its cadence without the database.
 */
import {
  ProviderCode,
  ProviderWebhookEventSet,
  Sport,
  type ProviderLeagueSettings,
  type ProviderSettings,
} from '../../packages/shared/domain';

/** BALLDONTLIE's Provider row id as the migration seeds it. */
export const BALLDONTLIE_TEST_PROVIDER_ID = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11';
const PROVIDER_ID = BALLDONTLIE_TEST_PROVIDER_ID;

/** Each Provider row's id and name by its code, for fakes that key mappings and runs to a Provider row (#2040). */
export const TEST_PROVIDER_ROWS: Readonly<Record<ProviderCode, { id: string; name: string }>> = {
  [ProviderCode.BALLDONTLIE]: { id: BALLDONTLIE_TEST_PROVIDER_ID, name: 'BALLDONTLIE' },
};

function league(code: string, name: string, sport: Sport, webhookEventSet: ProviderWebhookEventSet, quietAfterMinutes: number, typicalGameMinutes: number): ProviderLeagueSettings {
  return { id: `00000000-0000-4000-8000-${code.padStart(12, '0').replace(/[^0-9a-f]/g, 'a')}`, providerId: PROVIDER_ID, code, name, sport, webhookEventSet, quietAfterMinutes, typicalGameMinutes, isEnabled: true };
}

/** Every BALLDONTLIE league, enabled. */
export const BALLDONTLIE_TEST_LEAGUES: readonly ProviderLeagueSettings[] = [
  league('pga', 'PGA TOUR', Sport.GOLF, ProviderWebhookEventSet.GOLF_ROUNDS, 360, 360),
  league('nfl', 'NFL', Sport.AMERICAN_FOOTBALL, ProviderWebhookEventSet.GAME_PERIODS, 90, 210),
  league('ncaaf', 'College Football', Sport.AMERICAN_FOOTBALL, ProviderWebhookEventSet.GAME_PERIODS, 110, 210),
  league('nba', 'NBA', Sport.BASKETBALL, ProviderWebhookEventSet.GAME_PERIODS, 75, 150),
  league('ncaab', 'NCAA Men\'s Basketball', Sport.BASKETBALL, ProviderWebhookEventSet.GAME_PERIODS, 90, 150),
  league('ncaaw', 'NCAA Women\'s Basketball', Sport.BASKETBALL, ProviderWebhookEventSet.GAME_PERIODS, 75, 150),
  league('wnba', 'WNBA', Sport.BASKETBALL, ProviderWebhookEventSet.GAME_PERIODS, 75, 150),
  league('nhl', 'NHL', Sport.HOCKEY, ProviderWebhookEventSet.GAME_PERIODS, 90, 150),
  league('mlb', 'MLB', Sport.BASEBALL, ProviderWebhookEventSet.GAME_PERIODS, 210, 180),
  league('epl', 'Premier League', Sport.SOCCER, ProviderWebhookEventSet.GAME_HALVES, 90, 120),
  league('worldcup', 'FIFA World Cup', Sport.SOCCER, ProviderWebhookEventSet.GAME_HALVES, 150, 120),
];

/** BALLDONTLIE's row: on, webhooks switched on, every league enabled. */
export function balldontlieTestProvider(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    id: PROVIDER_ID,
    code: ProviderCode.BALLDONTLIE,
    name: 'BALLDONTLIE',
    baseUrl: 'https://api.balldontlie.io',
    requestsPerMinute: 600,
    webhooksEnabled: true,
    webhookPollMinutes: 15,
    webhookRoundPollMinutes: 2,
    hasPlayerStats: false,
    isEnabled: true,
    priority: 1,
    leagues: [...BALLDONTLIE_TEST_LEAGUES],
    ...overrides,
  };
}

/** The connection a test adapter calls through: the real host, at a rate that never waits. */
export const testBalldontlieConnection = (requestsPerMinute = 600) => () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute });
