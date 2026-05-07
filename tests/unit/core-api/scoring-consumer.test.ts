import { ContestStatus } from '@poolmaster/shared/domain';
import {
  ContestLookup,
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

