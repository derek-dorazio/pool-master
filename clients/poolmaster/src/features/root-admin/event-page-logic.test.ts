import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_PREFERENCES } from '@/features/shared/ui';
import { EVENT_PAGE_TABS } from './event-page-context';
import { releaseCheckValueText, releaseTriesText } from './event-release-checks-text';
import { settingsRequestBody } from './event-settings-form';

// The Event page's pure parts (#1890): which tabs it shows, how a ready check's value and the
// release's timing read, and what the ⚙ dialog's Save sends.

const preferences = { ...DEFAULT_DISPLAY_PREFERENCES, timeZone: 'UTC' };

describe('EVENT_PAGE_TABS', () => {
  it('lists Field, Rounds and matches, Contests and Activity, with no Tools tab on any event', () => {
    expect(EVENT_PAGE_TABS.map((tab) => tab.segment)).toEqual(['field', 'rounds', 'contests', 'activity']);
  });
});

describe('releaseCheckValueText', () => {
  it('reads each check\'s value as data, singular and plural', () => {
    expect(releaseCheckValueText({ key: 'NOT_STARTED', passed: true, value: '2026-05-07T12:00:00.000Z' }, preferences)).toMatch(/^Starts /);
    expect(releaseCheckValueText({ key: 'ROUNDS_SCHEDULED', passed: true, value: 1 }, preferences)).toBe('1 round');
    expect(releaseCheckValueText({ key: 'FIELD_LOADED', passed: true, value: 80 }, preferences)).toBe('80 participants active');
    expect(releaseCheckValueText({ key: 'TIERS_ASSIGNED', passed: false, value: 1 }, preferences)).toBe('1 participant without a tier');
    expect(releaseCheckValueText({ key: 'TIERS_FILLED', passed: true, value: [] }, preferences)).toBe('None empty');
    expect(releaseCheckValueText({ key: 'TIERS_FILLED', passed: false, value: ['Tier 5', 'Tier 6'] }, preferences)).toBe('Empty: Tier 5, Tier 6');
    expect(releaseCheckValueText({ key: 'PRICES_ASSIGNED', passed: false, value: null }, preferences)).toBe('Not priced');
    expect(releaseCheckValueText({ key: 'PRICES_ASSIGNED', passed: false, value: 2 }, preferences)).toBe('2 participants without a price');
    expect(releaseCheckValueText({ key: 'BRACKET_COMPLETE', passed: true, value: [] }, preferences)).toBe('Complete');
    expect(releaseCheckValueText({ key: 'BRACKET_COMPLETE', passed: false, value: ['seed the East'] }, preferences)).toBe('seed the East');
    expect(releaseCheckValueText({ key: 'CONTEST_SETUPS_ON', passed: true, value: 2 }, preferences)).toBe('2 contest templates on');
  });
});

describe('releaseTriesText', () => {
  it('says when automatic release tries, when the event was released, or a dash', () => {
    expect(releaseTriesText(undefined, preferences)).toBe('—');
    expect(releaseTriesText({ releaseAt: null, releaseAtKind: null }, preferences)).toBe('—');
    expect(releaseTriesText({ releaseAt: '2026-05-01T12:00:00.000Z', releaseAtKind: 'PLANNED' }, preferences)).toMatch(/^Hourly from /);
    expect(releaseTriesText({ releaseAt: '2026-05-01T12:00:00.000Z', releaseAtKind: 'ACTUAL' }, preferences)).toMatch(/^Released /);
  });
});

describe('settingsRequestBody', () => {
  const current = {
    name: 'The Open', venue: 'Royal Liverpool', location: 'Hoylake', startDate: '2026-07-16T08:00', endDate: '2026-07-19T20:00', rounds: '4', roundsPar: '',
  };
  const options = { providerSynced: false, sendsRoundsPar: true, timeZone: 'UTC' };

  it('sends nothing when nothing changed', () => {
    expect(settingsRequestBody(current, current, options)).toEqual({});
  });

  it('sends each changed value, a cleared one as null and dates as instants', () => {
    expect(settingsRequestBody(
      { ...current, name: 'The 154th Open', venue: '', location: '', startDate: '2026-07-17T08:00', endDate: '', rounds: '3', roundsPar: '71' },
      current,
      options,
    )).toEqual({
      name: 'The 154th Open', venue: null, location: null, startDate: '2026-07-17T08:00:00.000Z', endDate: null, rounds: 3, roundsPar: 71,
    });
  });

  it('never sends a synced event\'s name, venue or dates, nor par for a family that does not read it', () => {
    expect(settingsRequestBody(
      { ...current, name: 'Other', venue: 'Other', startDate: '2026-07-17T08:00', endDate: '', roundsPar: '71', location: 'Wirral' },
      current,
      { providerSynced: true, sendsRoundsPar: false, timeZone: 'UTC' },
    )).toEqual({ location: 'Wirral' });
  });
});
