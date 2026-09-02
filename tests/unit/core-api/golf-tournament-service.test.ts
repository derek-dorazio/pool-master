/**
 * Unit tests for GolfTournamentService (pool-master-ij2 / plans/124 §4.3/§4.3a/§5.2).
 *
 * Coverage:
 *   - createTournament validates seasonId against Sport.GOLF via
 *     SeasonService.assertSeasonBelongsToSport, assigns providerId=manual-admin
 *     + a generated externalId + status=SCHEDULED + syncScope=NONE, resolves/
 *     creates the LeagueEvent by (sportLeagueId, name), and calls
 *     ensureSportEventRounds + ensureDefaultGolfTiers.
 *   - listTournaments/getTournament project field/tier/contest counts.
 *   - updateTournament rejects a provider-owned (syncScope=FULL) event with
 *     409 EVENT_NOT_ADMIN_MANAGED, and 404s a missing one.
 *   - deleteTournament rejects with 409 EVENT_HAS_CONTESTS when any Contest
 *     references it, and 404s a missing one.
 *   - getAllowedTransitions reads straight from SPORT_EVENT_STATUS_TRANSITIONS.
 */
import { GolfTournamentError, GolfTournamentService } from '../../../packages/core-api/src/modules/golf/golf-tournament-service';

function buildSportEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    providerId: 'manual-admin',
    externalId: 'manual-generated',
    name: 'The Masters',
    venue: null,
    location: null,
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: null,
    status: 'SCHEDULED',
    rounds: 4,
    releaseAt: new Date('2027-04-01T00:00:00.000Z'),
    fieldLocksAt: new Date('2027-04-08T00:00:00.000Z'),
    fieldLocked: false,
    seasonId: 'season-1',
    leagueEventId: 'league-event-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    createdAt: new Date('2027-01-01T00:00:00.000Z'),
    updatedAt: new Date('2027-01-01T00:00:00.000Z'),
    _count: { sportEventParticipants: 0, golfTiers: 0, contests: 0 },
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  return {
    prisma: {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([buildSportEventRow()]),
        findUnique: jest.fn().mockResolvedValue(buildSportEventRow()),
        create: jest.fn().mockResolvedValue(buildSportEventRow()),
        update: jest.fn().mockResolvedValue(buildSportEventRow()),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      leagueEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'league-event-1', sportLeagueId: 'league-1', name: 'The Masters' }),
      },
      contest: {
        count: jest.fn().mockResolvedValue(0),
      },
    },
    seasonService: {
      assertSeasonBelongsToSport: jest.fn().mockResolvedValue({
        id: 'season-1',
        sportLeagueId: 'league-1',
        name: '2027 Season',
        year: 2027,
        startDate: new Date('2027-01-01T00:00:00.000Z'),
        endDate: new Date('2027-12-31T00:00:00.000Z'),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    golfRoundScheduleService: {
      ensureSportEventRounds: jest.fn().mockResolvedValue([]),
    },
    golfTierService: {
      ensureDefaultGolfTiers: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe('GolfTournamentService.createTournament', () => {
  it('pool-master-ij2 validates seasonId against Sport.GOLF, assigns manual-admin identity, and seeds rounds + tiers', async () => {
    const deps = buildDeps();
    const service = new GolfTournamentService(
      deps.prisma as any,
      deps.seasonService as any,
      deps.golfRoundScheduleService as any,
      deps.golfTierService as any,
    );

    const result = await service.createTournament({
      name: 'The Masters',
      startDate: new Date('2027-04-08T00:00:00.000Z'),
      releaseAt: new Date('2027-04-01T00:00:00.000Z'),
      fieldLocksAt: new Date('2027-04-08T00:00:00.000Z'),
      seasonId: 'season-1',
    });

    expect(deps.seasonService.assertSeasonBelongsToSport).toHaveBeenCalledWith('season-1', 'GOLF');
    expect(deps.prisma.leagueEvent.upsert).toHaveBeenCalledWith({
      where: { sportLeagueId_name: { sportLeagueId: 'league-1', name: 'The Masters' } },
      create: { sportLeagueId: 'league-1', name: 'The Masters' },
      update: {},
    });
    expect(deps.prisma.sportEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'manual-admin',
          sport: 'GOLF',
          status: 'SCHEDULED',
          syncScope: 'NONE',
          seasonId: 'season-1',
          leagueEventId: 'league-event-1',
          rounds: 4,
        }),
      }),
    );
    expect(deps.prisma.sportEvent.create.mock.calls[0][0].data.externalId).toMatch(/^manual-/);
    expect(deps.golfRoundScheduleService.ensureSportEventRounds).toHaveBeenCalledWith({
      sportEventId: 'event-1',
      rounds: 4,
      startDate: new Date('2027-04-08T00:00:00.000Z'),
    });
    expect(deps.golfTierService.ensureDefaultGolfTiers).toHaveBeenCalledWith('event-1');
    expect(result.fieldCount).toBe(0);
    expect(result.tierCount).toBe(0);
    expect(result.contestCount).toBe(0);
  });

  it('pool-master-ij2 defaults rounds to 4 when not supplied, and passes through an explicit rounds count', async () => {
    const deps = buildDeps();
    const service = new GolfTournamentService(
      deps.prisma as any,
      deps.seasonService as any,
      deps.golfRoundScheduleService as any,
      deps.golfTierService as any,
    );

    await service.createTournament({
      name: 'The Open',
      startDate: new Date('2027-07-01T00:00:00.000Z'),
      releaseAt: new Date('2027-06-01T00:00:00.000Z'),
      fieldLocksAt: new Date('2027-07-01T00:00:00.000Z'),
      seasonId: 'season-1',
      rounds: 3,
    });

    expect(deps.prisma.sportEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rounds: 3 }) }),
    );
    expect(deps.golfRoundScheduleService.ensureSportEventRounds).toHaveBeenCalledWith(
      expect.objectContaining({ rounds: 3 }),
    );
  });
});

describe('GolfTournamentService.listTournaments / getTournament', () => {
  it('pool-master-ij2 scopes listTournaments to Sport.GOLF and projects field/tier/contest counts', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: {
          findMany: jest.fn().mockResolvedValue([
            buildSportEventRow({ _count: { sportEventParticipants: 5, golfTiers: 6, contests: 2 } }),
          ]),
        },
      },
    });
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    const result = await service.listTournaments({ status: 'SCHEDULED', search: 'masters' });

    expect(deps.prisma.sportEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sport: 'GOLF',
          status: 'SCHEDULED',
          name: { contains: 'masters', mode: 'insensitive' },
        }),
      }),
    );
    expect(result[0]).toMatchObject({ fieldCount: 5, tierCount: 6, contestCount: 2 });
  });

  it('pool-master-ij2 returns null from getTournament when the event does not exist', async () => {
    const deps = buildDeps({
      prisma: { sportEvent: { findUnique: jest.fn().mockResolvedValue(null) } },
    });
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await expect(service.getTournament('missing')).resolves.toBeNull();
  });
});

describe('GolfTournamentService.updateTournament', () => {
  it('pool-master-ij2 updates a manual (non-FULL-sync) tournament', async () => {
    const deps = buildDeps();
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await service.updateTournament('event-1', { name: 'The Masters (renamed)' });

    expect(deps.prisma.sportEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({ name: 'The Masters (renamed)' }),
      }),
    );
  });

  it('pool-master-ij2 rejects updating a provider-owned event with 409 EVENT_NOT_ADMIN_MANAGED', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: {
          findUnique: jest.fn().mockResolvedValue(buildSportEventRow({ syncScope: 'FULL' })),
          update: jest.fn(),
        },
      },
    });
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await expect(service.updateTournament('event-1', { name: 'x' })).rejects.toMatchObject({
      name: 'GolfTournamentError',
      code: 'EVENT_NOT_ADMIN_MANAGED',
      statusCode: 409,
    });
    expect(deps.prisma.sportEvent.update).not.toHaveBeenCalled();
  });

  it('pool-master-ij2 rejects updating a missing event with 404 EVENT_NOT_FOUND', async () => {
    const deps = buildDeps({
      prisma: { sportEvent: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } },
    });
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await expect(service.updateTournament('missing', { name: 'x' })).rejects.toMatchObject({
      name: 'GolfTournamentError',
      code: 'EVENT_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('GolfTournamentService.deleteTournament', () => {
  it('pool-master-ij2 hard-deletes a tournament with no contests', async () => {
    const deps = buildDeps();
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await service.deleteTournament('event-1');

    expect(deps.prisma.sportEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1' } });
  });

  it('pool-master-ij2 rejects deleting a tournament with contests referencing it, 409 EVENT_HAS_CONTESTS', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUnique: jest.fn().mockResolvedValue(buildSportEventRow()), delete: jest.fn() },
        contest: { count: jest.fn().mockResolvedValue(3) },
      },
    });
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await expect(service.deleteTournament('event-1')).rejects.toMatchObject({
      name: 'GolfTournamentError',
      code: 'EVENT_HAS_CONTESTS',
      statusCode: 409,
    });
    expect(deps.prisma.sportEvent.delete).not.toHaveBeenCalled();
  });

  it('pool-master-ij2 rejects deleting a missing event with 404 EVENT_NOT_FOUND', async () => {
    const deps = buildDeps({
      prisma: { sportEvent: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() }, contest: { count: jest.fn() } },
    });
    const service = new GolfTournamentService(deps.prisma as any, {} as any, {} as any, {} as any);

    await expect(service.deleteTournament('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });
});

describe('GolfTournamentService.getAllowedTransitions', () => {
  it('pool-master-ij2 reads straight from the declared SPORT_EVENT_STATUS_TRANSITIONS map', () => {
    const service = new GolfTournamentService({} as any, {} as any, {} as any, {} as any);

    expect(service.getAllowedTransitions('SCHEDULED' as any)).toEqual(['IN_PROGRESS', 'POSTPONED', 'CANCELLED']);
    expect(service.getAllowedTransitions('COMPLETED' as any)).toEqual([]);
  });
});

describe('GolfTournamentError', () => {
  it('pool-master-ij2 carries the supplied code and statusCode', () => {
    const error = new GolfTournamentError('boom', 'SOME_CODE', 418);
    expect(error.code).toBe('SOME_CODE');
    expect(error.statusCode).toBe(418);
    expect(error.name).toBe('GolfTournamentError');
  });
});
