import { ScoringService } from '../../../packages/core-api/src/modules/scoring/service';

describe('ScoringService', () => {
  it('reads persisted entry scoring events and enriches pickem context', async () => {
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
      contest: {
        findUnique: jest.fn().mockResolvedValue({
          selectionType: 'PICK_EM',
        }),
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
      contextLabel: 'Week 5 Game 3',
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
});
