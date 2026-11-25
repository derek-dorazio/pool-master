import { ProviderCode, type ProviderSettings } from '@poolmaster/shared/domain';
import type { ProviderSettingsRepository } from '@poolmaster/shared/db';
import { ProviderSettingsError, ProviderSettingsService } from '../../../packages/core-api/src/modules/ingestion/provider-settings-service';
import { ProviderSettingsStore } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { ProviderWebhookSwitch } from '../../../packages/core-api/src/modules/ingestion/provider-webhook-switch';
import { BALLDONTLIE_TEST_LEAGUES, balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeLogger } from '../../support/fake-logger';

/** The provider rows in memory, with the repository's answers. */
function rowsRepository(initial: ProviderSettings[]): ProviderSettingsRepository {
  let rows = initial;
  return {
    findAll: () => Promise.resolve(rows),
    findById: (id) => Promise.resolve(rows.find((row) => row.id === id) ?? null),
    update: (id, updates) => {
      const row = rows.find((each) => each.id === id);
      if (row === undefined) return Promise.resolve('NOT_FOUND' as const);
      const saved = { ...row, ...updates };
      rows = rows.map((each) => (each.id === id ? saved : each));
      return Promise.resolve(saved);
    },
    updateLeague: (providerId, leagueId, updates) => {
      const row = rows.find((each) => each.id === providerId);
      const league = row?.leagues.find((each) => each.id === leagueId);
      if (row === undefined || league === undefined) return Promise.resolve(null);
      const saved = { ...league, ...updates };
      rows = rows.map((each) => (each.id === providerId ? { ...each, leagues: each.leagues.map((one) => (one.id === leagueId ? saved : one)) } : each));
      return Promise.resolve(saved);
    },
  };
}

async function setup({ secret, rows = [balldontlieTestProvider({ webhooksEnabled: false })] }: { secret?: string; rows?: ProviderSettings[] } = {}) {
  const repository = rowsRepository(rows);
  const store = new ProviderSettingsStore(repository);
  await store.load();
  const logger = fakeLogger();
  const webhooks = new ProviderWebhookSwitch(store, secret === undefined ? {} : { [ProviderCode.BALLDONTLIE]: secret });
  return { service: new ProviderSettingsService({ repository, store, webhooks, logger }), store, logger };
}

const PROVIDER_ID = balldontlieTestProvider().id;

describe('ProviderSettingsService (#1997)', () => {
  it('saves a provider\'s settings and this task takes them at once, before its next read of the rows', async () => {
    const { service, store } = await setup();

    const saved = await service.updateProvider(PROVIDER_ID, { requestsPerMinute: 600, baseUrl: 'https://api.example.test' });

    expect(saved).toMatchObject({ provider: { requestsPerMinute: 600, baseUrl: 'https://api.example.test' }, webhookSecretSet: false });
    expect(store.byCode(ProviderCode.BALLDONTLIE)?.requestsPerMinute).toBe(600);
  });

  it('refuses to switch webhooks on while the signing secret is not set, logging it and saving nothing', async () => {
    const { service, store, logger } = await setup();

    await expect(service.updateProvider(PROVIDER_ID, { webhooksEnabled: true, requestsPerMinute: 9 }))
      .rejects.toMatchObject({ code: 'PROVIDER_WEBHOOK_SECRET_MISSING', statusCode: 422 });
    expect(store.byCode(ProviderCode.BALLDONTLIE)?.requestsPerMinute).toBe(600);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.providerSettings.webhookSecretMissing' }), expect.any(String));
  });

  it('switches webhooks on once the signing secret is set', async () => {
    const { service } = await setup({ secret: 'whsec' });

    expect(await service.updateProvider(PROVIDER_ID, { webhooksEnabled: true })).toMatchObject({ provider: { webhooksEnabled: true }, webhookSecretSet: true });
  });

  it('answers 404 PROVIDER_NOT_FOUND for a provider with no row, whatever is changed', async () => {
    const { service } = await setup();
    const missing = '00000000-0000-4000-8000-000000000000';

    await expect(service.updateProvider(missing, { requestsPerMinute: 9 })).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 404 });
    await expect(service.updateProvider(missing, { webhooksEnabled: true })).rejects.toBeInstanceOf(ProviderSettingsError);
  });

  it('saves one of a provider\'s leagues, and this task takes the provider with it at once', async () => {
    const { service, store } = await setup();
    const mlb = BALLDONTLIE_TEST_LEAGUES.find((league) => league.code === 'mlb');

    const saved = await service.updateLeague(PROVIDER_ID, mlb?.id ?? '', { typicalGameMinutes: 200, isEnabled: false });

    expect(saved).toMatchObject({ code: 'mlb', typicalGameMinutes: 200, isEnabled: false });
    expect(store.enabledLeagues(ProviderCode.BALLDONTLIE).map((league) => league.code)).not.toContain('mlb');
  });

  it('answers 404 PROVIDER_LEAGUE_NOT_FOUND for a league the provider does not have', async () => {
    const { service } = await setup();

    await expect(service.updateLeague(PROVIDER_ID, '00000000-0000-4000-8000-000000000000', { isEnabled: false }))
      .rejects.toMatchObject({ code: 'PROVIDER_LEAGUE_NOT_FOUND', statusCode: 404 });
  });
});
