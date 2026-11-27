import { ProviderCode, type ProviderSettings } from '@poolmaster/shared/domain';
import { notifiedProviderCadenceOf } from '../../../packages/core-api/src/modules/ingestion/notified-provider-cadence';
import { ProviderSettingsStore } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { ProviderWebhookSwitch } from '../../../packages/core-api/src/modules/ingestion/provider-webhook-switch';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';

async function cadenceFor(provider: ProviderSettings, secret: string | undefined) {
  const store = new ProviderSettingsStore({ findAll: () => Promise.resolve([provider]) });
  await store.load();
  const webhooks = new ProviderWebhookSwitch(store, secret === undefined ? {} : { [ProviderCode.BALLDONTLIE]: secret });
  return notifiedProviderCadenceOf(store, webhooks);
}

describe('the live-score pace for providers that send webhook notifications (#1499, #1997)', () => {
  it('sets no cadence while the provider\'s webhook secret is not set, so every event keeps the admin\'s interval', async () => {
    expect(await cadenceFor(balldontlieTestProvider(), undefined)).toBeUndefined();
  });

  it('sets no cadence while the provider\'s webhooks are switched off on its row, even with the secret set', async () => {
    expect(await cadenceFor(balldontlieTestProvider({ webhooksEnabled: false }), 'whsec_x')).toBeUndefined();
    expect(await cadenceFor(balldontlieTestProvider({ isEnabled: false }), 'whsec_x')).toBeUndefined();
  });

  it('paces BALLDONTLIE from its row once its webhooks are on: its safety-net poll and its round poll', async () => {
    expect(await cadenceFor(balldontlieTestProvider({ webhookPollMinutes: 10, webhookRoundPollMinutes: 3 }), 'whsec_x')).toEqual(expect.objectContaining({
      providerIds: ['balldontlie'],
      pollIntervalMs: 10 * 60_000,
      roundPollIntervalMs: 3 * 60_000,
    }));
  });

  it('takes each event\'s quiet window from its league row, not one window for every sport', async () => {
    const cadence = await cadenceFor(balldontlieTestProvider(), 'whsec_x');
    const quietMinutes = (providerLeagueCode: string) => (cadence?.quietAfterMs(providerLeagueCode) ?? 0) / 60_000;

    expect(quietMinutes('nfl')).toBe(90);
    expect(quietMinutes('nba')).toBe(75);
    expect(quietMinutes('pga')).toBe(360);
  });
});
