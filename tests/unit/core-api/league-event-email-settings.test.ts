/**
 * A league's choice of which sport leagues' upcoming events its commissioners are emailed about
 * (#851), against the in-memory league world.
 */
import { buildSportLeague } from '../../factories';
import { LeagueEventEmailSettings } from '../../../packages/core-api/src/modules/leagues/event-email-settings';
import { inMemoryLeagueWorld } from '../../support/in-memory-league-world';

describe('LeagueEventEmailSettings', () => {
  const pgaTour = buildSportLeague({ id: '00000000-0000-4000-8000-000000000001', name: 'PGA Tour' });
  const nascar = buildSportLeague({ id: '00000000-0000-4000-8000-000000000002', name: 'NASCAR Cup Series' });

  function setup() {
    const world = inMemoryLeagueWorld();
    const settings = new LeagueEventEmailSettings({
      leagues: world.leagues,
      sportLeagues: { findAll: async () => [pgaTour, nascar] },
    });
    return { world, settings };
  }

  it('starts a league hearing about every sport league, and replaces its muted list whole, each sport league once', async () => {
    const { world, settings } = setup();
    const league = world.addLeague();
    expect(league.mutedSportLeagueIds).toEqual([]);

    await settings.update(league.id, { mutedSportLeagueIds: [nascar.id, pgaTour.id, nascar.id] });
    expect(world.tables.leagues.get(league.id)?.mutedSportLeagueIds).toEqual([nascar.id, pgaTour.id]);

    const updated = await settings.update(league.id, { mutedSportLeagueIds: [] });
    expect(updated.mutedSportLeagueIds).toEqual([]);
  });

  it('refuses an id that is not a sport league with SPORT_LEAGUE_NOT_FOUND, changing nothing', async () => {
    const { world, settings } = setup();
    const league = world.addLeague();

    await expect(settings.update(league.id, { mutedSportLeagueIds: [pgaTour.id, '00000000-0000-4000-8000-0000000000ff'] }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND' });
    expect(world.tables.leagues.get(league.id)?.mutedSportLeagueIds).toEqual([]);
  });

  it('refuses an inactive league with LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE, and a missing one as not found', async () => {
    const { world, settings } = setup();
    const closed = world.addLeague({ isActive: false });

    await expect(settings.update(closed.id, { mutedSportLeagueIds: [pgaTour.id] }))
      .rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE' });
    await expect(settings.update('no-such-league', { mutedSportLeagueIds: [] }))
      .rejects.toThrow('no-such-league');
  });
});
