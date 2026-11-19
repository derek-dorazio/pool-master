import { expect } from '@jest/globals';
import { SCHEDULE_RECHECK_MS, schedulePolicyDelayMs } from '../../../packages/core-api/src/core/schedule-policy-delay';

describe('schedulePolicyDelayMs', () => {
  it('waits a policy\'s interval in seconds when it names one, ahead of minutes', () => {
    expect(schedulePolicyDelayMs({ enabled: true, intervalSeconds: 30, intervalMinutes: 5 })).toBe(30_000);
  });

  it('waits a policy\'s interval in minutes when it names no seconds', () => {
    expect(schedulePolicyDelayMs({ enabled: true, intervalMinutes: 360 })).toBe(360 * 60_000);
  });

  it('waits only the one-minute recheck for a policy that is off, whatever its interval, or that names no interval', () => {
    expect(schedulePolicyDelayMs({ enabled: false, intervalMinutes: 360 })).toBe(SCHEDULE_RECHECK_MS);
    expect(schedulePolicyDelayMs({ enabled: true })).toBe(SCHEDULE_RECHECK_MS);
    expect(SCHEDULE_RECHECK_MS).toBe(60_000);
  });
});
