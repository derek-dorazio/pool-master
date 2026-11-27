import { expect } from '@jest/globals';
import { SyncSeasonState } from '@poolmaster/shared/domain';
import { SCHEDULE_RECHECK_MS, schedulePolicyDelayMs } from '../../../packages/core-api/src/core/schedule-policy-delay';

const { IN_SEASON, OFFSEASON } = SyncSeasonState;

describe('schedulePolicyDelayMs', () => {
  it('waits the interval of the Season state asked for: in season and off season each have their own', () => {
    const policy = { enabled: true, intervals: { [IN_SEASON]: { intervalMinutes: 360 }, [OFFSEASON]: { intervalMinutes: 1440 } } };

    expect(schedulePolicyDelayMs(policy, IN_SEASON)).toBe(360 * 60_000);
    expect(schedulePolicyDelayMs(policy, OFFSEASON)).toBe(1440 * 60_000);
  });

  it('waits a state\'s interval in seconds when it names one, ahead of minutes, and a policy with no switch always runs on it', () => {
    expect(schedulePolicyDelayMs({ intervals: { [IN_SEASON]: { intervalSeconds: 30, intervalMinutes: 5 }, [OFFSEASON]: {} } }, IN_SEASON)).toBe(30_000);
  });

  it('waits only the one-minute recheck for a policy that is off, whatever its interval, or a state that names no interval', () => {
    const intervals = { [IN_SEASON]: { intervalMinutes: 360 }, [OFFSEASON]: {} };

    expect(schedulePolicyDelayMs({ enabled: false, intervals }, IN_SEASON)).toBe(SCHEDULE_RECHECK_MS);
    expect(schedulePolicyDelayMs({ enabled: true, intervals }, OFFSEASON)).toBe(SCHEDULE_RECHECK_MS);
    expect(SCHEDULE_RECHECK_MS).toBe(60_000);
  });
});
