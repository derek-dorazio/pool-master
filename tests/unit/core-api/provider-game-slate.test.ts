import { expect, jest } from '@jest/globals';
import type { ContestRepository } from '@poolmaster/shared/db';
import { MatchStatus, Sport, SportEventStatus, SportEventSyncScope, type SportEventStatus as Status } from '@poolmaster/shared/domain';
import { ProviderGameSlateService } from '../../../packages/core-api/src/modules/events/provider-game-slate';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import type { ProviderScheduledGame } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { fakeLogger } from '../../support/fake-logger';

// A synced league's game week takes its games from its provider (ADR 0011, #1728), against an
// in-memory store and the real bracket service: what a draft loads and replaces, what a released
// week still takes (kickoffs only), and every event it leaves alone. The NFL and Premier League
// readers' games are proved in their own mapping tests; the field load's call into this against
// Postgres in provider-game-slate.integration.

const PROVIDER = 'feed';
const KICKOFF = new Date('2026-11-15T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const TEAMS = ['Bears', 'Lions', 'Packers', 'Vikings'] as const;

function setup({ status = SportEventStatus.DRAFT, synced = true, rounds = 1 }: { status?: Status; synced?: boolean; rounds?: number } = {}) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.AMERICAN_FOOTBALL);
  const league = store.addSportLeague(sport.id, 'NFL');
  const event = store.addEvent({
    sportLeagueId: league.id,
    sport: Sport.AMERICAN_FOOTBALL,
    status,
    rounds,
    providerId: PROVIDER,
    externalId: 'nfl-2026-week-11',
    syncScope: SportEventSyncScope.SCORES_ONLY,
    ...(synced && { eventSyncProviderId: PROVIDER }),
  });
  void store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: KICKOFF }]);
  const field = Object.fromEntries(TEAMS.map((name) => {
    const team = store.addParticipant(sport.id, name, { participantType: 'TEAM' });
    void store.mappingRepo().bind({ participantId: team.id, providerId: PROVIDER, externalId: `team-${name}`, confidence: 'EXACT', mappedAt: KICKOFF });
    return [name, store.addToField(event.id, team.id).id];
  })) as Record<(typeof TEAMS)[number], string>;
  let sequence = 0;
  const bracket = new SportEventBracketService({
    sportEvents: store.sportEventRepo(),
    sportLeagues: store.sportLeagueRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    affiliations: store.affiliationRepo(),
    matches: store.matchRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    contests: { recheckReminders: jest.fn<ContestRepository['recheckReminders']>().mockResolvedValue(undefined) },
    ...NO_PICKS_ON_EVENT,
    newId: () => {
      sequence += 1;
      return `match-${sequence}`;
    },
  });
  const logger = fakeLogger();
  const service = new ProviderGameSlateService({
    sportEvents: store.sportEventRepo(),
    matches: store.matchRepo(),
    field: store.fieldRepo(),
    mappings: store.mappingRepo(),
    bracket,
    logger,
  });
  const matchesNow = async () => (await store.matchRepo().findBySportEvent(event.id))
    .map((match) => [match.matchNumber, match.homeSportEventParticipantId, match.awaySportEventParticipantId, match.scheduledDate?.toISOString() ?? null]);
  return { store, event, field, bracket, service, logger, matchesNow };
}

function game(id: string, home: string, away: string, hoursAfterKickoff: number): ProviderScheduledGame {
  return { externalGameId: id, roundNumber: 1, homeTeamExternalId: `team-${home}`, awayTeamExternalId: `team-${away}`, scheduledAt: new Date(KICKOFF.getTime() + hoursAfterKickoff * HOUR), isNeutralSite: false };
}

const WEEK = [game('g2', 'Packers', 'Vikings', 3), game('g1', 'Bears', 'Lions', 0)];

describe('ProviderGameSlateService', () => {
  it('loads a synced draft week\'s games as its matches in kickoff order, each side from the field', async () => {
    const { service, event, field, matchesNow } = setup();

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK }))
      .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 2 });

    expect(await matchesNow()).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 3 * HOUR).toISOString()],
    ]);
  });

  it('writes nothing when a draft already holds the provider\'s games', async () => {
    const { service, event, store } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });
    const idsBefore = (await store.matchRepo().findBySportEvent(event.id)).map((match) => match.id);

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: [...WEEK].reverse() }))
      .resolves.toEqual({ outcome: 'UNCHANGED', sportEventId: event.id });
    expect((await store.matchRepo().findBySportEvent(event.id)).map((match) => match.id)).toEqual(idsBefore);
  });

  it('replaces a draft\'s games, an admin\'s included, when the provider\'s pairings or kickoffs change', async () => {
    const { service, event, field, matchesNow } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });

    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: [game('g3', 'Bears', 'Packers', 1), game('g4', 'Lions', 'Vikings', 2)] });

    expect(await matchesNow()).toEqual([
      [1, field.Bears, field.Packers, new Date(KICKOFF.getTime() + HOUR).toISOString()],
      [2, field.Lions, field.Vikings, new Date(KICKOFF.getTime() + 2 * HOUR).toISOString()],
    ]);
  });

  it('moves a released week\'s kickoff for a game not yet started, and keeps its pairings and every started game\'s time', async () => {
    const { service, event, store, matchesNow, field, logger } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });
    await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });
    const [first] = await store.matchRepo().findBySportEvent(event.id);
    await store.matchRepo().update(first.id, { status: MatchStatus.IN_PROGRESS });

    const flexed = [game('g1', 'Bears', 'Lions', 5), game('g2', 'Packers', 'Vikings', 8), game('g9', 'Bears', 'Vikings', 9)];
    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: flexed }))
      .resolves.toEqual({ outcome: 'KICKOFFS_MOVED', sportEventId: event.id, matchNumbers: [2] });

    expect(await matchesNow()).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 8 * HOUR).toISOString()],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: event.id, unmatchedPairings: [`${field.Bears}@${field.Vikings}`] }),
      expect.any(String),
    );
  });

  it('reports a released week whose kickoffs all match as unchanged', async () => {
    const { service, event, store } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });
    await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK }))
      .resolves.toEqual({ outcome: 'UNCHANGED', sportEventId: event.id });
  });

  it('leaves the games unloaded, and says which teams, while a team is not in the field yet', async () => {
    const { service, event, logger, matchesNow } = setup();

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: [...WEEK, game('g5', 'Bears', 'Saints', 6)] }))
      .resolves.toEqual({ outcome: 'SKIPPED', reason: 'TEAMS_NOT_IN_FIELD' });

    expect(await matchesNow()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ missingTeams: ['team-Saints'] }), expect.any(String));
  });

  it.each([
    ['an event the provider has not linked', { externalId: 'nfl-2026-week-12' }, 'NO_EVENT'],
    ['an event of a league not synced', { synced: false }, 'NOT_SYNCED'],
    ['a completed event', { status: SportEventStatus.COMPLETED }, 'FINISHED'],
    ['a cancelled event', { status: SportEventStatus.CANCELLED }, 'FINISHED'],
  ] as const)('touches nothing for %s', async (_label, options, reason) => {
    const { service, event, matchesNow } = setup('status' in options || 'synced' in options ? options : {});
    const externalId = 'externalId' in options ? options.externalId : event.externalId;

    await expect(service.syncGames({ providerId: PROVIDER, externalId, games: WEEK })).resolves.toEqual({ outcome: 'SKIPPED', reason });
    expect(await matchesNow()).toEqual([]);
  });

  it('touches nothing for an event whose sport league plays no matches', async () => {
    const { service, event, store } = setup();
    await store.sportEventRepo().update(event.id, { sport: Sport.GOLF } as never);

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK }))
      .resolves.toEqual({ outcome: 'SKIPPED', reason: 'PLAYS_NO_GAMES' });
  });

  describe('after a field load', () => {
    it('does nothing for an event detail with no games, and syncs one with games', async () => {
      const { service, event } = setup();

      await expect(service.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId })).resolves.toBeNull();
      await expect(service.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, games: WEEK }))
        .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 2 });
    });

    it('logs a slate the bracket refuses instead of failing the field load, so the next load tries again', async () => {
      const { service, event, bracket, logger } = setup();
      jest.spyOn(bracket, 'loadBracket').mockRejectedValueOnce(new Error('bracket refused'));

      await expect(service.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, games: WEEK })).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: event.externalId, error: 'bracket refused' }),
        'Could not sync event games from provider',
      );
    });
  });
});
