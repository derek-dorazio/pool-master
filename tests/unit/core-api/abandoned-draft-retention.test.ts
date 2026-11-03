/**
 * #1195 — the nightly cleanup's abandoned-draft step: the 90-day horizon it asks the contests for,
 * every batch until one comes back short, and the one log line naming the leagues it touched.
 */
import { expect } from '@jest/globals';
import { ContestStatus } from '@poolmaster/shared/domain';
import { AbandonedDraftRetention } from '../../../packages/core-api/src/modules/contests/abandoned-draft-retention';
import { fakeLogger } from '../../support/fake-logger';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { fakeContestRepo } from '../../support/repo-fakes';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe('abandoned draft contest retention (#1195)', () => {
  it('deletes drafts whose last event started more than 90 days ago and keeps newer drafts, eventless drafts and opened contests', async () => {
    const world = new InMemoryContestWorld();
    const league = world.addLeague();
    const oldEvent = world.addSportEvent({ startDate: daysAgo(91) });
    const recentEvent = world.addSportEvent({ startDate: daysAgo(89) });
    const abandoned = world.addContest(league.id, { status: ContestStatus.DRAFT, sportEventIds: [oldEvent.id] });
    const recentDraft = world.addContest(league.id, { status: ContestStatus.DRAFT, sportEventIds: [oldEvent.id, recentEvent.id] });
    const eventless = world.addContest(league.id, { status: ContestStatus.DRAFT, sportEventIds: [] });
    const opened = world.addContest(league.id, { status: ContestStatus.COMPLETED, sportEventIds: [oldEvent.id] });
    const contests = world.contestRepo();

    const deleted = await new AbandonedDraftRetention(contests, fakeLogger()).purge(NOW);

    expect(deleted).toBe(1);
    expect((await contests.findByIds([abandoned.id, recentDraft.id, eventless.id, opened.id])).map((contest) => contest.id))
      .toEqual([recentDraft.id, eventless.id, opened.id]);
  });

  it('asks for drafts whose last event started before exactly 90 days ago, batch after batch until one comes back short', async () => {
    const batches = [
      Array.from({ length: 1000 }, (_, index) => ({ id: `draft-${index}`, leagueId: index % 2 === 0 ? 'league-a' : 'league-b' })),
      [{ id: 'draft-last', leagueId: 'league-c' }],
    ];
    const deleteAbandonedDraftsBatch = jest.fn(async () => batches.shift() ?? []);
    const logger = fakeLogger();

    const deleted = await new AbandonedDraftRetention(fakeContestRepo({ deleteAbandonedDraftsBatch }), logger).purge(NOW);

    expect(deleted).toBe(1001);
    expect(deleteAbandonedDraftsBatch.mock.calls).toEqual([[daysAgo(90), 1000], [daysAgo(90), 1000]]);
    expect(logger.info).toHaveBeenCalledWith({
      action: 'nightlyCleanup.abandonedDraftContests.deleted',
      data: { deleted: 1001, leagueIds: ['league-a', 'league-b', 'league-c'] },
    }, 'Deleted abandoned draft contests');
  });

  it('logs nothing of its own on a night with no abandoned drafts', async () => {
    const logger = fakeLogger();

    expect(await new AbandonedDraftRetention(fakeContestRepo(), logger).purge(NOW)).toBe(0);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
