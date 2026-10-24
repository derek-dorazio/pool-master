/**
 * A league's choice of how its commissioners hear about upcoming events (#851): which sport
 * leagues, and one email per event or a weekly digest, against the in-memory league world.
 */
import { EventEmailDelivery } from '@poolmaster/shared/domain';
import { buildSportLeague } from '../../factories';
import { LeagueEventEmailSettingsService } from '../../../packages/core-api/src/modules/leagues/event-email-settings-service';
import { LeagueNotFoundError } from '../../../packages/core-api/src/modules/leagues/service';
import { inMemoryLeagueWorld } from '../../support/in-memory-league-world';

describe('LeagueEventEmailSettingsService', () => {
  const pgaTour = buildSportLeague({ id: '00000000-0000-4000-8000-000000000001', name: 'PGA Tour' });
  const nascar = buildSportLeague({ id: '00000000-0000-4000-8000-000000000002', name: 'NASCAR Cup Series' });

  function setup() {
    const world = inMemoryLeagueWorld();
    const settings = new LeagueEventEmailSettingsService({
      leagues: world.leagues,
      sportLeagues: { findAll: async () => [pgaTour, nascar] },
    });
    return { world, settings };
  }

  it('starts a league hearing about every sport league one email per event, and replaces its muted list whole, each sport league once, and its delivery', async () => {
    const { world, settings } = setup();
    const league = world.addLeague();
    expect(league.mutedSportLeagueIds).toEqual([]);
    expect(league.eventEmailDelivery).toBe(EventEmailDelivery.PER_EVENT);

    await settings.update(league.id, { mutedSportLeagueIds: [nascar.id, pgaTour.id, nascar.id], eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });
    expect(world.tables.leagues.get(league.id)).toMatchObject({ mutedSportLeagueIds: [nascar.id, pgaTour.id], eventEmailDelivery: EventEmailDelivery.WEEKLY_DIGEST });

    const updated = await settings.update(league.id, { mutedSportLeagueIds: [], eventEmailDelivery: EventEmailDelivery.PER_EVENT });
    expect(updated).toMatchObject({ mutedSportLeagueIds: [], eventEmailDelivery: EventEmailDelivery.PER_EVENT });
  });

  it('refuses an id that is not a sport league with SPORT_LEAGUE_NOT_FOUND, changing nothing', async () => {
    const { world, settings } = setup();
    const league = world.addLeague();

    await expect(settings.update(league.id, { mutedSportLeagueIds: [pgaTour.id, '00000000-0000-4000-8000-0000000000ff'], eventEmailDelivery: EventEmailDelivery.PER_EVENT }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND' });
    expect(world.tables.leagues.get(league.id)?.mutedSportLeagueIds).toEqual([]);
  });

  it('refuses an inactive league with LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE, and a missing one as not found', async () => {
    const { world, settings } = setup();
    const closed = world.addLeague({ isActive: false });

    await expect(settings.update(closed.id, { mutedSportLeagueIds: [pgaTour.id], eventEmailDelivery: EventEmailDelivery.PER_EVENT }))
      .rejects.toMatchObject({ code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE' });
    await expect(settings.update('no-such-league', { mutedSportLeagueIds: [], eventEmailDelivery: EventEmailDelivery.PER_EVENT }))
      .rejects.toBeInstanceOf(LeagueNotFoundError);
  });
});
