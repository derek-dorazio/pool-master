import type { ContestRepository, ContestStatusTransition } from '@poolmaster/shared/db';
import { BackgroundJobType, ContestStatus } from '@poolmaster/shared/domain';
import { ContestLifecycle } from '../../../packages/core-api/src/modules/contests/contest-lifecycle';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { testDomainEvents } from '../../support/domain-events';
import { fakeContestRepo } from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';

const STARTS_AT = new Date('2026-05-02T20:00:00.000Z');

/**
 * Contests held by status, moved by a guarded write as the adapter makes it: only those still in
 * a `from` status move, and the write keeps the jobs it was handed for the ones that did.
 */
function guardedContests(statuses: Record<string, ContestStatus>, options: { fails?: boolean } = {}) {
  const written: Array<{ ids: readonly string[]; transition: ContestStatusTransition; jobTypes: string[] }> = [];
  const move = (ids: readonly string[], transition: ContestStatusTransition): string[] => {
    if (options.fails) throw new Error('database unavailable');
    const moved = ids.filter((id) => id in statuses && transition.from.includes(statuses[id]));
    for (const id of moved) statuses[id] = transition.to;
    written.push({ ids, transition, jobTypes: moved.length > 0 && transition.jobs ? transition.jobs(moved).map((job) => job.type) : [] });
    return moved;
  };
  const contests: ContestRepository = fakeContestRepo({
    transitionStatus: mockFn<ContestRepository['transitionStatus']>(async (id, transition) => move([id], transition).length > 0),
    transitionStatuses: mockFn<ContestRepository['transitionStatuses']>(async (ids, transition) => move(ids, transition)),
  });
  return { contests, written, statuses };
}

function lifecycle(contests: ContestRepository) {
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });
  jest.spyOn(queue, 'queued');
  return { queue, contestLifecycle: new ContestLifecycle(contests, testDomainEvents({ queue })) };
}

describe('ContestLifecycle.transition, one contest', () => {
  it('writes the settled contest\'s final results job with its move, and wakes the runner once the move landed', async () => {
    const { contests, written } = guardedContests({ 'contest-1': ContestStatus.ACTIVE });
    const { queue, contestLifecycle } = lifecycle(contests);
    const endsAt = new Date('2026-05-04T23:00:00.000Z');

    await expect(contestLifecycle.transition('contest-1', { from: [ContestStatus.OPEN, ContestStatus.ACTIVE], to: ContestStatus.COMPLETED, endsAt })).resolves.toBe(true);

    expect(written).toHaveLength(1);
    expect(written[0]?.ids).toEqual(['contest-1']);
    expect(written[0]?.transition).toMatchObject({ from: [ContestStatus.OPEN, ContestStatus.ACTIVE], to: ContestStatus.COMPLETED, endsAt });
    expect(written[0]?.jobTypes).toEqual([BackgroundJobType.CONTEST_SETTLED_EMAILS]);
    expect(queue.queued).toHaveBeenCalledTimes(1);
  });

  it('opens a draft with its reminder time and no job at all, so the write needs no transaction and wakes nothing', async () => {
    const { contests, written } = guardedContests({ 'contest-1': ContestStatus.DRAFT });
    const { queue, contestLifecycle } = lifecycle(contests);
    const openedAt = new Date('2026-04-01T12:00:00.000Z');

    await expect(contestLifecycle.transition('contest-1', { from: [ContestStatus.DRAFT], to: ContestStatus.OPEN, openedAt, nextReminderAt: openedAt })).resolves.toBe(true);

    expect(written).toHaveLength(1);
    expect(written[0]?.transition).toEqual({ from: [ContestStatus.DRAFT], to: ContestStatus.OPEN, openedAt, nextReminderAt: openedAt });
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('answers false and wakes nothing when another caller moved the contest first, so the race\'s loser queues no email', async () => {
    const { contests, written } = guardedContests({ 'contest-1': ContestStatus.COMPLETED });
    const { queue, contestLifecycle } = lifecycle(contests);

    await expect(contestLifecycle.transition('contest-1', { from: [ContestStatus.ACTIVE], to: ContestStatus.COMPLETED })).resolves.toBe(false);

    expect(written[0]?.jobTypes).toEqual([]);
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('fails with the write and wakes nothing when the move does not land', async () => {
    const { contests } = guardedContests({ 'contest-1': ContestStatus.ACTIVE }, { fails: true });
    const { queue, contestLifecycle } = lifecycle(contests);

    await expect(contestLifecycle.transition('contest-1', { from: [ContestStatus.ACTIVE], to: ContestStatus.COMPLETED })).rejects.toThrow('database unavailable');
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('keeps the causing event off the write: the sport event is the event\'s, not a contest column', async () => {
    const { contests, written } = guardedContests({ 'contest-1': ContestStatus.ACTIVE });
    const { contestLifecycle } = lifecycle(contests);

    await contestLifecycle.transition('contest-1', { from: [ContestStatus.ACTIVE], to: ContestStatus.OPEN, startsAt: STARTS_AT, sportEventId: 'sport-event-1' });

    expect(written[0]?.transition).not.toHaveProperty('sportEventId');
    expect(written[0]?.jobTypes).toEqual([BackgroundJobType.CONTEST_REOPENED_EMAILS]);
  });
});

describe('ContestLifecycle.transitionAll, a guarded batch', () => {
  it('moves the contests still in a from status in one write, and writes "Contest is live" for only those', async () => {
    const { contests, written } = guardedContests({ a: ContestStatus.OPEN, b: ContestStatus.ACTIVE, c: ContestStatus.OPEN });
    const { queue, contestLifecycle } = lifecycle(contests);

    const moved = await contestLifecycle.transitionAll(['a', 'b', 'c'], { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE, startsAt: STARTS_AT, sportEventId: 'sport-event-1' });

    expect(moved).toEqual(['a', 'c']);
    expect(written).toHaveLength(1);
    expect(written[0]?.jobTypes).toEqual([BackgroundJobType.CONTEST_STARTED_EMAILS, BackgroundJobType.CONTEST_STARTED_EMAILS]);
    expect(queue.queued).toHaveBeenCalledTimes(1);
  });

  it('hands a batch no handler takes no jobs at all, so its write needs no transaction', async () => {
    const { contests, written } = guardedContests({ a: ContestStatus.DRAFT, b: ContestStatus.DRAFT });
    const { queue, contestLifecycle } = lifecycle(contests);

    await expect(contestLifecycle.transitionAll(['a', 'b'], { from: [ContestStatus.DRAFT], to: ContestStatus.OPEN })).resolves.toEqual(['a', 'b']);

    expect(written[0]?.transition).not.toHaveProperty('jobs');
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('wakes nothing when another caller already moved every contest', async () => {
    const { contests } = guardedContests({ a: ContestStatus.ACTIVE });
    const { queue, contestLifecycle } = lifecycle(contests);

    await expect(contestLifecycle.transitionAll(['a'], { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE, sportEventId: 'sport-event-1' })).resolves.toEqual([]);
    expect(queue.queued).not.toHaveBeenCalled();
  });

  it('writes nothing for no contests', async () => {
    const { contests, written } = guardedContests({});
    const { contestLifecycle } = lifecycle(contests);

    await expect(contestLifecycle.transitionAll([], { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE })).resolves.toEqual([]);
    expect(written).toEqual([]);
  });

  it('fails with the write and wakes nothing when the batch does not land', async () => {
    const { contests } = guardedContests({ a: ContestStatus.OPEN }, { fails: true });
    const { queue, contestLifecycle } = lifecycle(contests);

    await expect(contestLifecycle.transitionAll(['a'], { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE, sportEventId: 'sport-event-1' })).rejects.toThrow('database unavailable');
    expect(queue.queued).not.toHaveBeenCalled();
  });
});
