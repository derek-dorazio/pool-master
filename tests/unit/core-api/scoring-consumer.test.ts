import { ContestStatus } from '@poolmaster/shared/domain';
import { ContestLookup, handleStatEvent } from '../../../packages/core-api/src/modules/scoring/consumer/stat-event-consumer';
import { scoreParticipant } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';

jest.mock('../../../packages/core-api/src/modules/scoring/engine/scoring-engine', () => ({
  scoreParticipant: jest.fn(),
}));

describe('ContestLookup', () => {
  it('filters scoring contests to active and locked contests only', async () => {
    const prisma = {
      contestParticipantPool: {
        findMany: jest.fn().mockResolvedValue([
          { contest: { id: 'contest-active', status: ContestStatus.ACTIVE, scoringEngine: 'STROKE_PLAY', scoringRules: { a: 1 } } },
          { contest: { id: 'contest-locked', status: ContestStatus.LOCKED, scoringEngine: 'STROKE_PLAY', scoringRules: { b: 2 } } },
          { contest: { id: 'contest-draft', status: ContestStatus.DRAFT, scoringEngine: 'STROKE_PLAY', scoringRules: { c: 3 } } },
          { contest: { id: 'contest-completed', status: ContestStatus.COMPLETED, scoringEngine: 'STROKE_PLAY', scoringRules: { d: 4 } } },
        ]),
      },
    } as any;

    const lookup = new ContestLookup(prisma);
    const contests = await lookup.findActiveContestsForParticipant('participant-1');

    expect(prisma.contestParticipantPool.findMany).toHaveBeenCalledWith({
      where: { participantId: 'participant-1', isAvailable: true },
      include: { contest: true },
    });
    expect(contests).toEqual([
      {
        contestId: 'contest-active',
        scoringEngine: 'STROKE_PLAY',
        scoringRules: { a: 1 },
      },
      {
        contestId: 'contest-locked',
        scoringEngine: 'STROKE_PLAY',
        scoringRules: { b: 2 },
      },
    ]);
  });

  it('deduplicates repeated entry rows for the same contest entry', async () => {
    const prisma = {
      rosterPick: {
        findMany: jest.fn().mockResolvedValue([
          {
            entry: { id: 'entry-1', name: 'Team One' },
            sportEventParticipant: { participantId: 'participant-1' },
          },
          {
            entry: { id: 'entry-1', name: 'Team One' },
            sportEventParticipant: { participantId: 'participant-1' },
          },
          {
            entry: { id: 'entry-2', name: 'Team Two' },
            sportEventParticipant: { participantId: 'participant-1' },
          },
        ]),
      },
    } as any;

    const lookup = new ContestLookup(prisma);
    const entries = await lookup.findEntriesWithParticipant('contest-1', 'participant-1');

    expect(entries).toEqual([
      {
        entryId: 'entry-1',
        entryName: 'Team One',
        participantIds: ['participant-1'],
      },
      {
        entryId: 'entry-2',
        entryName: 'Team Two',
        participantIds: ['participant-1'],
      },
    ]);
  });
});

describe('handleStatEvent', () => {
  it('scores every returned entry once and publishes the score update', async () => {
    (scoreParticipant as jest.Mock).mockReturnValue({
      participantId: 'participant-external-1',
      statPoints: 7,
      positionPoints: 0,
      bonusPoints: 0,
      penaltyPoints: 0,
      multipliedTotal: 7,
      dnfAdjustment: 0,
      finalScore: 7,
    });

    const deps = {
      contestLookup: {
        findActiveContestsForParticipant: jest.fn().mockResolvedValue([
          {
            contestId: 'contest-1',
            scoringEngine: 'STROKE_PLAY',
            scoringRules: {
              stat_rules: [],
              position_rules: [],
              bonus_rules: [],
              penalty_rules: [],
              multiplier_rules: [],
              dnf_handling: 'ZERO',
              counting_method: 'ALL',
              lower_is_better: true,
            },
          },
        ]),
        findEntriesWithParticipant: jest.fn().mockResolvedValue([
          {
            entryId: 'entry-1',
            entryName: 'Team One',
            participantIds: ['participant-external-1'],
          },
        ]),
      },
      scoreStore: {
        appendParticipantScore: jest.fn().mockResolvedValue(undefined),
        getEntryTotal: jest.fn().mockResolvedValue(11),
        appendEntryScore: jest.fn().mockResolvedValue(undefined),
      },
      eventBus: {
        publish: jest.fn().mockResolvedValue(undefined),
      },
    } as any;

    await handleStatEvent(
      {
        id: 'event-1',
        type: 'stat.received',
        sourceService: 'ingestion-worker',
        timestamp: '2026-04-03T10:00:00Z',
        tenantId: 'tenant-1',
        eventId: 'event-1',
        participantExternalId: 'participant-external-1',
        statKey: 'birdies',
        statValue: 1,
        isCorrection: false,
        providerId: 'provider-1',
        ingestedAt: '2026-04-03T10:00:00Z',
      },
      deps,
    );

    expect(deps.contestLookup.findActiveContestsForParticipant).toHaveBeenCalledWith('participant-external-1');
    expect(deps.contestLookup.findEntriesWithParticipant).toHaveBeenCalledWith('contest-1', 'participant-external-1');
    expect(deps.scoreStore.appendParticipantScore).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: 'contest-1',
        participantId: 'participant-external-1',
        eventTimestamp: '2026-04-03T10:00:00Z',
        points: 7,
      }),
    );
    expect(deps.scoreStore.appendEntryScore).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: 'contest-1',
        entryId: 'entry-1',
        eventTimestamp: '2026-04-03T10:00:00Z',
        pointsEarned: 7,
        runningTotal: 18,
      }),
    );
    expect(deps.eventBus.publish).toHaveBeenCalledWith(
      'score.updated',
      expect.objectContaining({
        contestId: 'contest-1',
        teamId: 'entry-1',
        newScore: 7,
        timestamp: '2026-04-03T10:00:00Z',
      }),
    );
  });
});
