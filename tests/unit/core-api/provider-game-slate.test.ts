import { expect, jest } from '@jest/globals';
import type { ContestRepository } from '@poolmaster/shared/db';
import { BracketAdvancement, MatchSide, MatchStatus, Sport, SportEventStatus, SportEventSyncScope, type SportEventStatus as Status } from '@poolmaster/shared/domain';
import { ProviderGameSlateService } from '../../../packages/core-api/src/modules/events/provider-game-slate';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import type { ProviderBracketMatch, ProviderScheduledGame } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
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
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
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

  it('moves only the kickoff on a draft whose pairings are unchanged, keeping every match and the admin\'s spreads', async () => {
    const { service, event, store, matchesNow, field } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });
    store.matchRows = store.matchRows.map((match) => ({ ...match, homeSpread: match.matchNumber === 1 ? -3.5 : 6.5 }));
    const idsBefore = store.matchRows.map((match) => match.id);

    // The Packers game's kickoff firms up an hour earlier, so it now sorts first.
    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: [game('g1', 'Bears', 'Lions', 0), game('g2', 'Packers', 'Vikings', -1)] }))
      .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [2] });

    expect(store.matchRows.map((match) => match.id)).toEqual(idsBefore);
    expect(store.matchRows.map((match) => match.homeSpread)).toEqual([-3.5, 6.5]);
    expect(await matchesNow()).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() - HOUR).toISOString()],
    ]);
  });

  it('swaps a draft match\'s sides when the provider swaps home and away, turning the admin\'s spread around with them', async () => {
    const { service, event, store, matchesNow, field } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });
    store.matchRows = store.matchRows.map((match) => ({ ...match, homeSpread: match.matchNumber === 1 ? -3.5 : null }));

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: [game('g1', 'Lions', 'Bears', 0), WEEK[0]] }))
      .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [1] });

    expect(await matchesNow()).toEqual([
      [1, field.Lions, field.Bears, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 3 * HOUR).toISOString()],
    ]);
    expect(store.matchRows.map((match) => match.homeSpread)).toEqual([3.5, null]);
  });

  it('keeps a released match\'s sides when the provider swaps home and away, moving its kickoff and logging the swap for an admin', async () => {
    const { service, event, store, matchesNow, field, logger } = setup();
    await service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: WEEK });
    await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });

    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: [game('g1', 'Lions', 'Bears', 1), WEEK[0]] }))
      .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [1] });

    expect((await matchesNow())[0]).toEqual([1, field.Bears, field.Lions, new Date(KICKOFF.getTime() + HOUR).toISOString()]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ sportEventId: event.id, swappedMatchNumbers: [1] }), expect.any(String));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.objectContaining({ unmatchedPairings: expect.anything() }), expect.any(String));
  });

  it('replaces a draft\'s games, an admin\'s included, when the provider\'s pairings change', async () => {
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
    // The week's first game kicked off.
    store.matchRows = store.matchRows.map((match) => (match.matchNumber === 1 ? { ...match, status: MatchStatus.IN_PROGRESS } : match));

    const flexed = [game('g1', 'Bears', 'Lions', 5), game('g2', 'Packers', 'Vikings', 8), game('g9', 'Bears', 'Vikings', 9)];
    await expect(service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games: flexed }))
      .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [2] });

    expect(await matchesNow()).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 8 * HOUR).toISOString()],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: event.id, unmatchedPairings: [[field.Bears, field.Vikings].sort().join('|')] }),
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

  describe('a fixed-shape playoff', () => {
    // One conference of an NFL-style postseason: seeds 2 to 7 play the Wild Card, the 1 seed waits
    // in the reseeded Divisional round, whose two winners meet in the final.
    const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
    const roundDefault = (roundNumber: number) => new Date(KICKOFF.getTime() - 2 * HOUR + (roundNumber - 1) * 24 * HOUR);
    const team = (seed: number) => `seed-${seed}`;

    function playoffSetup({ status = SportEventStatus.DRAFT }: { status?: Status } = {}) {
      const store = new InMemorySportEvents();
      const sport = store.addSport(Sport.AMERICAN_FOOTBALL);
      const league = store.addSportLeague(sport.id, 'NFL');
      store.sportLeagues = store.sportLeagues.map((row) => (row.id === league.id ? { ...row, bracketAdvancement: BracketAdvancement.RESEED_BY_SEED } : row));
      const event = store.addEvent({
        sportLeagueId: league.id,
        sport: Sport.AMERICAN_FOOTBALL,
        status,
        rounds: 3,
        providerId: PROVIDER,
        externalId: 'nfl-2026-postseason',
        syncScope: SportEventSyncScope.SCORES_ONLY,
        eventSyncProviderId: PROVIDER,
      });
      // A day apart from two hours before the first kickoff, as a provider event's rounds are made.
      void store.addRounds(event.id, [1, 2, 3].map((roundNumber) => ({ roundNumber, scheduledDate: roundDefault(roundNumber) })));
      const field = new Map(SEEDS.map((seed) => {
        const participant = store.addParticipant(sport.id, `Seed ${seed}`, { participantType: 'TEAM' });
        void store.mappingRepo().bind({ participantId: participant.id, providerId: PROVIDER, externalId: team(seed), confidence: 'EXACT', mappedAt: KICKOFF });
        return [seed, store.addToField(event.id, participant.id, { seedNumber: seed }).id] as const;
      }));
      const rowOf = (seed: number) => field.get(seed) ?? '';
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
        rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
        logger,
      });
      const sync = (games: readonly ProviderScheduledGame[], shape: readonly ProviderBracketMatch[] = BRACKET) =>
        service.syncGames({ providerId: PROVIDER, externalId: event.externalId, games, bracket: shape });
      const sides = () => store.matchRows
        .slice()
        .sort((left, right) => left.matchNumber - right.matchNumber)
        .map((match) => [match.matchNumber, match.homeSportEventParticipantId, match.awaySportEventParticipantId]);
      /** Round 1 played: the 2 and 4 seeds win at home, the 6 seed wins away. */
      const playWildCard = () => {
        const winners = new Map([[1, MatchSide.HOME], [2, MatchSide.AWAY], [3, MatchSide.HOME]]);
        store.matchRows = store.matchRows.map((match) => {
          const winnerSide = winners.get(match.matchNumber);
          return winnerSide === undefined ? match : { ...match, status: MatchStatus.COMPLETED, winnerSide, homeScore: 20, awayScore: 17 };
        });
      };
      const roundDates = async () => (await store.roundRepo().findBySportEvent(event.id))
        .map((round) => [round.roundNumber, round.scheduledDate.toISOString()]);
      return { store, event, rowOf, bracket, service, logger, sync, sides, playWildCard, roundDates };
    }

    const slot = (matchNumber: number, roundNumber: number, home: number | null, away: number | null, fill: Partial<ProviderBracketMatch> = {}): ProviderBracketMatch => ({
      matchNumber,
      roundNumber,
      homeTeamExternalId: home === null ? null : team(home),
      awayTeamExternalId: away === null ? null : team(away),
      isNeutralSite: false,
      scheduledAt: null,
      advancesTo: null,
      regionLabel: 'AFC',
      ...fill,
    });
    const BRACKET = [
      slot(1, 1, 2, 7, { scheduledAt: KICKOFF }),
      slot(2, 1, 3, 6, { scheduledAt: KICKOFF }),
      slot(3, 1, 4, 5, { scheduledAt: KICKOFF }),
      slot(4, 2, 1, null),
      slot(5, 2, null, null),
      slot(6, 3, null, null, { regionLabel: null, isNeutralSite: true }),
    ].map((match) => (match.matchNumber === 4 ? { ...match, advancesTo: { matchNumber: 6, side: MatchSide.HOME } } : match.matchNumber === 5 ? { ...match, advancesTo: { matchNumber: 6, side: MatchSide.AWAY } } : match));
    const playoffGame = (id: string, roundNumber: number, home: number, away: number, hoursAfterKickoff = 0): ProviderScheduledGame => ({
      externalGameId: id,
      roundNumber,
      homeTeamExternalId: team(home),
      awayTeamExternalId: team(away),
      scheduledAt: new Date(KICKOFF.getTime() + hoursAfterKickoff * HOUR),
      isNeutralSite: false,
    });
    const WILD_CARD = [playoffGame('w1', 1, 2, 7), playoffGame('w2', 1, 3, 6), playoffGame('w3', 1, 4, 5)];

    it('loads a synced draft playoff\'s whole bracket, first round to final, with its regions and links', async () => {
      const { sync, sides, rowOf, store, event } = playoffSetup();

      await expect(sync(WILD_CARD)).resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 6 });

      expect(sides()).toEqual([
        [1, rowOf(2), rowOf(7)], [2, rowOf(3), rowOf(6)], [3, rowOf(4), rowOf(5)],
        [4, rowOf(1), null], [5, null, null], [6, null, null],
      ]);
      const byNumber = new Map(store.matchRows.map((match) => [match.matchNumber, match]));
      expect(byNumber.get(4)?.advancesToMatchId).toBe(byNumber.get(6)?.id);
      expect(byNumber.get(5)?.advancesToSide).toBe(MatchSide.AWAY);
      expect(byNumber.get(6)).toMatchObject({ isNeutralSite: true, regionLabel: null });
      expect(byNumber.get(1)).toMatchObject({ regionLabel: 'AFC', advancesToMatchId: null });
    });

    it('dates each round of a loaded playoff by its earliest kickoff, and leaves a round with no kickoff yet where it is', async () => {
      const { sync, roundDates } = playoffSetup();

      await sync([playoffGame('w1', 1, 2, 7, 3), playoffGame('w2', 1, 3, 6, 1), playoffGame('w3', 1, 4, 5, 5)], BRACKET.map((match) => (match.roundNumber === 1 ? { ...match, scheduledAt: new Date(KICKOFF.getTime() + match.matchNumber * HOUR) } : match)));

      expect(await roundDates()).toEqual([
        [1, new Date(KICKOFF.getTime() + HOUR).toISOString()],
        [2, roundDefault(2).toISOString()],
        [3, roundDefault(3).toISOString()],
      ]);
    });

    it('keeps a draft bracket of the provider\'s shape and only moves a Wild Card kickoff the provider moved', async () => {
      const { sync, store, event } = playoffSetup();
      await sync(WILD_CARD);
      const idsBefore = store.matchRows.map((match) => match.id);

      await expect(sync([playoffGame('w1', 1, 2, 7, 2), WILD_CARD[1], WILD_CARD[2]] as ProviderScheduledGame[]))
        .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [1] });
      expect(store.matchRows.map((match) => match.id)).toEqual(idsBefore);
    });

    it('reloads a draft bracket when the provider\'s seeds change who plays whom', async () => {
      const { sync, sides, rowOf, event } = playoffSetup();
      await sync(WILD_CARD);
      const reseeded = BRACKET.map((match) => (match.matchNumber === 2 ? slot(2, 1, 3, 5, { scheduledAt: KICKOFF }) : match.matchNumber === 3 ? slot(3, 1, 4, 6, { scheduledAt: KICKOFF }) : match));

      await expect(sync([], reseeded)).resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 6 });
      expect(sides().slice(1, 3)).toEqual([[2, rowOf(3), rowOf(5)], [3, rowOf(4), rowOf(6)]]);
    });

    it('places a released playoff\'s reseeded round from the provider\'s games once the round before is played, taking their kickoffs', async () => {
      const { sync, sides, rowOf, store, event, playWildCard, roundDates } = playoffSetup();
      await sync(WILD_CARD);
      await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });
      playWildCard();

      // The 1 seed hosts the worst seed left (the 6), and the 2 hosts the 4.
      const divisional = [playoffGame('d1', 2, 1, 6, 168), playoffGame('d2', 2, 2, 4, 170)];
      await expect(sync([...WILD_CARD, ...divisional]))
        .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [4, 5] });

      expect(sides().slice(3, 5)).toEqual([[4, rowOf(1), rowOf(6)], [5, rowOf(2), rowOf(4)]]);
      const kickoffs = store.matchRows
        .filter((match) => match.roundNumber === 2)
        .sort((left, right) => left.matchNumber - right.matchNumber)
        .map((match) => [match.matchNumber, match.scheduledDate?.toISOString()]);
      expect(kickoffs).toEqual([[4, new Date(KICKOFF.getTime() + 168 * HOUR).toISOString()], [5, new Date(KICKOFF.getTime() + 170 * HOUR).toISOString()]]);
      expect((await roundDates())[1]).toEqual([2, new Date(KICKOFF.getTime() + 168 * HOUR).toISOString()]);
    });

    it('leaves a released reseeded round unplaced, and tells an admin, when the provider pairs its teams differently from the reseed', async () => {
      const { sync, sides, store, event, playWildCard, logger } = playoffSetup();
      await sync(WILD_CARD);
      await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });
      playWildCard();

      await expect(sync([...WILD_CARD, playoffGame('d1', 2, 1, 4, 168), playoffGame('d2', 2, 2, 6, 170)]))
        .resolves.toEqual({ outcome: 'UNCHANGED', sportEventId: event.id });

      expect(sides().slice(3, 5)).toEqual([[4, expect.any(String), null], [5, null, null]]);
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ sportEventId: event.id, roundNumber: 2 }), expect.stringContaining('pairs the teams differently'));
    });

    it('waits to place a reseeded round until every game of the round before has its result', async () => {
      const { sync, sides, store, event, bracket } = playoffSetup();
      await sync(WILD_CARD);
      await store.sportEventRepo().update(event.id, { status: SportEventStatus.SCHEDULED });
      const propose = jest.spyOn(bracket, 'proposeRoundMatchups');

      await expect(sync([...WILD_CARD, playoffGame('d1', 2, 1, 6, 168), playoffGame('d2', 2, 2, 4, 170)]))
        .resolves.toEqual({ outcome: 'UNCHANGED', sportEventId: event.id });
      expect(propose).not.toHaveBeenCalled();
      expect(sides()[4]).toEqual([5, null, null]);
    });

    it('leaves the bracket unloaded while a team the bracket names is not in the field yet', async () => {
      const { sync, sides } = playoffSetup();

      await expect(sync([], BRACKET.map((match) => (match.matchNumber === 4 ? slot(4, 2, 8, null) : match))))
        .resolves.toEqual({ outcome: 'SKIPPED', reason: 'TEAMS_NOT_IN_FIELD' });
      expect(sides()).toEqual([]);
    });

    it('syncs an event detail that carries a bracket but no games after a field load', async () => {
      const { service, event } = playoffSetup();

      await expect(service.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, bracket: BRACKET }))
        .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 6 });
    });
  });
});
