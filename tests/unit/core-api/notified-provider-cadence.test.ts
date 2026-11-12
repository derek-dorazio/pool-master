import { Sport } from '@poolmaster/shared/domain';
import {
  DEFAULT_NOTIFIED_ROUND_POLL_SECONDS,
  DEFAULT_NOTIFIED_POLL_SECONDS,
  readNotifiedProviderCadence,
} from '../../../packages/core-api/src/modules/ingestion/notified-provider-cadence';

describe('the live-score pace for providers that send webhook notifications (#1499)', () => {
  it('sets no cadence while no provider\'s webhook secret is set, so every event keeps the admin\'s interval', () => {
    expect(readNotifiedProviderCadence({})).toBeUndefined();
    expect(readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: '   ' })).toBeUndefined();
  });

  it('paces BALLDONTLIE once its webhook secret is set: a 15-minute safety net and golf rounds every 2 minutes', () => {
    expect(readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x' })).toEqual(expect.objectContaining({
      providerIds: ['balldontlie'],
      pollIntervalMs: DEFAULT_NOTIFIED_POLL_SECONDS * 1000,
      roundPollIntervalMs: DEFAULT_NOTIFIED_ROUND_POLL_SECONDS * 1000,
    }));
    expect([DEFAULT_NOTIFIED_POLL_SECONDS, DEFAULT_NOTIFIED_ROUND_POLL_SECONDS]).toEqual([900, 120]);
  });

  it('takes each event\'s quiet window from its league\'s gap between notifications, not one window for every sport', () => {
    const cadence = readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x' });
    const quietMinutes = (sport: Sport, externalId: string) =>
      (cadence?.quietAfterMs(sport, { providerId: 'balldontlie', externalId }) ?? 0) / 60_000;

    expect(quietMinutes(Sport.AMERICAN_FOOTBALL, 'nfl-2026-week-11')).toBe(90);
    expect(quietMinutes(Sport.BASKETBALL, 'nba-2025-postseason-round-4')).toBe(75);
    expect(quietMinutes(Sport.GOLF, '1133')).toBe(360);
  });

  it('takes each interval from its environment variable in seconds, a blank one keeping the default', () => {
    expect(readNotifiedProviderCadence({
      BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x',
      PROVIDER_WEBHOOK_POLL_SECONDS: '600',
      PROVIDER_WEBHOOK_ROUND_POLL_SECONDS: ' 90 ',
    })).toEqual(expect.objectContaining({ pollIntervalMs: 600_000, roundPollIntervalMs: 90_000 }));
    expect(readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x', PROVIDER_WEBHOOK_POLL_SECONDS: '' }))
      .toEqual(expect.objectContaining({ pollIntervalMs: DEFAULT_NOTIFIED_POLL_SECONDS * 1000 }));
  });

  it('stops startup on an interval that is not a whole number of seconds of at least one, naming the variable', () => {
    for (const bad of ['0', '-5', '1.5', 'fifteen']) {
      expect(() => readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x', PROVIDER_WEBHOOK_POLL_SECONDS: bad }))
        .toThrow(`PROVIDER_WEBHOOK_POLL_SECONDS must be a whole number of seconds, at least 1; it is "${bad}".`);
    }
  });
});
