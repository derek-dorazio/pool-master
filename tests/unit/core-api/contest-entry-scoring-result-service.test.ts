import { ContestEntryScoringResultService } from '../../../packages/core-api/src/modules/contest-scoring';

describe('ContestEntryScoringResultService', () => {
  it('replaces participant scores, score events, awards, and contest entry totals in one transaction', async () => {
    const tx = {
      contestEntryParticipantScore: {
        findMany: jest.fn().mockResolvedValue([{ id: 'score-old' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: 'score-new',
        }),
      },
      contestEntryParticipantScoreEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contestEntryPrizeAward: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contestEntry: {
        update: jest.fn().mockResolvedValue({ id: 'entry-1' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) =>
        callback(tx),
      ),
    } as any;

    const service = new ContestEntryScoringResultService(prisma);

    await service.replaceEntryScoringResult({
      entryId: 'entry-1',
      totalScore: 16,
      standingsPosition: 1,
      isEliminated: false,
      scoreResult: {
        totalScore: 16,
        participantScores: [
          {
            rosterPickId: 'pick-1',
            pointsEarned: 16,
          },
        ],
        scoreEvents: [
          {
            rosterPickId: 'pick-1',
            participantContestScoringRuleId: 'rule-1',
            points: 16,
            detailsJson: { round: 2 },
          },
        ],
      },
      prizeAwards: [
        {
          contestPrizeDefinitionId: 'prize-1',
          prizeDefinitionId: 'FINAL_PLACE',
          displayName: 'Champion',
          amount: 100,
          percentage: undefined,
          awardedAt: new Date('2026-04-08T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contestEntryParticipantScore.findMany).toHaveBeenCalledWith({
      where: { entryId: 'entry-1' },
      select: { id: true },
    });
    expect(tx.contestEntryParticipantScoreEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        contestEntryParticipantScoreId: {
          in: ['score-old'],
        },
      },
    });
    expect(tx.contestEntryParticipantScore.create).toHaveBeenCalledWith({
      data: {
        entryId: 'entry-1',
        rosterPickId: 'pick-1',
        pointsEarned: 16,
      },
    });
    expect(tx.contestEntryParticipantScoreEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          contestEntryParticipantScoreId: 'score-new',
          participantContestScoringRuleId: 'rule-1',
          points: 16,
          detailsJson: { round: 2 },
        },
      ],
    });
    expect(tx.contestEntryPrizeAward.createMany).toHaveBeenCalledWith({
      data: [
        {
          entryId: 'entry-1',
          contestPrizeDefinitionId: 'prize-1',
          prizeDefinitionId: 'FINAL_PLACE',
          displayName: 'Champion',
          amount: 100,
          percentage: undefined,
          awardedAt: new Date('2026-04-08T00:00:00.000Z'),
        },
      ],
    });
    expect(tx.contestEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: {
        totalScore: 16,
        standingsPosition: 1,
        isEliminated: false,
      },
    });
  });
});
