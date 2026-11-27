import { ProviderCode, type ProviderSettings } from '@poolmaster/shared/domain';
import { notifiedProviderCadenceOf, providerLeagueQuietAfterMs } from '../../../packages/core-api/src/modules/ingestion/notified-provider-cadence';
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
});

describe('each provider league\'s quiet window (#1499, #2094)', () => {
  async function quietMinutesOf(provider: ProviderSettings) {
    const store = new ProviderSettingsStore({ findAll: () => Promise.resolve([provider]) });
    await store.load();
    const quietAfterMs = providerLeagueQuietAfterMs(store);
    return (code: string) => quietAfterMs(provider.leagues.find((league) => league.code === code)?.id ?? 'no-such-league') / 60_000;
  }

  it('allows each league its longest normal gap, a period or half plus its break, and a golf round six hours for its first group to finish', async () => {
    const quietMinutes = await quietMinutesOf(balldontlieTestProvider());

    expect(quietMinutes('nfl')).toBe(90);
    expect(quietMinutes('ncaaf')).toBe(110);
    expect(quietMinutes('nba')).toBe(75);
    expect(quietMinutes('ncaab')).toBe(90);
    expect(quietMinutes('ncaaw')).toBe(75);
    expect(quietMinutes('nhl')).toBe(90);
    expect(quietMinutes('mlb')).toBe(210);
    expect(quietMinutes('wnba')).toBe(75);
    expect(quietMinutes('epl')).toBe(90);
    expect(quietMinutes('worldcup')).toBe(150);
    expect(quietMinutes('pga')).toBe(360);
  });

  it('takes the window from the league\'s row, so an edit on the Providers page changes it, and gives zero, never, for a league no row has', async () => {
    const provider = balldontlieTestProvider();
    const longer = { ...provider, leagues: provider.leagues.map((league) => (league.code === 'nfl' ? { ...league, quietAfterMinutes: 120 } : league)) };
    const quietMinutes = await quietMinutesOf(longer);

    expect(quietMinutes('nfl')).toBe(120);
    expect(quietMinutes('mls')).toBe(0);
  });
});
