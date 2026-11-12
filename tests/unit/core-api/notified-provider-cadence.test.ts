import {
  DEFAULT_NOTIFIED_ROUND_POLL_SECONDS,
  DEFAULT_NOTIFIED_POLL_SECONDS,
  DEFAULT_NOTIFIED_QUIET_AFTER_SECONDS,
  readNotifiedProviderCadence,
} from '../../../packages/core-api/src/modules/ingestion/notified-provider-cadence';

describe('the live-score pace for providers that send webhook notifications (#1499)', () => {
  it('sets no cadence while no provider\'s webhook secret is set, so every event keeps the admin\'s interval', () => {
    expect(readNotifiedProviderCadence({})).toBeUndefined();
    expect(readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: '   ' })).toBeUndefined();
  });

  it('paces BALLDONTLIE once its webhook secret is set: a 15-minute safety net, golf rounds every 2 minutes, quiet after 20', () => {
    expect(readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x' })).toEqual({
      providerIds: ['balldontlie'],
      pollIntervalMs: DEFAULT_NOTIFIED_POLL_SECONDS * 1000,
      roundPollIntervalMs: DEFAULT_NOTIFIED_ROUND_POLL_SECONDS * 1000,
      quietAfterMs: DEFAULT_NOTIFIED_QUIET_AFTER_SECONDS * 1000,
    });
    expect([DEFAULT_NOTIFIED_POLL_SECONDS, DEFAULT_NOTIFIED_ROUND_POLL_SECONDS, DEFAULT_NOTIFIED_QUIET_AFTER_SECONDS]).toEqual([900, 120, 1200]);
  });

  it('takes each interval from its environment variable in seconds, a blank one keeping the default', () => {
    expect(readNotifiedProviderCadence({
      BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x',
      PROVIDER_WEBHOOK_POLL_SECONDS: '600',
      PROVIDER_WEBHOOK_ROUND_POLL_SECONDS: ' 90 ',
      PROVIDER_WEBHOOK_QUIET_AFTER_SECONDS: '',
    })).toEqual(expect.objectContaining({
      pollIntervalMs: 600_000,
      roundPollIntervalMs: 90_000,
      quietAfterMs: DEFAULT_NOTIFIED_QUIET_AFTER_SECONDS * 1000,
    }));
  });

  it('stops startup on an interval that is not a whole number of seconds of at least one, naming the variable', () => {
    for (const bad of ['0', '-5', '1.5', 'fifteen']) {
      expect(() => readNotifiedProviderCadence({ BALLDONTLIE_WEBHOOK_SECRET: 'whsec_x', PROVIDER_WEBHOOK_POLL_SECONDS: bad }))
        .toThrow(`PROVIDER_WEBHOOK_POLL_SECONDS must be a whole number of seconds, at least 1; it is "${bad}".`);
    }
  });
});
