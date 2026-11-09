import { ContestEntryStatus } from '@poolmaster/shared/domain';
import { batchedLeaderboardDeps } from '../../../packages/core-api/src/modules/contests/batched-leaderboard-reads';
import type { ContestServiceDeps } from '../../../packages/core-api/src/modules/contests/service';

// The leaderboard reads of a fan-out over many contests (#1315): reads asked for together are made
// as one read of the port, and each asker gets exactly what the port's own read would give it.

function ports() {
  const contests = [{ id: 'c1' }, { id: 'c2' }];
  const entries = [
    { id: 'e1', contestId: 'c1', events: [{ sportEventId: 'week-1', status: ContestEntryStatus.SUBMITTED }] },
    { id: 'e2', contestId: 'c1', events: [{ sportEventId: 'week-1', status: ContestEntryStatus.DRAFT }] },
    { id: 'e3', contestId: 'c2', events: [] },
  ];
  const picks = [
    { entryId: 'e1', sportEventId: 'week-1', id: 'p1' },
    { entryId: 'e3', sportEventId: 'week-2', id: 'p2' },
  ];
  const predictions = [
    { contestEntryId: 'e1', sportEventId: 'week-1', id: 'g1' },
    { contestEntryId: 'e3', sportEventId: 'week-2', id: 'g2' },
  ];
  const matches = [{ id: 'm2', sportEventId: 'week-2' }, { id: 'm1', sportEventId: 'week-1' }];
  const snapshots = [{ contestId: 'c1', shownEvent: 'week-1', version: 1 }, { contestId: 'c2', shownEvent: 'week-2', version: 4 }];
  const reads = {
    contests: { findByIds: jest.fn(async (ids: readonly string[]) => contests.filter((row) => ids.includes(row.id))) },
    configurations: { findByContests: jest.fn(async (ids: readonly string[]) => ids.filter((id) => id === 'c1').map((contestId) => ({ contestId }))) },
    scoringRules: { findByContestConfigurations: jest.fn(async () => [{ contestConfigurationId: 'cfg-1', id: 'rule-1' }]) },
    eventStandings: { findByContests: jest.fn(async () => [{ contestId: 'c2', id: 'standing-1' }]) },
    entries: { findByContestsWithSquad: jest.fn(async (ids: readonly string[]) => entries.filter((row) => ids.includes(row.contestId))) },
    picks: { findByEntriesAndEvents: jest.fn(async () => picks) },
    sportEvents: { findByIds: jest.fn(async (ids: readonly string[]) => ids.map((id) => ({ id }))) },
    matches: { findBySportEvents: jest.fn(async () => matches) },
    predictions: { findByEntriesAndEvents: jest.fn(async () => predictions) },
    participants: { findByIds: jest.fn(async (ids: readonly string[]) => ids.map((id) => ({ id }))) },
    leaderboardSnapshots: { findByContests: jest.fn(async (ids: readonly string[], shownEvent: string) => snapshots.filter((row) => ids.includes(row.contestId) && row.shownEvent === shownEvent)) },
    eventParticipants: { batchedFieldReads: () => ({ batched: true }) },
  };
  return { reads, deps: batchedLeaderboardDeps(reads as unknown as ContestServiceDeps) };
}

describe('batchedLeaderboardDeps', () => {
  it('reads the contests, rules and standings asked for together once each, and answers a contest or rules not found with null', async () => {
    const { reads, deps } = ports();

    const [one, missing, rulesOne, rulesNone, scoring, standings] = await Promise.all([
      deps.contests.findById('c1'),
      deps.contests.findById('gone'),
      deps.configurations.findByContest('c1'),
      deps.configurations.findByContest('c2'),
      deps.scoringRules.findByContestConfiguration('cfg-1'),
      deps.eventStandings.findByContest('c2'),
    ]);

    expect([one, missing, rulesOne, rulesNone]).toEqual([{ id: 'c1' }, null, { contestId: 'c1' }, null]);
    expect(scoring).toEqual([{ contestConfigurationId: 'cfg-1', id: 'rule-1' }]);
    expect(standings).toEqual([{ contestId: 'c2', id: 'standing-1' }]);
    expect(reads.contests.findByIds).toHaveBeenCalledTimes(1);
    expect(reads.configurations.findByContests).toHaveBeenCalledTimes(1);
  });

  it('gives each contest its entries, only those submitted for an event when asked, in one read', async () => {
    const { reads, deps } = ports();

    const [all, submitted, other] = await Promise.all([
      deps.entries.findByContestWithSquad('c1'),
      deps.entries.findByContestWithSquad('c1', { submittedFor: 'week-1' }),
      deps.entries.findByContestWithSquad('c2', {}),
    ]);

    expect([all.map((row) => row.id), submitted.map((row) => row.id), other.map((row) => row.id)]).toEqual([['e1', 'e2'], ['e1'], ['e3']]);
    expect(reads.entries.findByContestsWithSquad).toHaveBeenCalledTimes(1);
  });

  it('reads every asker\'s picks and game picks once, giving each only its own entries in its own events', async () => {
    const { reads, deps } = ports();

    const [picksOne, picksTwo, gameOne, gameTwo] = await Promise.all([
      deps.picks.findByEntriesAndEvents(['e1'], ['week-1']),
      deps.picks.findByEntriesAndEvents(['e3'], ['week-1']),
      deps.predictions.findByEntriesAndEvent(['e1', 'e3'], 'week-1'),
      deps.predictions.findByEntriesAndEvents(['e3'], ['week-2']),
    ]);

    expect([picksOne, picksTwo].map((rows) => rows.map((row) => row.id))).toEqual([['p1'], []]);
    expect([gameOne, gameTwo].map((rows) => rows.map((row) => row.id))).toEqual([['g1'], ['g2']]);
    expect(reads.picks.findByEntriesAndEvents).toHaveBeenCalledWith(['e1', 'e3'], ['week-1']);
    expect(reads.predictions.findByEntriesAndEvents).toHaveBeenCalledTimes(1);
  });

  it('answers events, participants and matches as their ports do, matches by event, in one read each', async () => {
    const { reads, deps } = ports();

    const [events, people, weekTwo, both] = await Promise.all([
      deps.sportEvents.findByIds(['week-1']),
      deps.participants.findByIds(['p-1']),
      deps.matches.findBySportEvent('week-2'),
      deps.matches.findBySportEvents(['week-2', 'week-1', 'week-2']),
    ]);

    expect([events, people]).toEqual([[{ id: 'week-1' }], [{ id: 'p-1' }]]);
    expect([weekTwo.map((row) => row.id), both.map((row) => row.id)]).toEqual([['m2'], ['m1', 'm2']]);
    expect(reads.matches.findBySportEvents).toHaveBeenCalledTimes(1);
    expect(deps.eventParticipants).toEqual({ batched: true });
  });

  it('reads the snapshots once per event shown, and answers a board never stored with null', async () => {
    const { reads, deps } = ports();

    const answers = await Promise.all([
      deps.leaderboardSnapshots.find('c1', 'week-1'),
      deps.leaderboardSnapshots.find('c2', 'week-2'),
      deps.leaderboardSnapshots.find('c2', 'week-1'),
    ]);

    expect(answers.map((snapshot) => snapshot?.version ?? null)).toEqual([1, 4, null]);
    expect(reads.leaderboardSnapshots.findByContests.mock.calls).toEqual([[['c1', 'c2'], 'week-1'], [['c2'], 'week-2']]);
  });
});
