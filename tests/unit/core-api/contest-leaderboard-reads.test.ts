import {
  loadContestLeaderboardEntries,
  loadContestScoringConfiguration,
  toParticipantScores,
} from '../../../packages/core-api/src/modules/contests/contest-leaderboard-reads';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeParticipantContestScoringRuleRepo,
} from '../../support/repo-fakes';

// What the live leaderboard and settlement both read: a missing configuration, a configuration
// with its optional counts unset, an entry with no picks, and a golfer with no standing yet.

describe('contest leaderboard reads', () => {
  it('reads no scoring configuration for a contest that has none, without asking for its rules', async () => {
    const scoringRules = fakeParticipantContestScoringRuleRepo();

    await expect(loadContestScoringConfiguration({
      configurations: fakeContestConfigurationRepo({ findByContest: jest.fn().mockResolvedValue(null) }),
      scoringRules,
    }, 'contest-1')).resolves.toBeNull();
    expect(scoringRules.findByContestConfiguration).not.toHaveBeenCalled();
  });

  it('reads unset roster size, pick count, rounds and config JSON as null', async () => {
    const configuration = await loadContestScoringConfiguration({
      configurations: fakeContestConfigurationRepo({
        findByContest: jest.fn().mockResolvedValue({ id: 'config-1', contestId: 'contest-1' }),
      }),
      scoringRules: fakeParticipantContestScoringRuleRepo({
        findByContestConfiguration: jest.fn().mockResolvedValue([
          { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true },
        ]),
      }),
    }, 'contest-1');

    expect(configuration).toEqual({
      configJson: null,
      rosterSize: null,
      pickCount: null,
      rounds: null,
      participantScoringRules: [{ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true }],
    });
  });

  it('reads only active entries, gives an entry with no picks an empty list, and an unslotted pick a null slot', async () => {
    const entries = fakeContestEntryRepo({
      findByContestWithSquad: jest.fn().mockResolvedValue([
        { id: 'entry-1', entryNumber: 1, name: 'One', status: 'ACTIVE', squadId: 'squad-1', squadName: 'Squad One' },
        { id: 'entry-2', entryNumber: 2, name: 'Two', status: 'ACTIVE', squadId: 'squad-2', squadName: 'Squad Two' },
      ]),
    });
    const pickedAt = new Date('2026-05-30T12:00:00.000Z');

    const rows = await loadContestLeaderboardEntries({
      entries,
      picks: fakeContestEntryPickRepo({
        findByEntries: jest.fn().mockResolvedValue([
          { id: 'pick-1', entryId: 'entry-1', sportEventParticipantId: 'sep-1', pickedAt, slot: undefined },
        ]),
      }),
    }, 'contest-1');

    expect(entries.findByContestWithSquad).toHaveBeenCalledWith('contest-1', { activeOnly: true });
    expect(rows.map((row) => [row.id, row.squad.name, row.picks])).toEqual([
      ['entry-1', 'Squad One', [{ id: 'pick-1', sportEventParticipantId: 'sep-1', pickedAt, slot: null }]],
      ['entry-2', 'Squad Two', []],
    ]);
  });

  it('scores a golfer by their event to-par, and leaves a golfer with no standing unscored', () => {
    const asOf = new Date('2026-05-31T18:00:00.000Z');
    const scores = toParticipantScores([
      {
        entry: { id: 'sep-1' },
        participant: { name: 'Ana Park' },
        standing: { standing: { asOf }, golf: { eventScoreToPar: 0 } },
      },
      { entry: { id: 'sep-2' }, participant: { name: 'Ben Cole' }, standing: null },
    ] as unknown as Parameters<typeof toParticipantScores>[0]);

    expect(scores).toEqual([
      { sportEventParticipantId: 'sep-1', name: 'Ana Park', score: 0, asOf },
      { sportEventParticipantId: 'sep-2', name: 'Ben Cole', score: null, asOf: null },
    ]);
  });
});
