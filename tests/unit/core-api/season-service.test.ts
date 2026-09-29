import { Sport } from '@poolmaster/shared/domain';
import { SeasonService } from '../../../packages/core-api/src/modules/sport-catalog/season-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// SeasonService's own logic against an in-memory store: seasons listed under their sport
// league, the duplicate-year guard, isCurrent derived from the sport league's pointer, and
// the calendar clone. Repository queries are asserted against Postgres in
// sport-catalog-repositories.integration.

function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const sportLeague = store.addSportLeague(sport.id);
  const season = store.addSeason(sportLeague.id, 2024);
  store.sportLeagues[0].currentSeasonId = season.id;
  const service = new SeasonService({
    sportLeagues: store.sportLeagueRepo(),
    seasons: store.seasonRepo(),
    sportEvents: store.sportEventRepo(),
  });
  return { store, service, sportLeague, season };
}

describe('SeasonService — seasons', () => {
  it('lists a sport league\'s seasons newest first, with event counts and which one is current', async () => {
    const { store, service, sportLeague, season } = setup();
    store.addSeason(sportLeague.id, 2025);
    store.addEvent({ seasonId: season.id });
    store.addEvent({ seasonId: season.id });

    const seasons = await service.listSeasons(sportLeague.id);

    expect(seasons.map((row) => [row.year, row.sportEventCount, row.isCurrent])).toEqual([[2025, 0, false], [2024, 2, true]]);
  });

  it('fails with 404 SPORT_LEAGUE_NOT_FOUND when listing or creating under an unknown sport league', async () => {
    const { service } = setup();

    await expect(service.listSeasons('missing')).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    await expect(service.createSeason({
      sportLeagueId: 'missing', name: 'x', year: 2030, startDate: new Date(), endDate: new Date(),
    })).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });

  it('rejects a second season for the same sport league and year with 409 SEASON_YEAR_ALREADY_EXISTS', async () => {
    const { service, sportLeague } = setup();

    await expect(service.createSeason({
      sportLeagueId: sportLeague.id, name: 'Again', year: 2024, startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31'),
    })).rejects.toMatchObject({ code: 'SEASON_YEAR_ALREADY_EXISTS', statusCode: 409 });
  });

  it('returns null for a missing season, and fails update and set-current with 404 SEASON_NOT_FOUND', async () => {
    const { service } = setup();

    await expect(service.getSeason('missing')).resolves.toBeNull();
    await expect(service.updateSeason('missing', { name: 'x' })).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
    await expect(service.setCurrentSeason('missing')).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });

  it('moves the sport league\'s pointer on set-current, so exactly one season is current', async () => {
    const { store, service, sportLeague } = setup();
    const next = store.addSeason(sportLeague.id, 2025);

    const updated = await service.setCurrentSeason(next.id);

    expect(updated.currentSeasonId).toBe(next.id);
    await expect(service.getSeason(next.id)).resolves.toMatchObject({ isCurrent: true });
  });
});

describe('SeasonService.cloneSeason (plans/124 §4.2a)', () => {
  it('creates next year\'s season (leap-year safe) and re-creates each source event a year on, through the creation function', async () => {
    const { store, service, season } = setup();
    store.seasons[0].startDate = new Date('2024-02-29T00:00:00.000Z');
    store.addEvent({
      seasonId: season.id, name: 'The Open', venue: 'Royal Liverpool', rounds: 4,
      startDate: new Date('2024-07-18T00:00:00.000Z'), endDate: new Date('2024-07-21T00:00:00.000Z'),
      releaseAt: new Date('2024-07-04T00:00:00.000Z'), fieldLocksAt: new Date('2024-07-17T00:00:00.000Z'),
    });
    const createEvent = jest.fn().mockResolvedValue({});

    const result = await service.cloneSeason(season.id, undefined, createEvent);

    // Feb 29 lands on Mar 1 in the non-leap year.
    expect(result.season).toMatchObject({ year: 2025, name: 'Season 2025', startDate: new Date('2025-03-01T00:00:00.000Z'), isCurrent: false });
    expect(result.clonedEventCount).toBe(1);
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'The Open',
      venue: 'Royal Liverpool',
      startDate: new Date('2025-07-18T00:00:00.000Z'),
      endDate: new Date('2025-07-21T00:00:00.000Z'),
      seasonId: result.season.id,
    }));
  });

  it('honours an explicit target year, and stops with 409 before creating anything when that year exists', async () => {
    const { store, service, sportLeague, season } = setup();
    store.addEvent({ seasonId: season.id });
    const createEvent = jest.fn().mockResolvedValue({});

    await expect(service.cloneSeason(season.id, 2028, createEvent)).resolves.toMatchObject({ season: { year: 2028 } });

    store.addSeason(sportLeague.id, 2025);
    createEvent.mockClear();
    await expect(service.cloneSeason(season.id, undefined, createEvent)).rejects.toMatchObject({ code: 'SEASON_YEAR_ALREADY_EXISTS', statusCode: 409 });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('fails with 404 SEASON_NOT_FOUND for a missing source season', async () => {
    const { service } = setup();

    await expect(service.cloneSeason('missing', undefined, jest.fn())).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
  });
});
