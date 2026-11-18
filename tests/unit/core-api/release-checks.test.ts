import { expect } from '@jest/globals';
import { autoReleaseHorizon, isWithinAutoReleaseWindow, ReleaseCheckKey, type ReleaseCheck } from '@poolmaster/shared/domain';
import { describeFailedReleaseCheck, evaluateReleaseChecks } from '../../../packages/core-api/src/modules/events/release-checks';

const GOLFER = { one: 'golfer', many: 'golfers' };
const NOW = new Date('2026-01-15T12:00:00.000Z');
const READY = {
  startDate: new Date('2026-01-18T12:00:00.000Z'),
  now: NOW,
  scheduledRoundCount: 4,
  loadedParticipantCount: 120,
  fieldLinks: null,
  untieredParticipantCount: 0,
  emptyTierLabels: [],
  isPriced: true,
  unpricedParticipantCount: 0,
  bracketBlockers: null,
  contestSetupCount: 2,
};

describe('evaluateReleaseChecks (#1823)', () => {
  it('passes every check of a ready event, leaving out the link and bracket checks it has none of', () => {
    const checks = evaluateReleaseChecks(READY);

    expect(checks.every((check) => check.passed)).toBe(true);
    expect(checks.map((check) => check.key)).toEqual(['NOT_STARTED', 'ROUNDS_SCHEDULED', 'FIELD_LOADED', 'TIERS_ASSIGNED', 'TIERS_FILLED', 'PRICES_ASSIGNED', 'CONTEST_SETUPS_ON']);
  });

  it('fails each check on its own value: a passed start, an unpriced field, an unlinked golfer and an incomplete bracket', () => {
    const checks = evaluateReleaseChecks({ ...READY, startDate: NOW, isPriced: false, fieldLinks: { unlinkedParticipants: 2, needsLinking: 0 }, bracketBlockers: ['its bracket is not loaded'] });

    expect(checks.filter((check) => !check.passed)).toEqual([
      { key: 'NOT_STARTED', passed: false, value: NOW },
      { key: 'FIELD_LINKED', passed: false, value: { unlinkedParticipants: 2, needsLinking: 0 } },
      { key: 'PRICES_ASSIGNED', passed: false, value: null },
      { key: 'BRACKET_COMPLETE', passed: false, value: ['its bracket is not loaded'] },
    ]);
  });
});

describe('describeFailedReleaseCheck (#1823)', () => {
  const words = (check: ReleaseCheck) => describeFailedReleaseCheck(check, GOLFER);

  it('words every failed check the way a release refusal and the draft email say it', () => {
    expect(words({ key: ReleaseCheckKey.NOT_STARTED, passed: false, value: NOW })).toEqual(['its start time has passed']);
    expect(words({ key: ReleaseCheckKey.ROUNDS_SCHEDULED, passed: false, value: 0 })).toEqual(['its rounds are not scheduled']);
    expect(words({ key: ReleaseCheckKey.FIELD_LOADED, passed: false, value: 0 })).toEqual(['its field is not loaded']);
    expect(words({ key: ReleaseCheckKey.FIELD_LINKED, passed: false, value: { unlinkedParticipants: 1, needsLinking: 0 } })).toEqual(['1 active golfer not linked to the event\'s provider']);
    expect(words({ key: ReleaseCheckKey.FIELD_LINKED, passed: false, value: { unlinkedParticipants: 2, needsLinking: 1 } }))
      .toEqual(['2 active golfers not linked to the event\'s provider', '1 name from the provider\'s field waiting in Needs linking']);
    expect(words({ key: ReleaseCheckKey.FIELD_LINKED, passed: false, value: { unlinkedParticipants: 0, needsLinking: 3 } }))
      .toEqual(['3 names from the provider\'s field waiting in Needs linking']);
    expect(words({ key: ReleaseCheckKey.TIERS_ASSIGNED, passed: false, value: 3 })).toEqual(['3 active participant(s) have no tier']);
    expect(words({ key: ReleaseCheckKey.TIERS_FILLED, passed: false, value: ['Tier 5', 'Tier 6'] })).toEqual(['Tier 5 has no golfers', 'Tier 6 has no golfers']);
    expect(words({ key: ReleaseCheckKey.PRICES_ASSIGNED, passed: false, value: null })).toEqual(['its prices have not been assigned']);
    expect(words({ key: ReleaseCheckKey.PRICES_ASSIGNED, passed: false, value: 4 })).toEqual(['4 active participant(s) have no price']);
    expect(words({ key: ReleaseCheckKey.BRACKET_COMPLETE, passed: false, value: ['its bracket is not loaded'] })).toEqual(['its bracket is not loaded']);
    expect(words({ key: ReleaseCheckKey.CONTEST_SETUPS_ON, passed: false, value: 0 })).toEqual(['its sport league has no active contest setup']);
  });
});

describe('the automatic release window (#1823)', () => {
  it('holds an event still ahead and no more days away than the window, and not one started or further off', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(isWithinAutoReleaseWindow(new Date(NOW.getTime() + 7 * day), 7, NOW)).toBe(true);
    expect(isWithinAutoReleaseWindow(new Date(NOW.getTime() + 7 * day + 1), 7, NOW)).toBe(false);
    expect(isWithinAutoReleaseWindow(NOW, 7, NOW)).toBe(false);
    expect(autoReleaseHorizon(NOW)).toEqual(new Date(NOW.getTime() + 30 * day));
  });
});
