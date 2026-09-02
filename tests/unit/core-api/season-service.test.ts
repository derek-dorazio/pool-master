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
