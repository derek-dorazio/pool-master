import { ContestStatus } from '@poolmaster/shared/domain';
import {
  ContestLookup,
  handleStatEvent,
} from '../../../packages/core-api/src/modules/scoring/consumer/stat-event-consumer';

describe('ContestLookup', () => {
  it('finds active and locked contests through roster picks and deduplicates contest ids', async () => {
    const prisma = {
      rosterPick: {
        findMany: jest.fn().mockResolvedValue([
          { entry: { contestId: 'contest-active' } },
          { entry: { contestId: 'contest-active' } },
          { entry: { contestId: 'contest-locked' } },
        ]),
      },
    } as any;

    const lookup = new ContestLookup(prisma);
    const contests = await lookup.findActiveContestsForParticipant('participant-1');

    expect(prisma.rosterPick.findMany).toHaveBeenCalledWith({
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
});

describe('handleStatEvent', () => {
  it('recalculates all affected contests and publishes score updates for changed entries', async () => {
    const deps = {
      contestLookup: {
        findActiveContestsForParticipant: jest.fn().mockResolvedValue([
          { contestId: 'contest-1' },
        ]),
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

    expect(deps.contestLookup.findActiveContestsForParticipant).toHaveBeenCalledWith(
      'participant-external-1',
    );
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

    expect(deps.contestScoringRecalculationService.recalculateContest).not.toHaveBeenCalled();
    expect(deps.eventBus.publish).not.toHaveBeenCalled();
  });
});
