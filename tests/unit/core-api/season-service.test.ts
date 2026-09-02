import { Sport } from '@poolmaster/shared/domain';
import { SeasonService } from '../../../packages/core-api/src/modules/sport-catalog/season-service';

function buildSeasonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'season-1',
    sportLeagueId: 'league-1',
    name: 'PGA Tour 2026',
    year: 2026,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('SeasonService.listSeasons', () => {
  it('pool-master-2re scopes by sport and optional sportLeagueId/isActive filters, with tournament counts', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...buildSeasonRow(), _count: { sportEvents: 42 } },
    ]);
    const service = new SeasonService({ season: { findMany } } as any);

    const result = await service.listSeasons(Sport.GOLF, { isActive: true, sportLeagueId: 'league-1' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sportLeague: { sport: { name: Sport.GOLF } },
          isActive: true,
          sportLeagueId: 'league-1',
        },
      }),
    );
    expect(result).toEqual([expect.objectContaining({ name: 'PGA Tour 2026', tournamentCount: 42 })]);
  });
});

describe('SeasonService.createSeason', () => {
  it('pool-master-2re creates a season linked to its league', async () => {
    const create = jest.fn().mockResolvedValue(buildSeasonRow());
    const service = new SeasonService({
      season: { findUnique: jest.fn().mockResolvedValue(null), create },
    } as any);

    await service.createSeason({
      sportLeagueId: 'league-1',
      name: 'PGA Tour 2026',
      year: 2026,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        sportLeagueId: 'league-1',
        name: 'PGA Tour 2026',
        year: 2026,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
  });

  it('pool-master-2re rejects a duplicate (sportLeagueId, year) with 409 SEASON_YEAR_ALREADY_EXISTS', async () => {
    const service = new SeasonService({
      season: { findUnique: jest.fn().mockResolvedValue(buildSeasonRow()) },
    } as any);

    await expect(
      service.createSeason({
        sportLeagueId: 'league-1',
        name: 'PGA Tour 2026 (dup)',
        year: 2026,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      }),
    ).rejects.toMatchObject({ code: 'SEASON_YEAR_ALREADY_EXISTS', statusCode: 409 });
  });
});

describe('SeasonService.getSeason', () => {
  it('pool-master-2re derives isCurrent from the parent league\'s currentSeasonId, not a stored flag', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...buildSeasonRow(),
      sportLeague: { currentSeasonId: 'season-1' },
      _count: { sportEvents: 4 },
    });
    const service = new SeasonService({ season: { findUnique } } as any);

    const result = await service.getSeason('season-1');

    expect(result).toEqual(expect.objectContaining({ isCurrent: true, tournamentCount: 4 }));
  });

  it('pool-master-2re returns isCurrent false when a different season is current', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...buildSeasonRow(),
      sportLeague: { currentSeasonId: 'some-other-season' },
      _count: { sportEvents: 0 },
    });
    const service = new SeasonService({ season: { findUnique } } as any);

    const result = await service.getSeason('season-1');

    expect(result?.isCurrent).toBe(false);
  });

  it('pool-master-2re returns null for a missing season', async () => {
    const service = new SeasonService({ season: { findUnique: jest.fn().mockResolvedValue(null) } } as any);

    expect(await service.getSeason('missing')).toBeNull();
  });
});

describe('SeasonService.setCurrentSeason', () => {
  it('pool-master-2re writes currentSeasonId on the parent SportLeague in one atomic update', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue(buildSeasonRow());
    const update = jest.fn().mockResolvedValue({});
    const service = new SeasonService({
      season: { findUniqueOrThrow },
      sportLeague: { update },
    } as any);

    const result = await service.setCurrentSeason('season-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'league-1' },
      data: { currentSeasonId: 'season-1' },
    });
    expect(result).toEqual({ sportLeagueId: 'league-1', currentSeasonId: 'season-1' });
  });
});

describe('SeasonService.assertSeasonBelongsToSport', () => {
  it('pool-master-2re resolves a matching season', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...buildSeasonRow(),
      sportLeague: { sport: { name: Sport.GOLF } },
    });
    const service = new SeasonService({ season: { findUnique } } as any);

    const result = await service.assertSeasonBelongsToSport('season-1', Sport.GOLF);

    expect(result.id).toBe('season-1');
  });

  it('pool-master-2re rejects 422 SEASON_SPORT_MISMATCH when the season belongs to a different sport', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...buildSeasonRow(),
      sportLeague: { sport: { name: Sport.NBA } },
    });
    const service = new SeasonService({ season: { findUnique } } as any);

    await expect(service.assertSeasonBelongsToSport('season-1', Sport.GOLF)).rejects.toMatchObject({
      code: 'SEASON_SPORT_MISMATCH',
      statusCode: 422,
    });
  });

  it('pool-master-2re rejects 404 SEASON_NOT_FOUND for a missing season id', async () => {
    const service = new SeasonService({ season: { findUnique: jest.fn().mockResolvedValue(null) } } as any);

    await expect(service.assertSeasonBelongsToSport('missing', Sport.GOLF)).rejects.toMatchObject({
      code: 'SEASON_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('SeasonService.cloneSeasonTournaments (pool-master-pcd, plans/124 §4.2a)', () => {
  function sourceEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'evt-1',
      name: 'The Open',
      venue: 'Royal Liverpool',
      location: 'Hoylake',
      startDate: new Date('2024-07-18T00:00:00.000Z'),
      endDate: new Date('2024-07-21T00:00:00.000Z'),
      rounds: 4,
      releaseAt: new Date('2024-07-04T00:00:00.000Z'),
      fieldLocksAt: new Date('2024-07-17T00:00:00.000Z'),
      autoLifecycleEnabled: true,
      seasonId: 'season-src',
      ...overrides,
    };
  }

  function buildService(opts: {
    source: Record<string, unknown> | null;
    events: Array<Record<string, unknown>>;
    existingTargetYear?: boolean;
  }) {
    const created = {
      ...buildSeasonRow({ id: 'season-new', name: 'PGA Tour 2025', year: 2025 }),
    };
    const seasonFindUnique = jest
      .fn()
      // 1st call: cloneSeasonTournaments' own source lookup
      .mockResolvedValueOnce(opts.source)
      // 2nd call: createSeason's @@unique(sportLeagueId, year) pre-check
      .mockResolvedValueOnce(opts.existingTargetYear ? buildSeasonRow({ year: 2025 }) : null)
      // 3rd call: getSeason(newSeason.id)
      .mockResolvedValueOnce({
        ...created,
        sportLeague: { currentSeasonId: 'season-src' },
        _count: { sportEvents: opts.events.length },
      });
    const seasonCreate = jest.fn().mockResolvedValue(created);
    const sportEventFindMany = jest.fn().mockResolvedValue(opts.events);
    const createTournament = jest.fn().mockResolvedValue({ id: 'clone' });

    const service = new SeasonService({
      season: { findUnique: seasonFindUnique, create: seasonCreate },
      sportEvent: { findMany: sportEventFindMany },
    } as any);

    return { service, seasonCreate, sportEventFindMany, createTournament };
  }

  it('pool-master-pcd creates the target season one calendar year forward (leap-year safe) and re-runs creation per source tournament', async () => {
    const { service, seasonCreate, createTournament } = buildService({
      source: buildSeasonRow({
        id: 'season-src',
        name: 'PGA Tour 2024',
        year: 2024,
        startDate: new Date('2024-02-29T00:00:00.000Z'),
        endDate: new Date('2024-11-30T00:00:00.000Z'),
      }),
      events: [sourceEvent(), sourceEvent({ id: 'evt-2', name: 'Masters', endDate: null })],
    });

    const result = await service.cloneSeasonTournaments('season-src', undefined, createTournament);

    // Season row: year + 1, same month/day; Feb 29 -> Mar 1 in the non-leap year (JS rollover).
    expect(seasonCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sportLeagueId: 'league-1',
        name: 'PGA Tour 2025',
        year: 2025,
        startDate: new Date('2025-03-01T00:00:00.000Z'),
        endDate: new Date('2025-11-30T00:00:00.000Z'),
      }),
    });

    // One createTournament call per source event, dates shifted one year, targeting the new season.
    expect(createTournament).toHaveBeenCalledTimes(2);
    expect(createTournament).toHaveBeenNthCalledWith(1, {
      name: 'The Open',
      venue: 'Royal Liverpool',
      location: 'Hoylake',
      startDate: new Date('2025-07-18T00:00:00.000Z'),
      endDate: new Date('2025-07-21T00:00:00.000Z'),
      rounds: 4,
      releaseAt: new Date('2025-07-04T00:00:00.000Z'),
      fieldLocksAt: new Date('2025-07-17T00:00:00.000Z'),
      seasonId: 'season-new',
      autoLifecycleEnabled: true,
    });
    // A source event with no endDate stays undefined (not shifted null).
    expect(createTournament).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'Masters', endDate: undefined, seasonId: 'season-new' }),
    );

    expect(result).toEqual({
      season: expect.objectContaining({ id: 'season-new', year: 2025, isCurrent: false }),
      tournamentsCloned: 2,
    });
  });

  it('pool-master-pcd honours an explicit targetYear', async () => {
    const { service, seasonCreate, createTournament } = buildService({
      source: buildSeasonRow({ id: 'season-src', name: 'PGA Tour 2024', year: 2024 }),
      events: [sourceEvent()],
    });

    await service.cloneSeasonTournaments('season-src', 2028, createTournament);

    expect(seasonCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'PGA Tour 2028', year: 2028 }),
    });
    expect(createTournament).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: new Date('2028-07-18T00:00:00.000Z') }),
    );
  });

  it('pool-master-pcd does not touch currentSeasonId or copy any field/tier/score data (only createSeason + createTournament are written)', async () => {
    const seasonUpdate = jest.fn();
    const { service, createTournament } = buildService({
      source: buildSeasonRow({ id: 'season-src', name: 'PGA Tour 2024', year: 2024 }),
      events: [sourceEvent()],
    });
    (service as any).prisma.season.update = seasonUpdate;
    (service as any).prisma.sportLeague = { update: jest.fn() };

    await service.cloneSeasonTournaments('season-src', undefined, createTournament);

    expect(seasonUpdate).not.toHaveBeenCalled();
    expect((service as any).prisma.sportLeague.update).not.toHaveBeenCalled();
    // No participant/tier/valuation writes exist on the mocked client — the code
    // path only calls createSeason + createTournament, which is the point.
  });

  it('pool-master-pcd surfaces 409 SEASON_YEAR_ALREADY_EXISTS from createSeason', async () => {
    const { service, createTournament } = buildService({
      source: buildSeasonRow({ id: 'season-src', name: 'PGA Tour 2024', year: 2024 }),
      events: [sourceEvent()],
      existingTargetYear: true,
    });

    await expect(
      service.cloneSeasonTournaments('season-src', undefined, createTournament),
    ).rejects.toMatchObject({ code: 'SEASON_YEAR_ALREADY_EXISTS', statusCode: 409 });
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('pool-master-pcd rejects 404 SEASON_NOT_FOUND for a missing source season', async () => {
    const { service, createTournament } = buildService({ source: null, events: [] });

    await expect(
      service.cloneSeasonTournaments('missing', undefined, createTournament),
    ).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });
});
