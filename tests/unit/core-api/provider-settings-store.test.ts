import { ProviderCode, type ProviderSettings } from '@poolmaster/shared/domain';
import { PROVIDER_SETTINGS_REFRESH_MS, ProviderSettingsStore } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { ProviderWebhookSwitch } from '../../../packages/core-api/src/modules/ingestion/provider-webhook-switch';
import { BALLDONTLIE_TEST_LEAGUES, balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeLogger } from '../../support/fake-logger';

function storeOf(rows: () => Promise<ProviderSettings[]>, logger = fakeLogger()) {
  return new ProviderSettingsStore({ findAll: rows }, logger);
}

describe('ProviderSettingsStore (#1997)', () => {
  afterEach(() => jest.useRealTimers());

  it('holds nothing before it loads, and every provider with its leagues once it has', async () => {
    const store = storeOf(() => Promise.resolve([balldontlieTestProvider()]));
    expect(store.all()).toEqual([]);

    await store.load();

    expect(store.byCode(ProviderCode.BALLDONTLIE)?.name).toBe('BALLDONTLIE');
    expect(store.enabledLeagues(ProviderCode.BALLDONTLIE)).toHaveLength(BALLDONTLIE_TEST_LEAGUES.length);
  });

  it('lists only a provider\'s enabled leagues, and none for a provider with no row', async () => {
    const leagues = BALLDONTLIE_TEST_LEAGUES.map((league) => (league.code === 'mlb' ? { ...league, isEnabled: false } : league));
    const store = storeOf(() => Promise.resolve([balldontlieTestProvider({ leagues })]));
    await store.load();

    expect(store.enabledLeagues(ProviderCode.BALLDONTLIE).map((league) => league.code)).not.toContain('mlb');
    const empty = storeOf(() => Promise.resolve([]));
    await empty.load();
    expect(empty.enabledLeagues(ProviderCode.BALLDONTLIE)).toEqual([]);
  });

  it('finds a provider league with its provider by the league\'s id, and nothing for an id no provider has', async () => {
    const store = storeOf(() => Promise.resolve([balldontlieTestProvider()]));
    await store.load();
    const nfl = BALLDONTLIE_TEST_LEAGUES.find((league) => league.code === 'nfl');

    expect(store.findLeague(nfl?.id ?? '')).toMatchObject({ provider: { code: ProviderCode.BALLDONTLIE }, league: { code: 'nfl' } });
    expect(store.findLeague('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });

  it('takes a saved provider at once, in place of the one it held', async () => {
    const store = storeOf(() => Promise.resolve([balldontlieTestProvider()]));
    await store.load();

    store.replace(balldontlieTestProvider({ requestsPerMinute: 600 }));

    expect(store.all()).toHaveLength(1);
    expect(store.byCode(ProviderCode.BALLDONTLIE)?.requestsPerMinute).toBe(600);
  });

  it('adds a saved provider it did not hold, in priority order', async () => {
    const store = storeOf(() => Promise.resolve([balldontlieTestProvider({ priority: 5 })]));
    await store.load();
    const first = { ...balldontlieTestProvider({ priority: 1 }), id: '00000000-0000-4000-8000-0000000000f1' };

    store.replace(first);

    expect(store.all().map((provider) => [provider.id, provider.priority])).toEqual([[first.id, 1], [balldontlieTestProvider().id, 5]]);
  });

  it('refreshes every minute by default, and keeps the last rows on a failed read even with no logger', async () => {
    jest.useFakeTimers();
    const reads = [
      Promise.resolve([balldontlieTestProvider({ requestsPerMinute: 60 })]),
      Promise.reject(new Error('database down')),
      Promise.resolve([balldontlieTestProvider({ requestsPerMinute: 600 })]),
    ];
    const store = new ProviderSettingsStore({ findAll: () => reads.shift() ?? Promise.resolve([]) });
    await store.load();
    store.start();

    await jest.advanceTimersByTimeAsync(PROVIDER_SETTINGS_REFRESH_MS);
    expect(store.byCode(ProviderCode.BALLDONTLIE)?.requestsPerMinute).toBe(60);
    await jest.advanceTimersByTimeAsync(PROVIDER_SETTINGS_REFRESH_MS);
    store.stop();

    expect(store.byCode(ProviderCode.BALLDONTLIE)?.requestsPerMinute).toBe(600);
  });

  it('reads the rows again on each refresh, and keeps the last rows and logs when a read fails', async () => {
    jest.useFakeTimers();
    const logger = fakeLogger();
    const reads = [
      Promise.resolve([balldontlieTestProvider({ requestsPerMinute: 60 })]),
      Promise.reject(new Error('database down')),
    ];
    const store = storeOf(() => reads.shift() ?? Promise.resolve([]), logger);
    await store.load();
    store.start(1_000);
    store.start(1_000);

    await jest.advanceTimersByTimeAsync(1_000);
    store.stop();

    expect(store.byCode(ProviderCode.BALLDONTLIE)?.requestsPerMinute).toBe(60);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.providerSettings.refreshFailed' }), expect.any(String));
  });
});

describe('ProviderWebhookSwitch (#1997)', () => {
  async function switchFor(provider: ProviderSettings, secret?: string) {
    const store = storeOf(() => Promise.resolve([provider]));
    await store.load();
    return new ProviderWebhookSwitch(store, secret === undefined ? {} : { [ProviderCode.BALLDONTLIE]: secret });
  }

  it('is on only while the row is enabled, its webhooks switched on and its secret set', async () => {
    expect((await switchFor(balldontlieTestProvider(), 'whsec')).onProviderIds()).toEqual(['balldontlie']);
    expect((await switchFor(balldontlieTestProvider(), 'whsec')).activeSecret(ProviderCode.BALLDONTLIE)).toBe('whsec');
    expect((await switchFor(balldontlieTestProvider())).onProviderIds()).toEqual([]);
    expect((await switchFor(balldontlieTestProvider({ webhooksEnabled: false }), 'whsec')).activeSecret(ProviderCode.BALLDONTLIE)).toBeUndefined();
    expect((await switchFor(balldontlieTestProvider({ isEnabled: false }), 'whsec')).onProviderIds()).toEqual([]);
  });

  it('logs an error for a provider whose webhooks are switched on without its secret, and nothing once it is set', async () => {
    const logger = fakeLogger();
    (await switchFor(balldontlieTestProvider())).warnFlagsWithoutSecret(logger);
    (await switchFor(balldontlieTestProvider(), 'whsec')).warnFlagsWithoutSecret(logger);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.providerWebhooks.secretMissing', providerCode: ProviderCode.BALLDONTLIE }), expect.any(String));
  });
});
