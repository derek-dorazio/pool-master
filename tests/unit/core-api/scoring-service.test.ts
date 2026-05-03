import { ContestEntryNotFoundError } from '../../../packages/core-api/src/modules/contests/service';
import { ScoringService } from '../../../packages/core-api/src/modules/scoring/service';

describe('ScoringService', () => {
  it('pool-master-rop.6: throws when the entry is missing or belongs to another contest', async () => {
    const standingsRollup = {
      rollupContest: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      getActiveContestIds: jest.fn().mockReturnValue(new Set()),
    };
    const prisma = {
      contestEntry: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'entry-2',
            contestId: 'other-contest',
            totalScore: 22,
          }),
      },
    } as any;

    const service = new ScoringService({
      standingsRollup: standingsRollup as any,
      prisma,
    });

    await expect(
      service.getEntryScore('contest-1', 'missing-entry'),
    ).rejects.toBeInstanceOf(ContestEntryNotFoundError);

    await expect(
      service.getEntryScore('contest-1', 'entry-2'),
    ).rejects.toBeInstanceOf(ContestEntryNotFoundError);
  });

  it('reads persisted entry scoring events from the participant score ledger', async () => {
    const standingsRollup = {
      rollupContest: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      getActiveContestIds: jest.fn().mockReturnValue(new Set()),
    };
    const prisma = {
      contestEntry: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'entry-1',
          contestId: 'contest-1',
          totalScore: 12,
        }),
      },
      contestEntryParticipantScoreEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'event-1',
            points: 12,
            detailsJson: {
              eventType: 'TEAM_WIN_POINTS',
              round: 5,
              pointsPerWin: 12,
            },
            createdAt: new Date('2026-04-03T10:00:00Z'),
            participantScore: {
              rosterPick: {
                sportEventParticipant: {
                  participant: {
                    id: 'participant-1',
                    name: 'Scottie Scheffler',
                  },
                },
              },
            },
          },
        ]),
      },
    } as any;

    const service = new ScoringService({
      standingsRollup: standingsRollup as any,
      prisma,
    });

    const result = await service.getEntryScore('contest-1', 'entry-1');

    expect(result.totalScore).toBe(12);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toMatchObject({
      contestId: 'contest-1',
      entryId: 'entry-1',
      pointsEarned: 12,
      runningTotal: 12,
    });
    expect(result.timeline[0]?.participantBreakdowns[0]).toMatchObject({
      participantId: 'participant-1',
      participantName: 'Scottie Scheffler',
      contextLabel: null,
      finalScore: 12,
      statPoints: 12,
    });
  });

  it('reads participant scoring history from persisted score events', async () => {
    const prisma = {
      contestEntryParticipantScoreEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'event-1',
            points: 3,
            detailsJson: {
              eventType: 'SEED_DIFFERENTIAL_BONUS',
              differential: 3,
            },
            createdAt: new Date('2026-04-03T10:00:00Z'),
            participantScore: {
              rosterPick: {
                sportEventParticipant: {
                  participant: {
                    id: 'participant-1',
                    name: 'Underdog Team',
                  },
                },
              },
            },
          },
        ]),
      },
    } as any;

    const service = new ScoringService({
      standingsRollup: {
        rollupContest: jest.fn(),
        isRunning: jest.fn().mockReturnValue(false),
        getActiveContestIds: jest.fn().mockReturnValue(new Set()),
      } as any,
      prisma,
    });

    const result = await service.getParticipantScoreHistory('contest-1', 'participant-1');

    expect(result).toEqual(
      expect.objectContaining({
        contestId: 'contest-1',
        participantId: 'participant-1',
        totalPoints: 3,
      }),
    );
    expect(result.scores[0]).toMatchObject({
      contestId: 'contest-1',
      participantId: 'participant-1',
      points: 3,
      stats: {
        differential: 3,
      },
      breakdown: expect.objectContaining({
        participantName: 'Underdog Team',
        bonusPoints: 3,
        finalScore: 3,
      }),
    });
  });

  it('returns empty participant history when no score events exist', async () => {
    const service = new ScoringService({
      standingsRollup: {
        rollupContest: jest.fn(),
        isRunning: jest.fn().mockReturnValue(false),
        getActiveContestIds: jest.fn().mockReturnValue(new Set()),
      } as any,
      prisma: {
        contestEntryParticipantScoreEvent: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as any,
    });

    await expect(service.getParticipantScoreHistory('contest-1', 'participant-1')).resolves.toEqual({
      participantId: 'participant-1',
      contestId: 'contest-1',
      scores: [],
      totalPoints: 0,
    });
  });

  it('proxies manual rollup requests and health state', async () => {
    const standingsRollup = {
      rollupContest: jest.fn().mockResolvedValue({
        contestId: 'contest-1',
        entriesUpdated: 3,
        leaderboardChanged: true,
      }),
      isRunning: jest.fn().mockReturnValue(true),
      getActiveContestIds: jest.fn().mockReturnValue(new Set(['contest-1', 'contest-2'])),
    };
    const service = new ScoringService({
      standingsRollup: standingsRollup as any,
      prisma: {} as any,
    });

    await expect(service.triggerRollup('contest-1')).resolves.toEqual({
      contestId: 'contest-1',
      entriesUpdated: 3,
      leaderboardChanged: true,
    });
    expect(standingsRollup.rollupContest).toHaveBeenCalledWith('contest-1');
    expect(service.getHealth()).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'scoring-service',
        rollupRunning: true,
        activeContests: 2,
      }),
    );
  });
});
