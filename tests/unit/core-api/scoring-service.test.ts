import { ScoringService } from '../../../packages/core-api/src/modules/scoring/service';

describe('ScoringService', () => {
  it('enriches entry score timelines with participant names and pickem matchup context from persisted records', async () => {
    const scoreStore = {
      getEntryTimeline: jest.fn().mockResolvedValue([
        {
          contestId: 'contest-1',
          entryId: 'entry-1',
          eventTimestamp: '2026-04-03T10:00:00Z',
          pointsEarned: 12,
          runningTotal: 12,
          participantBreakdowns: [
            {
              participantId: 'participant-1',
              statPoints: 10,
              positionPoints: 0,
              bonusPoints: 0,
              penaltyPoints: 0,
              multipliedTotal: 10,
              dnfAdjustment: 0,
              finalScore: 10,
            },
          ],
        },
      ]),
      getEntryTotal: jest.fn().mockResolvedValue(12),
    };
    const standingsRollup = {
      rollupContest: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      getActiveContestIds: jest.fn().mockReturnValue(new Set()),
    };
    const prisma = {
      contest: {
        findUnique: jest.fn().mockResolvedValue({
          selectionType: 'PICK_EM',
        }),
      },
      participant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'participant-1', name: 'Scottie Scheffler' },
        ]),
      },
      contestPick: {
        findMany: jest.fn().mockResolvedValue([
          {
            participantId: 'participant-1',
            period: 5,
            matchupIndex: 3,
            periodLabel: 'Week 5',
            eventId: 'event-1',
          },
        ]),
      },
      contestMatchup: {
        findMany: jest.fn().mockResolvedValue([
          {
            eventId: 'event-1',
            period: 5,
            matchupIndex: 3,
            label: 'Week 5 Game 3',
          },
        ]),
      },
      bracketPrediction: {
        findUnique: jest.fn(),
      },
    } as any;

    const service = new ScoringService({
      scoreStore: scoreStore as any,
      standingsRollup: standingsRollup as any,
      prisma,
    });

    const result = await service.getEntryScore('contest-1', 'entry-1');

    expect(result.timeline[0].participantBreakdowns[0]).toMatchObject({
      participantId: 'participant-1',
      participantName: 'Scottie Scheffler',
      contextLabel: 'Week 5 Game 3',
      finalScore: 10,
    });
    expect(prisma.participant.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['participant-1'] } },
      select: { id: true, name: true },
    });
    expect(prisma.contestPick.findMany).toHaveBeenCalledWith({
      where: { contestId: 'contest-1', entryId: 'entry-1' },
      select: {
        participantId: true,
        period: true,
        matchupIndex: true,
        periodLabel: true,
        eventId: true,
      },
    });
  });
});
