import { Sport } from '@poolmaster/shared/domain';
import type { Season, SportEvent, SportLeague } from '@poolmaster/shared/domain';
import { SeasonService } from '../../../packages/core-api/src/modules/sport-catalog/season-service';
import {
  fakeSeasonRepo,
  fakeSportEventRepo,
  fakeSportLeagueRepo,
  fakeSportRepo,
} from '../../support/repo-fakes';

// SeasonService's own logic against an in-memory season store: duplicate-year guard,
// isCurrent derived from the sport league's pointer, sport-mismatch validation, and the
// calendar clone. Repository queries themselves are asserted against Postgres in
// sport-catalog-repositories.integration.

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: 'season-2024',
    sportLeagueId: 'sl-pga',
    name: 'PGA Tour 2024',
    year: 2024,
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-12-31T00:00:00.000Z'),
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function sourceEvent(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'evt-open',
    name: 'The Open',
    venue: 'Royal Liverpool',
    location: 'Hoylake',
    startDate: new Date('2024-07-18T00:00:00.000Z'),
    endDate: new Date('2024-07-21T00:00:00.000Z'),
    rounds: 4,
    releaseAt: new Date('2024-07-04T00:00:00.000Z'),
    fieldLocksAt: new Date('2024-07-17T00:00:00.000Z'),
    autoLifecycleEnabled: true,
    seasonId: 'season-2024',
    ...overrides,
  } as SportEvent;
}

function buildService(options: {
  seasons?: Season[];
  sportLeague?: Partial<SportLeague> | null;
  sportName?: Sport;
  events?: SportEvent[];
} = {}) {
  const store = new Map((options.seasons ?? []).map((row) => [row.id, row]));
  const seasons = fakeSeasonRepo({
    findById: jest.fn().mockImplementation(async (id: string) => store.get(id) ?? null),
    findBySportLeagueAndYear: jest.fn().mockImplementation(async (sportLeagueId: string, year: number) => (
      [...store.values()].find((row) => row.sportLeagueId === sportLeagueId && row.year === year) ?? null
    )),
    create: jest.fn().mockImplementation(async (input: Omit<Season, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>) => {
      const created = season({ ...input, id: `season-${input.year}` });
      store.set(created.id, created);
      return created;
    }),
  });
  const sportLeague = options.sportLeague === null
    ? null
    : { id: 'sl-pga', sportId: 'sport-1', currentSeasonId: 'season-2024', ...options.sportLeague } as SportLeague;
  const deps = {
    sports: fakeSportRepo({
      findById: jest.fn().mockResolvedValue({ id: 'sport-1', name: options.sportName ?? Sport.GOLF }),
      findByName: jest.fn().mockResolvedValue({ id: 'sport-1', name: Sport.GOLF }),
    }),
    sportLeagues: fakeSportLeagueRepo({ findById: jest.fn().mockResolvedValue(sportLeague) }),
    seasons,
    sportEvents: fakeSportEventRepo({ findAll: jest.fn().mockResolvedValue(options.events ?? []) }),
  };
  return { service: new SeasonService(deps), deps, store };
}

describe('SeasonService — seasons', () => {
  it('lists the sport\'s seasons with their tournament counts, zero where there are none', async () => {
    const { service, deps } = buildService();
    deps.seasons.findAll = jest.fn().mockResolvedValue([season(), season({ id: 'season-2025', year: 2025 })]);
    deps.sportEvents.countBySeasons = jest.fn().mockResolvedValue(new Map([['season-2024', 12]]));

    const result = await service.listSeasons(Sport.GOLF);

    expect(result.map((row) => [row.year, row.tournamentCount])).toEqual([[2024, 12], [2025, 0]]);
  });

  it('rejects a second season for the same sport league and year with 409 SEASON_YEAR_ALREADY_EXISTS', async () => {
    const { service } = buildService({ seasons: [season()] });

    await expect(service.createSeason({
      sportLeagueId: 'sl-pga',
      name: 'Again',
      year: 2024,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    })).rejects.toMatchObject({ code: 'SEASON_YEAR_ALREADY_EXISTS', statusCode: 409 });
  });

  it('derives isCurrent from the sport league\'s currentSeasonId, not a stored flag', async () => {
    const current = buildService({ seasons: [season()] });
    await expect(current.service.getSeason('season-2024')).resolves.toMatchObject({ isCurrent: true });

    const other = buildService({ seasons: [season()], sportLeague: { currentSeasonId: 'season-2023' } });
    await expect(other.service.getSeason('season-2024')).resolves.toMatchObject({ isCurrent: false });
  });

  it('returns null for a missing season, and fails setCurrentSeason with 404 SEASON_NOT_FOUND', async () => {
    const { service } = buildService();

    await expect(service.getSeason('missing')).resolves.toBeNull();
    await expect(service.setCurrentSeason('missing')).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });

  it('accepts a season of the expected sport, and rejects one of another sport with 422 SEASON_SPORT_MISMATCH', async () => {
    await expect(buildService({ seasons: [season()] }).service.assertSeasonBelongsToSport('season-2024', Sport.GOLF))
      .resolves.toMatchObject({ id: 'season-2024' });
    await expect(buildService({ seasons: [season()], sportName: Sport.NBA }).service.assertSeasonBelongsToSport('season-2024', Sport.GOLF))
      .rejects.toMatchObject({ code: 'SEASON_SPORT_MISMATCH', statusCode: 422 });
    await expect(buildService().service.assertSeasonBelongsToSport('missing', Sport.GOLF))
      .rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });
});

describe('SeasonService.cloneSeasonTournaments (plans/124 §4.2a)', () => {
  it('creates the target season one year forward (leap-year safe) and re-runs creation per source tournament', async () => {
    const createTournament = jest.fn().mockResolvedValue({ id: 'clone' });
    const { service } = buildService({
      seasons: [season({ startDate: new Date('2024-02-29T00:00:00.000Z'), endDate: new Date('2024-11-30T00:00:00.000Z') })],
      events: [sourceEvent(), sourceEvent({ id: 'evt-masters', name: 'Masters', endDate: undefined })],
    });

    const result = await service.cloneSeasonTournaments('season-2024', undefined, createTournament);

    // Feb 29 lands on Mar 1 in the non-leap year (JS date rollover).
    expect(result).toEqual({
      season: expect.objectContaining({
        id: 'season-2025',
        name: 'PGA Tour 2025',
        year: 2025,
        startDate: new Date('2025-03-01T00:00:00.000Z'),
        endDate: new Date('2025-11-30T00:00:00.000Z'),
        isCurrent: false,
      }),
      tournamentsCloned: 2,
    });
    expect(createTournament).toHaveBeenNthCalledWith(1, {
      name: 'The Open',
      venue: 'Royal Liverpool',
      location: 'Hoylake',
      startDate: new Date('2025-07-18T00:00:00.000Z'),
      endDate: new Date('2025-07-21T00:00:00.000Z'),
      rounds: 4,
      releaseAt: new Date('2025-07-04T00:00:00.000Z'),
      fieldLocksAt: new Date('2025-07-17T00:00:00.000Z'),
      seasonId: 'season-2025',
      autoLifecycleEnabled: true,
    });
    // A source tournament with no end date stays without one.
    expect(createTournament).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'Masters', endDate: undefined }));
  });

  it('honours an explicit target year, renaming the season to match', async () => {
    const createTournament = jest.fn().mockResolvedValue({ id: 'clone' });
    const { service } = buildService({ seasons: [season()], events: [sourceEvent()] });

    const result = await service.cloneSeasonTournaments('season-2024', 2028, createTournament);

    expect(result.season).toMatchObject({ name: 'PGA Tour 2028', year: 2028 });
    expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ startDate: new Date('2028-07-18T00:00:00.000Z') }));
  });

  it('leaves the sport league\'s current season where it was', async () => {
    const { service, deps } = buildService({ seasons: [season()], events: [sourceEvent()] });

    await service.cloneSeasonTournaments('season-2024', undefined, jest.fn().mockResolvedValue({}));

    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('stops with 409 SEASON_YEAR_ALREADY_EXISTS before creating any tournament when the target year exists', async () => {
    const createTournament = jest.fn();
    const { service } = buildService({ seasons: [season(), season({ id: 'season-2025', year: 2025 })], events: [sourceEvent()] });

    await expect(service.cloneSeasonTournaments('season-2024', undefined, createTournament))
      .rejects.toMatchObject({ code: 'SEASON_YEAR_ALREADY_EXISTS', statusCode: 409 });
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('fails with 404 SEASON_NOT_FOUND for a missing source season', async () => {
    await expect(buildService().service.cloneSeasonTournaments('missing', undefined, jest.fn()))
      .rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });
});
