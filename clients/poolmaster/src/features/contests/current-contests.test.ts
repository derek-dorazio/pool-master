import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildContest, buildContestSportEvent } from './test/contest-admin-fixtures';
import { groupCurrentContests } from './current-contests';

function startingAt(id: string, status: ContestStatus, startDate: string | null) {
  return buildContest({
    id,
    status,
    startsAt: null,
    sportEvents: startDate ? [buildContestSportEvent({ startDate })] : [],
  });
}

const liveA = startingAt('live-a', ContestStatus.ACTIVE, '2026-04-01T12:00:00.000Z');
const liveB = startingAt('live-b', ContestStatus.ACTIVE, '2026-04-02T12:00:00.000Z');
const openLater = startingAt('open-later', ContestStatus.OPEN, '2026-05-20T12:00:00.000Z');
const openSoon = startingAt('open-soon', ContestStatus.OPEN, '2026-05-01T12:00:00.000Z');
const openNoEvent = startingAt('open-no-event', ContestStatus.OPEN, null);
const draft = startingAt('draft', ContestStatus.DRAFT, '2026-06-01T12:00:00.000Z');
const final = startingAt('final', ContestStatus.COMPLETED, '2026-03-01T12:00:00.000Z');

function idsByGroup(showDrafts: boolean) {
  return groupCurrentContests([openLater, draft, openNoEvent, liveA, final, openSoon, liveB], { showDrafts })
    .map(({ contests, group }) => [group, contests.map((contest) => contest.id)]);
}

describe('groupCurrentContests', () => {
  it('lists live contests first, then open ones soonest close first with no-event ones last, then drafts', () => {
    expect(idsByGroup(true)).toEqual([
      ['live', ['live-a', 'live-b']],
      ['open', ['open-soon', 'open-later', 'open-no-event']],
      ['draft', ['draft']],
    ]);
  });

  it('leaves drafts out for a viewer who does not commission the league', () => {
    expect(idsByGroup(false).map(([group]) => group)).toEqual(['live', 'open']);
  });

  it('leaves a final contest out, because it is not current', () => {
    expect(idsByGroup(true).flatMap(([, ids]) => ids)).not.toContain('final');
  });

  it('drops a group with no contests rather than showing an empty heading', () => {
    expect(groupCurrentContests([openSoon], { showDrafts: true }).map(({ group }) => group)).toEqual(['open']);
  });
});
