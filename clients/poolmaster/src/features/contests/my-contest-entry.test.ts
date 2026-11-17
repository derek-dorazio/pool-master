import { describe, expect, it } from 'vitest';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto } from '@/lib/api';
import { buildContest, buildContestSportEvent } from './test/contest-admin-fixtures';
import { contestCapacityCount, describeContestNextStep, isContestFull } from './my-contest-entry';

const NOW = new Date('2026-04-01T12:00:00.000Z');
const open = buildContest({
  id: 'contest-1',
  status: ContestStatus.OPEN,
  sportEvents: [buildContestSportEvent({ startDate: '2026-04-10T12:00:00.000Z' })],
});

function entry(id: string, status: ContestEntryStatus) {
  return { id, name: id, events: [{ sportEventId: 'event-1', status }] } as unknown as ContestEntryDto;
}

function nextStep(overrides: Partial<Parameters<typeof describeContestNextStep>[0]> = {}) {
  return describeContestNextStep({
    bestPlace: undefined,
    contest: open,
    entriesState: 'ready',
    hasTeam: true,
    leagueCode: 'BIGDAWGS',
    myEntries: [],
    now: NOW,
    ...overrides,
  });
}

describe('describeContestNextStep', () => {
  it('starts a new entry on an open contest the team is not in', () => {
    expect(nextStep()).toEqual({ kind: 'start' });
  });

  it('opens a submitted entry\'s pick screen as Edit picks, with Add entry while there is room', () => {
    expect(nextStep({ myEntries: [entry('entry-1', ContestEntryStatus.SUBMITTED)] })).toEqual({
      kind: 'entered',
      canAddEntry: true,
      edit: { label: 'Edit picks', to: '/league/BIGDAWGS/contests/contest-1/entries/entry-1' },
    });
  });

  it('opens a draft entry\'s pick screen to finish it', () => {
    expect(nextStep({ myEntries: [entry('entry-2', ContestEntryStatus.DRAFT)] })).toMatchObject({
      kind: 'entered',
      edit: { label: 'Finish your picks', to: '/league/BIGDAWGS/contests/contest-1/entries/entry-2' },
    });
  });

  it('sends Edit picks to the contest page when the team has more than one entry, where each has its ✎', () => {
    const step = nextStep({ myEntries: [entry('entry-1', ContestEntryStatus.SUBMITTED), entry('entry-2', ContestEntryStatus.DRAFT)] });

    expect(step).toMatchObject({ kind: 'entered', edit: { label: 'Edit picks', to: '/league/BIGDAWGS/contests/contest-1' } });
  });

  it('says Full on a full contest the team is not in, and offers no Add entry to a team that is', () => {
    const full: ContestDto = { ...open, entriesPerContest: 2, entryCount: 2 };

    expect(nextStep({ contest: full })).toEqual({ kind: 'full' });
    expect(nextStep({ contest: full, myEntries: [entry('entry-1', ContestEntryStatus.SUBMITTED)] })).toMatchObject({ kind: 'entered', canAddEntry: false });
  });

  it('gives a live contest the team\'s best place, or none when it is not in it', () => {
    const live: ContestDto = { ...open, status: ContestStatus.ACTIVE };
    const place = { entryId: 'entry-1', position: 3, displayPosition: '3' };

    expect(nextStep({ contest: live, bestPlace: place })).toEqual({ kind: 'standing', place });
    expect(nextStep({ contest: live })).toEqual({ kind: 'standing', place: null });
  });

  it('offers nothing on a set-up contest, or an open one whose entries have closed', () => {
    expect(nextStep({ contest: { ...open, status: ContestStatus.DRAFT } })).toEqual({ kind: 'none' });
    expect(nextStep({ now: new Date('2026-04-11T12:00:00.000Z') })).toEqual({ kind: 'none' });
  });

  it('only notes why while the entries are unknown or the viewer has no team, so it never starts a second entry', () => {
    expect(nextStep({ entriesState: 'loading', myEntries: undefined })).toEqual({ kind: 'note', note: 'Checking your entry...' });
    expect(nextStep({ entriesState: 'failed', myEntries: undefined })).toEqual({ kind: 'note', note: "We couldn't check your entry." });
    expect(nextStep({ hasTeam: false })).toEqual({ kind: 'note', note: 'Create your team to enter.' });
  });
});

describe('isContestFull', () => {
  it('is full once the count reaches the cap, and never without a cap', () => {
    expect(isContestFull({ entriesPerContest: 3 }, 3)).toBe(true);
    expect(isContestFull({ entriesPerContest: 3 }, 2)).toBe(false);
    expect(isContestFull({ entriesPerContest: null }, 500)).toBe(false);
  });
});

describe('contestCapacityCount', () => {
  it('counts every entry when the read carries it, else the submitted ones, else none', () => {
    expect(contestCapacityCount({ allEntryCount: 5, entryCount: 3 })).toBe(5);
    expect(contestCapacityCount({ allEntryCount: 0, entryCount: 3 })).toBe(3);
    expect(contestCapacityCount({ entryCount: 3 })).toBe(3);
    expect(contestCapacityCount({})).toBe(0);
  });
});
