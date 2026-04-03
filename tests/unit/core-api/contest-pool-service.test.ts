import { ContestPoolService } from '../../../packages/core-api/src/modules/participants/pool-service';

describe('ContestPoolService EVENT_FIELD resolution', () => {
  it('builds round-one bracket matchups from event field participants', async () => {
    const pool = {
      id: 'pool-1',
      contestId: 'contest-1',
      sport: 'NCAA_BASKETBALL',
      eventId: 'event-1',
      poolType: 'EVENT_FIELD',
      config: {},
      excludedParticipantIds: [],
      poolLocked: false,
    };

    const sportEvent = {
      id: 'event-1',
      providerId: 'espn',
      externalId: 'evt-1',
      sport: 'NCAA_BASKETBALL',
      name: 'Bracket Event',
      startDate: new Date('2026-04-10T12:00:00.000Z'),
      endDate: null,
      status: 'SCHEDULED',
      rounds: null,
      participantCount: 4,
      fieldLocked: false,
      venue: null,
      location: null,
      metadata: {
        participantExternalIds: ['team-1', 'team-2', 'team-3', 'team-4'],
        competitors: [
          { externalId: 'team-1', name: 'Team 1', seed: 1 },
          { externalId: 'team-2', name: 'Team 2', seed: 2 },
          { externalId: 'team-3', name: 'Team 3', seed: 3 },
          { externalId: 'team-4', name: 'Team 4', seed: 4 },
        ],
      },
    };

    const poolRepo = {
      findByContest: jest.fn().mockResolvedValue(pool),
      create: jest.fn(),
      update: jest.fn(),
      lock: jest.fn(),
    };
    const poolParticipantRepo = {
      deleteByPool: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue(4),
      findByContest: jest.fn().mockResolvedValue([
        { participantId: 'p1', ranking: 1 },
        { participantId: 'p2', ranking: 2 },
        { participantId: 'p3', ranking: 3 },
        { participantId: 'p4', ranking: 4 },
      ]),
      findByPool: jest.fn(),
      update: jest.fn(),
    };
    const contestMatchupRepo = {
      deleteByContest: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue(2),
    };
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(sportEvent),
      },
      participantProviderMapping: {
        findMany: jest.fn().mockResolvedValue([
          { externalId: 'team-1', participant: makeParticipant('p1', 'Team 1', 'team-1') },
          { externalId: 'team-2', participant: makeParticipant('p2', 'Team 2', 'team-2') },
          { externalId: 'team-3', participant: makeParticipant('p3', 'Team 3', 'team-3') },
          { externalId: 'team-4', participant: makeParticipant('p4', 'Team 4', 'team-4') },
        ]),
      },
      contest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'contest-1',
          selectionType: 'BRACKET_PICK_EM',
          lockAt: new Date('2026-04-10T11:00:00.000Z'),
          selectionConfig: null,
        }),
      },
      participant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', name: 'Team 1' },
          { id: 'p2', name: 'Team 2' },
          { id: 'p3', name: 'Team 3' },
          { id: 'p4', name: 'Team 4' },
        ]),
      },
    };

    const service = new ContestPoolService(
      poolRepo as any,
      poolParticipantRepo as any,
      {} as any,
      contestMatchupRepo as any,
      prisma as any,
    );

    const result = await service.resolvePool('contest-1');

    expect(result.count).toBe(4);
    expect(poolParticipantRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ participantId: 'p1', ranking: 1 }),
      expect.objectContaining({ participantId: 'p2', ranking: 2 }),
      expect.objectContaining({ participantId: 'p3', ranking: 3 }),
      expect.objectContaining({ participantId: 'p4', ranking: 4 }),
    ]);
    expect(contestMatchupRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ homeParticipantId: 'p1', awayParticipantId: 'p4', roundNumber: 1 }),
      expect.objectContaining({ homeParticipantId: 'p2', awayParticipantId: 'p3', roundNumber: 1 }),
    ]);
  });

  it('builds a pickem matchup from event competitors', async () => {
    const pool = {
      id: 'pool-2',
      contestId: 'contest-2',
      sport: 'NFL',
      eventId: 'event-2',
      poolType: 'EVENT_FIELD',
      config: {},
      excludedParticipantIds: [],
      poolLocked: false,
    };

    const sportEvent = {
      id: 'event-2',
      providerId: 'the-odds-api',
      externalId: 'evt-2',
      sport: 'NFL',
      name: 'Home vs Away',
      startDate: new Date('2026-09-10T20:15:00.000Z'),
      endDate: null,
      status: 'SCHEDULED',
      rounds: null,
      participantCount: 2,
      fieldLocked: false,
      venue: null,
      location: null,
      metadata: {
        competitors: [
          { externalId: 'home-team', name: 'Home Team', homeAway: 'home' },
          { externalId: 'away-team', name: 'Away Team', homeAway: 'away' },
        ],
      },
    };

    const poolRepo = {
      findByContest: jest.fn().mockResolvedValue(pool),
      create: jest.fn(),
      update: jest.fn(),
      lock: jest.fn(),
    };
    const poolParticipantRepo = {
      deleteByPool: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue(2),
      findByContest: jest.fn().mockResolvedValue([
        { participantId: 'home-id', ranking: 1 },
        { participantId: 'away-id', ranking: 2 },
      ]),
      findByPool: jest.fn(),
      update: jest.fn(),
    };
    const contestMatchupRepo = {
      deleteByContest: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(sportEvent),
      },
      participantProviderMapping: {
        findMany: jest.fn().mockResolvedValue([
          { externalId: 'home-team', participant: makeParticipant('home-id', 'Home Team', 'home-team') },
          { externalId: 'away-team', participant: makeParticipant('away-id', 'Away Team', 'away-team') },
        ]),
      },
      contest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'contest-2',
          selectionType: 'PICK_EM',
          lockAt: new Date('2026-09-10T20:00:00.000Z'),
          selectionConfig: null,
        }),
      },
      participant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'home-id', name: 'Home Team' },
          { id: 'away-id', name: 'Away Team' },
        ]),
      },
    };

    const service = new ContestPoolService(
      poolRepo as any,
      poolParticipantRepo as any,
      {} as any,
      contestMatchupRepo as any,
      prisma as any,
    );

    await service.resolvePool('contest-2');

    expect(contestMatchupRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        homeParticipantId: 'home-id',
        awayParticipantId: 'away-id',
        roundNumber: 1,
        matchupIndex: 1,
      }),
    ]);
  });
});

function makeParticipant(id: string, name: string, externalId: string) {
  return {
    id,
    sportId: 'sport-1',
    name,
    participantType: 'TEAM',
    externalId,
    metadata: {},
    firstName: null,
    lastName: null,
    shortName: null,
    nationality: null,
    position: null,
    teamAffiliation: name,
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    photoUrl: null,
    photoLastUpdated: null,
    externalIds: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
