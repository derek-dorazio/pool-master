import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildContest, buildContestSportEvent } from './test/contest-admin-fixtures';
import { orderCurrentContests } from './current-contests';

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

function orderedIds(showDrafts: boolean) {
  return orderCurrentContests([liveB, openLater, draft, openNoEvent, liveA, final, openSoon], { showDrafts })
    .map((contest) => contest.id);
}

describe('orderCurrentContests', () => {
  it('lists open contests first, soonest close first with no-event ones last, then live ones by start, then set-up ones', () => {
    expect(orderedIds(true)).toEqual(['open-soon', 'open-later', 'open-no-event', 'live-a', 'live-b', 'draft']);
  });

  it('leaves set-up contests out for a viewer who does not commission the league', () => {
    expect(orderedIds(false)).toEqual(['open-soon', 'open-later', 'open-no-event', 'live-a', 'live-b']);
  });

  it('leaves a final contest out, because it is not current', () => {
    expect(orderedIds(true)).not.toContain('final');
  });
});
