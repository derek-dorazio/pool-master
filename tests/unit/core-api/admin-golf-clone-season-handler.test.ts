import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { SportCatalogError } from '../../../packages/core-api/src/modules/sport-catalog/errors';

// plans/124 §4.2a — pool-master-pcd. The adminCloneGolfSeason handler wires the
// season-service clone to the golf tournament-creation function and maps its
// errors through the shared golf error path.

function buildReply() {
  const reply = {
    statusCode: 200,
    status: jest.fn().mockImplementation((code: number) => {
      reply.statusCode = code;
      return reply;
    }),
    send: jest.fn().mockReturnThis(),
  };
  return reply;
}

function buildHandlers(seasonServiceOverride: Record<string, unknown> = {}) {
  const cloneSeasonTournaments = jest.fn().mockResolvedValue({
    season: {
      id: 'season-new',
      sportLeagueId: 'league-1',
      name: 'PGA Tour 2027',
      year: 2027,
      startDate: new Date('2027-01-04T00:00:00.000Z'),
      endDate: new Date('2027-11-30T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      tournamentCount: 3,
      isCurrent: false,
    },
    tournamentsCloned: 3,
  });
  const seasonService = { cloneSeasonTournaments, ...seasonServiceOverride };
  const golfTournamentService = { createTournament: jest.fn().mockResolvedValue({ id: 'clone' }) };

  const handlers = createGolfAdminHandlers(
    {} as never,
    seasonService as never,
    {} as never,
    golfTournamentService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { handlers, cloneSeasonTournaments, golfTournamentService };
}

describe('pool-master-pcd — adminCloneGolfSeason handler', () => {
  it('pool-master-pcd clones the season, passing the tournament-creation fn, and 201s the detail DTO + count', async () => {
    const { handlers, cloneSeasonTournaments, golfTournamentService } = buildHandlers();
    const reply = buildReply();

    await handlers.cloneSeason(
      { params: { seasonId: 'season-src' }, body: { targetYear: 2027 } } as never,
      reply as never,
    );

    expect(cloneSeasonTournaments).toHaveBeenCalledWith(
      'season-src',
      2027,
      expect.any(Function),
    );
    // The injected fn delegates to golfTournamentService.createTournament.
    const injected = cloneSeasonTournaments.mock.calls[0][2] as (i: unknown) => unknown;
    injected({ name: 'x' });
    expect(golfTournamentService.createTournament).toHaveBeenCalledWith({ name: 'x' });

    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalledWith({
      season: expect.objectContaining({
        id: 'season-new',
        year: 2027,
        isCurrent: false,
        tournamentCount: 3,
        startDate: '2027-01-04T00:00:00.000Z',
      }),
      tournamentsCloned: 3,
    });
  });

  it('pool-master-pcd defaults targetYear to undefined when the body omits it', async () => {
    const { handlers, cloneSeasonTournaments } = buildHandlers();
    const reply = buildReply();

    await handlers.cloneSeason(
      { params: { seasonId: 'season-src' }, body: {} } as never,
      reply as never,
    );

    expect(cloneSeasonTournaments).toHaveBeenCalledWith('season-src', undefined, expect.any(Function));
  });

  it('pool-master-pcd maps a 409 SEASON_YEAR_ALREADY_EXISTS from the service', async () => {
    const { handlers } = buildHandlers({
      cloneSeasonTournaments: jest
        .fn()
        .mockRejectedValue(
          new SportCatalogError('exists', 'SEASON_YEAR_ALREADY_EXISTS', 409),
        ),
    });
    const reply = buildReply();

    await handlers.cloneSeason(
      { params: { seasonId: 'season-src' }, body: {} } as never,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'SEASON_YEAR_ALREADY_EXISTS' }),
      }),
    );
  });

  it('pool-master-pcd maps a 404 SEASON_NOT_FOUND from the service', async () => {
    const { handlers } = buildHandlers({
      cloneSeasonTournaments: jest
        .fn()
        .mockRejectedValue(new SportCatalogError('missing', 'SEASON_NOT_FOUND', 404)),
    });
    const reply = buildReply();

    await handlers.cloneSeason(
      { params: { seasonId: 'missing' }, body: {} } as never,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
  });
});
