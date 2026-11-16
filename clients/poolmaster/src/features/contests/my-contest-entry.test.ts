import { describe, expect, it } from 'vitest';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto } from '@/lib/api';
import { describeMyEntry } from './my-contest-entry';

const contest = {
  id: 'contest-1',
  sportEvents: [{ sportEventId: 'event-1', name: 'Masters', startDate: '2099-04-10T12:00:00.000Z' }],
} as unknown as ContestDto;

function entry(id: string, status: ContestEntryStatus) {
  return { id, events: [{ sportEventId: 'event-1', status }] } as unknown as ContestEntryDto;
}

describe('describeMyEntry', () => {
  it('starts a new entry for a team with none, never linking to the contest page', () => {
    const next = describeMyEntry('BIGDAWGS', contest, [], 'ready', true);

    expect(next).toEqual({ kind: 'start', label: 'Make your picks', note: 'You have not entered yet.' });
    expect(next).not.toHaveProperty('to');
  });

  it('opens a submitted entry\'s pick screen as Edit picks', () => {
    expect(describeMyEntry('BIGDAWGS', contest, [entry('entry-1', ContestEntryStatus.SUBMITTED)], 'ready', true)).toEqual({
      kind: 'link',
      label: 'Edit picks',
      note: 'Your entry is submitted.',
      to: '/league/BIGDAWGS/contests/contest-1/entries/entry-1',
    });
  });

  it('opens a draft entry\'s pick screen to finish it', () => {
    expect(describeMyEntry('BIGDAWGS', contest, [entry('entry-2', ContestEntryStatus.DRAFT)], 'ready', true)).toMatchObject({
      kind: 'link',
      label: 'Finish your picks',
      to: '/league/BIGDAWGS/contests/contest-1/entries/entry-2',
    });
  });

  it('only views the contest while the entries are unknown or the viewer has no team, so it never starts a second entry', () => {
    expect(describeMyEntry('BIGDAWGS', contest, undefined, 'loading', true)).toMatchObject({ kind: 'link', label: 'View contest', to: '/league/BIGDAWGS/contests/contest-1' });
    expect(describeMyEntry('BIGDAWGS', contest, undefined, 'failed', true)).toMatchObject({ kind: 'link', note: "We couldn't check your entry." });
    expect(describeMyEntry('BIGDAWGS', contest, [], 'ready', false)).toMatchObject({ kind: 'link', note: 'Create your team to enter.' });
  });
});
