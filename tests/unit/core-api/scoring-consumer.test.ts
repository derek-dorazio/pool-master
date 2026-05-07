import { ContestStatus } from '@poolmaster/shared/domain';
import {
  ContestLookup,
  handleStatEvent,
} from '../../../packages/core-api/src/modules/scoring/consumer/stat-event-consumer';

describe('ContestLookup', () => {
  it('finds active and locked contests through roster picks and deduplicates contest ids', async () => {
    const prisma = {
      contestEntryPick: {
        findMany: jest.fn().mockResolvedValue([
          { entry: { contestId: 'contest-active' } },
          { entry: { contestId: 'contest-active' } },
          { entry: { contestId: 'contest-locked' } },
        ]),
      },
    } as any;

    const lookup = new ContestLookup(prisma);
    const contests = await lookup.findActiveContestsForParticipant('participant-1');

    expect(prisma.contestEntryPick.findMany).toHaveBeenCalledWith({
      where: {
        sportEventParticipant: {
          participantId: 'participant-1',
        },
        entry: {
          contest: {
            status: {
              in: [ContestStatus.ACTIVE, ContestStatus.LOCKED],
            },
          },
        },
      },
      select: {
        entry: {
          select: {
            contestId: true,
          },
        },
      },
    });
    expect(contests).toEqual([
      { contestId: 'contest-active' },
      { contestId: 'contest-locked' },
    ]);
  });

  it('pool-master-dxd.27 finds active contests through provider participant mappings for external ids', async () => {
    const prisma = {
      contestEntryPick: {
        findMany: jest.fn().mockResolvedValue([
          { entry: { contestId: 'contest-live' } },
        ]),
      },
    } as any;

    const lookup = new ContestLookup(prisma);
    const contests = await lookup.findActiveContestsForProviderParticipant(
      'mock-contest-feed',
      'golfer-01',
    );

    expect(prisma.contestEntryPick.findMany).toHaveBeenCalledWith({
      where: {
        sportEventParticipant: {
          participant: {
            providerMappings: {
              some: {
                providerId: 'mock-contest-feed',
                externalId: 'golfer-01',
              },
            },
          },
        },
        entry: {
          contest: {
            status: {
              in: [ContestStatus.ACTIVE, ContestStatus.LOCKED],
            },
          },
        },
      },
      select: {
        entry: {
          select: {
            contestId: true,
          },
        },
      },
    });
    expect(contests).toEqual([{ contestId: 'contest-live' }]);
  });
});

describe('handleStatEvent', () => {
  it('recalculates all affected contests and publishes score updates for changed entries', async () => {
    const deps = {
      contestLookup: {
        findActiveContestsForParticipant: jest.fn().mockResolvedValue([
          { contestId: 'contest-1' },
        ]),
        findActiveContestsForProviderParticipant: jest.fn().mockResolvedValue([]),
      },
      contestScoringRecalculationService: {
        recalculateContest: jest.fn().mockResolvedValue({
          contestId: 'contest-1',
          teamsAffected: 1,
          standingsChanged: true,
          changes: [
            {
              entryId: 'entry-1',
              oldRank: 2,
              newRank: 1,
              oldScore: 8,
              newScore: 12,
            },
          ],
        }),
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
        eventId: 'event-1',
        participantId: 'participant-1',
        participantExternalId: 'participant-external-1',
        statKey: 'birdies',
        statValue: 1,
        isCorrection: false,
        providerId: 'provider-1',
        ingestedAt: '2026-04-03T10:00:00Z',
      },
      deps,
    );

    expect(deps.contestLookup.findActiveContestsForParticipant).toHaveBeenCalledWith(
      'participant-1',
    );
    expect(deps.contestLookup.findActiveContestsForProviderParticipant).not.toHaveBeenCalled();
    expect(
      deps.contestScoringRecalculationService.recalculateContest,
    ).toHaveBeenCalledWith('contest-1');
    expect(deps.eventBus.publish).toHaveBeenCalledWith(
      'score.updated',
      expect.objectContaining({
        contestId: 'contest-1',
        teamId: 'entry-1',
        oldScore: 8,
        newScore: 12,
        rank: 1,
        rankChanged: true,
        timestamp: '2026-04-03T10:00:00Z',
      }),
    );
  });

  it('does nothing when no contests include the participant', async () => {
    const deps = {
      contestLookup: {
        findActiveContestsForParticipant: jest.fn().mockResolvedValue([]),
        findActiveContestsForProviderParticipant: jest.fn().mockResolvedValue([]),
      },
      contestScoringRecalculationService: {
        recalculateContest: jest.fn(),
      },
      eventBus: {
        publish: jest.fn(),
      },
    } as any;

    await handleStatEvent(
      {
        id: 'event-1',
        type: 'stat.received',
        sourceService: 'ingestion-worker',
        timestamp: '2026-04-03T10:00:00Z',
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

    expect(deps.contestScoringRecalculationService.recalculateContest).not.toHaveBeenCalled();
    expect(deps.eventBus.publish).not.toHaveBeenCalled();
  });

  it('pool-master-dxd.27 uses provider mapping lookup for stat events that only carry provider external ids', async () => {
    const deps = {
      contestLookup: {
        findActiveContestsForParticipant: jest.fn().mockResolvedValue([]),
        findActiveContestsForProviderParticipant: jest.fn().mockResolvedValue([]),
      },
      contestScoringRecalculationService: {
        recalculateContest: jest.fn(),
      },
      eventBus: {
        publish: jest.fn(),
      },
    } as any;

    await handleStatEvent(
      {
        id: 'event-1',
        type: 'stat.received',
        sourceService: 'ingestion-worker',
        timestamp: '2026-04-03T10:00:00Z',
        eventId: 'event-1',
        participantExternalId: 'golfer-01',
        statKey: 'TOTAL_SCORE',
        statValue: -3,
        isCorrection: false,
        providerId: 'mock-contest-feed',
        ingestedAt: '2026-04-03T10:00:00Z',
      },
      deps,
    );

    expect(deps.contestLookup.findActiveContestsForParticipant).not.toHaveBeenCalled();
    expect(deps.contestLookup.findActiveContestsForProviderParticipant).toHaveBeenCalledWith(
      'mock-contest-feed',
      'golfer-01',
    );
  });
});
