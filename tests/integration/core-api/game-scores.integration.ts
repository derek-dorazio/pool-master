import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import { testDomainEvents } from '../../support/domain-events';
import { randomUUID } from 'node:crypto';
import { BackgroundJobType, ContestStatus, HomeAway, MatchSide, MatchStatus, ProviderGameState, SelectionType, Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import {
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { headToHeadScoringFamily } from '../../../packages/core-api/src/modules/scoring-families/head-to-head';
import { expectDefined } from '../../support/expect-defined';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { cleanupTestData, getAppPrisma, getPrisma, integrationBackgroundJobs, integrationSyncFindings, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import { recordStatements, statementCounts } from '../statement-log';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { NO_SETTLE_JOBS } from '../../support/event-settlement';
import { sportRowKeys } from '../../support/sport-rows';
import { eventRoundSlots, mapEventToProvider, fixtureSeasonId, type TestRoundSlot } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';
import { AWAY_SIDE, HOME_SIDE, homeAwayOf } from '../../support/match-sides';
import { contestOnEvents, contestTemplateId } from '../../support/contest-rows';

// A provider's game scores written into a linked bracket against real Postgres (#1496): the
// head-to-head family's GAME writer, through the admin's result path, with the teams' provider
// mappings deciding which side won. A provider game is the Game its id is mapped to (#2007). No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER = 'balldontlie';

/**
 * An in-progress four-team bracket on the provider, its two semifinals linked to games g1 and
 * g2: basketball's, or soccer's, whose level knockout games a shoot-out settles. Its sport league
 * is the NCAA men's, which plays single games, unless another is named (the NBA plays series).
 */
async function linkedBracket(sportOf: typeof Sport.BASKETBALL | typeof Sport.SOCCER = Sport.BASKETBALL, league?: string, seriesRounds?: readonly TestRoundSlot[], mapGames = true) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: sportOf },
    create: { sport: sportOf, ...sportRowKeys(sportOf) },
    update: {},
  });
  const leagueName = league ?? (sportOf === Sport.SOCCER ? 'FIFA World Cup' : 'NCAA Men\'s Basketball');
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: leagueName } },
    create: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: leagueName },
    update: {},
  });
  const events = new PrismaSportEventRepository(getAppPrisma());
  const externalId = `scope-${randomUUID()}`;
  const event = await createSportEventRow(events, {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2027),
    name: 'Final Four',
    startDate: new Date('2027-04-03T22:00:00.000Z'),
    status: 'IN_PROGRESS',
    autoLifecycleEnabled: false,
  });
  // Under the league's own provider league, so a seeded league (the NBA) gains no second mapping
  // that outlives the test.
  // The seeded NBA has its BALLDONTLIE mapping without a selection, so the league's own mapping
  // counts too; a second mapping would outlive the test and show in the seeded mapping checks.
  const selected = await prisma.sportLeagueProviderMapping.findFirst({
    where: { OR: [{ selectedBy: { is: { id: sportLeague.id } } }, { sportLeagueId: sportLeague.id }] },
    orderBy: { createdAt: 'asc' },
    select: { providerLeague: { select: { code: true } } },
  });
  await mapEventToProvider(prisma, event.id, { providerId: PROVIDER, externalId }, selected?.providerLeague.code ?? (sportOf === Sport.SOCCER ? 'worldcup' : 'ncaab'));
  const schedule = [
    { roundNumber: 1, scheduledDate: new Date('2027-04-03T22:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-04-05T01:00:00.000Z') },
  ];
  if (seriesRounds) {
    // Each round in a slot of its own, whose series length the round plays.
    const eventSlotIds = await eventRoundSlots(prisma, event.id, seriesRounds);
    const eventSlots = await prisma.sportEventSlot.findMany({ where: { id: { in: eventSlotIds } }, select: { id: true, sportLeagueSeasonCompetitionSlotId: true } });
    await new PrismaSportEventRoundRepository(getAppPrisma()).createMany(schedule.map((round, index) => ({
      sportEventId: event.id, ...round,
      seasonSlotId: expectDefined(eventSlots.find((eventSlot) => eventSlot.id === eventSlotIds[index]), 'round slot').sportLeagueSeasonCompetitionSlotId,
    })));
  } else {
    await createRoundRows(getPrisma(), new PrismaSportEventRoundRepository(getAppPrisma()), event, schedule);
  }
  const names = ['Duke', 'Houston', 'Auburn', 'Florida'];
  const teams = await Promise.all(names.map((name) => prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name, participantType: 'TEAM' } })));
  await prisma.participantProviderMapping.createMany({
    data: teams.map((team, index) => ({ participantId: team.id, sportLeagueId: sportLeague.id, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'TEAM', externalId: `${externalId}-team-${String(index + 1)}` })),
  });
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, teams.map((team, index) => ({ participantId: team.id, seedNumber: index + 1 })));
  const entries = await field.findBySportEvent(event.id);
  const entryOf = (name: string) => expectDefined(entries.find((entry) => entry.participantId === teams.find((team) => team.name === name)?.id), name);
  const teamId = (name: string) => `${externalId}-team-${String(names.indexOf(name) + 1)}`;

  const matches = new PrismaSportEventRoundMatchRepository(getAppPrisma());
  const finalId = randomUUID();
  await matches.replaceBracket(event.id, [
    // Each side's team as the sync writes it: Houston and Florida on side 1, Duke and Auburn on side 2.
    { id: randomUUID(), roundNumber: 1, matchNumber: 1, sides: neutralSides(entryOf('Houston').id, entryOf('Duke').id), isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSideNumber: HOME_SIDE, regionLabel: null },
    { id: randomUUID(), roundNumber: 1, matchNumber: 2, sides: neutralSides(entryOf('Florida').id, entryOf('Auburn').id), isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSideNumber: AWAY_SIDE, regionLabel: null },
    { id: finalId, roundNumber: 2, matchNumber: 3, sides: neutralSides(null, null), isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSideNumber: null, regionLabel: null },
  ]);
  // Mapped directly here; the sync maps games itself, which the auto-linking test covers.
  if (mapGames) {
    await mapGameOne(event.id, 1, 1, 'g1');
    await mapGameOne(event.id, 1, 2, 'g2');
  }
  return { event, externalId, entryOf, teamId, matches };
}

/** A neutral-site match's two sides, side 1's team first. */
function neutralSides(sideOne: string | null, sideTwo: string | null) {
  return [
    { sideNumber: 1, sportEventParticipantId: sideOne, homeAway: HomeAway.NONE },
    { sideNumber: 2, sportEventParticipantId: sideTwo, homeAway: HomeAway.NONE },
  ];
}

/** The event's matches read in home and away: side 2 the home side, side 1 the away side, as the sync places them. */
async function viewsOf(matches: PrismaSportEventRoundMatchRepository, sportEventId: string) {
  return (await matches.findBySportEvent(sportEventId)).map(homeAwayOf);
}

/** Maps the provider's game id to the Game 1 of the match at this place. */
async function mapGameOne(sportEventId: string, roundNumber: number, matchNumber: number, providerGameId: string) {
  const prisma = getPrisma();
  const [game, provider] = await Promise.all([
    prisma.sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventId, gameNumber: 1, match: { matchNumber, sportEventRound: { roundNumber } } }, select: { id: true } }),
    prisma.provider.findUniqueOrThrow({ where: { code: 'BALLDONTLIE' }, select: { id: true } }),
  ]);
  await prisma.sportEventRoundMatchGameProviderMapping.create({ data: { sportEventRoundMatchGameId: game.id, providerId: provider.id, externalId: providerGameId } });
}

/** Takes every provider id off the event's Games, as before any sync mapped them. */
function unmapGames(sportEventId: string) {
  return getPrisma().sportEventRoundMatchGameProviderMapping.deleteMany({ where: { game: { sportEventId } } });
}

/** The event's Games by round, match and game number, with each one's provider id and score. */
async function gamesOf(sportEventId: string) {
  const rows = await getPrisma().sportEventRoundMatchGame.findMany({
    where: { sportEventId },
    select: {
      id: true, gameNumber: true, status: true, movedToGameId: true,
      sideResults: { select: { score: true, side: { select: { sideNumber: true } } } },
      match: { select: { matchNumber: true, sportEventRound: { select: { roundNumber: true } } } },
      providerMappings: { select: { externalId: true } },
    },
  });
  const scoreOf = (row: (typeof rows)[number], sideNumber: number) => row.sideResults.find((result) => result.side.sideNumber === sideNumber)?.score ?? null;
  return rows
    .map((row) => {
      const [homeScore, awayScore] = [scoreOf(row, HOME_SIDE), scoreOf(row, AWAY_SIDE)];
      const decided = row.status === MatchStatus.COMPLETED && homeScore !== null && awayScore !== null && homeScore !== awayScore;
      return {
        id: row.id,
        place: [row.match.sportEventRound.roundNumber, row.match.matchNumber, row.gameNumber],
        providerGameId: row.providerMappings[0]?.externalId ?? null,
        status: row.status,
        // The side with more points in a final game: the home side is side 2.
        winnerSide: decided ? (homeScore > awayScore ? MatchSide.HOME : MatchSide.AWAY) : null,
        homeScore, awayScore, movedToGameId: row.movedToGameId,
      };
    })
    .sort((left, right) => left.place.join('.').localeCompare(right.place.join('.'), undefined, { numeric: true }));
}

/** An OPEN squares contest played on one of the event's games, in a league of its own. */
async function squaresContestOn(sportEventId: string, sportEventRoundMatchId: string): Promise<string> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `GSQ${suffix.toUpperCase()}`, name: `Game Squares ${suffix}`, iconKey: 'TROPHY' },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      ...(await contestOnEvents(prisma, [sportEventId])),
      squaresGame: { create: { sportEventRoundMatchId } },
      name: `Squares ${suffix}`,
      status: ContestStatus.OPEN,
      contestFormat: 'SQUARES',
      selectionType: SelectionType.SQUARES,
    },
  });
  await prisma.contestConfiguration.create({
    data: { contestId: contest.id, templateId: await contestTemplateId(prisma, contest.id), selectionType: SelectionType.SQUARES, configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 } },
  });
  return contest.id;
}

/**
 * Publishes a provider's games as the app does: through the app's handler map onto the job table,
 * and the app's event lifecycle, which queues a contest's "Contest is live" job as it goes live.
 */
function publish(externalEventId: string, games: GameScoreUpdate[]) {
  const { queue } = integrationBackgroundJobs();
  const domainEvents = testDomainEvents({ queue });
  return publishLiveScoreUpdate(
    { category: 'GAME', externalEventId, games },
    {
      prisma: getAppPrisma(),
      providerId: PROVIDER,
      domainEvents,
      contestActivation: createEventLifecycleService(getAppPrisma(), { domainEvents, ...NO_SETTLE_JOBS }),
      scoringFamilyForEvent: () => headToHeadScoringFamily,
      findings: integrationSyncFindings(),
    },
  );
}

describe('game scores from a provider', () => {
  it('completes each linked match the provider calls final and sends its winner on, and shows a live game\'s score, scoring the side each team plays', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();

    const result = await publish(externalId, [
      // Listed Houston at home, though the match has Duke at home.
      { providerGameId: 'g1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 67, awayScore: 70 },
      { providerGameId: 'g2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 38 },
    ]);

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 2, updatesSkipped: 0 });
    const [first, second, final] = await viewsOf(matches, event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 67 });
    // A live score decides nothing: no winner, no result source.
    expect(second).toMatchObject({ status: MatchStatus.IN_PROGRESS, winnerSide: null, homeScore: 40, awayScore: 38 });
    expect(final.homeSportEventParticipantId).toBe(entryOf('Duke').id);
  });

  it('puts a squares contest on a game the provider calls final live with its "Contest is live" job, and writes the job that settles it, as an admin\'s result does', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const [game] = await viewsOf(matches, event.id);
    const contestId = await squaresContestOn(event.id, expectDefined(game, 'g1').id);

    await publish(externalId, [
      { providerGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 },
    ]);

    expect(await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId }, select: { status: true } })).toEqual({ status: ContestStatus.ACTIVE });
    const jobs = await getPrisma().backgroundJob.findMany({ where: { type: { in: [BackgroundJobType.CONTEST_STARTED_EMAILS, BackgroundJobType.SETTLE_GAME_CONTESTS] } }, select: { type: true, payload: true } });
    expect(jobs).toEqual(expect.arrayContaining([
      { type: BackgroundJobType.CONTEST_STARTED_EMAILS, payload: expect.objectContaining({ contestId, sportEventId: event.id }) },
      { type: BackgroundJobType.SETTLE_GAME_CONTESTS, payload: expect.objectContaining({ sportEventId: event.id, sportEventRoundMatchId: expectDefined(game, 'g1').id }) },
    ]));
    expect(jobs).toHaveLength(2);
  });

  it('completes a match that was showing a live score once a later sync calls its game final, and sends the winner on as the provider\'s result', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();
    const game = { providerGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston') };
    await publish(externalId, [{ ...game, state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 44 }]);
    const live = (await viewsOf(matches, event.id)).at(0);

    const result = await publish(externalId, [{ ...game, state: ProviderGameState.FINAL, homeScore: 66, awayScore: 71 }]);

    expect(live).toMatchObject({ status: MatchStatus.IN_PROGRESS, homeScore: 40, awayScore: 44, winnerSide: null });
    expect(result).toMatchObject({ updatesPersisted: 1, updatesSkipped: 0 });
    const [first, , final] = await viewsOf(matches, event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, homeScore: 66, awayScore: 71, winnerSide: MatchSide.AWAY });
    expect(final.homeSportEventParticipantId).toBe(entryOf('Houston').id);
  });

  it('completes a soccer knockout match level after extra time as its shoot-out\'s winner, keeping the shoot-out apart, and writes nothing when it arrives again (#1532)', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket(Sport.SOCCER);
    // Listed Houston at home, though the match has Duke at home: Houston won the shoot-out 4-2.
    const final = { providerGameId: 'g1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 1, awayScore: 1, homeShootoutScore: 4, awayShootoutScore: 2 };

    const first = await publish(externalId, [final]);
    const again = await publish(externalId, [final]);

    expect(first).toMatchObject({ updatesPersisted: 1, updatesSkipped: 0 });
    expect(again).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    const [semifinal, , theFinal] = await viewsOf(matches, event.id);
    expect(semifinal).toMatchObject({
      status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4,
    });
    expect(theFinal.homeSportEventParticipantId).toBe(entryOf('Houston').id);
  });

  it('writes nothing when the same final arrives again', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const final = { providerGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 };
    await publish(externalId, [final]);
    const written = expectDefined((await matches.findBySportEvent(event.id)).at(0), 'match 1');

    const again = await publish(externalId, [final]);

    expect(again).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(again.writeDiagnostics.summary).toMatchObject({ total: 1, unchanged: 1 });
    // The match and its Games as they were, each Game unwritten since.
    expect((await matches.findBySportEvent(event.id)).at(0)).toEqual(written);
  });

  it('overwrites a result an admin wrote earlier with the provider\'s final: the feed is the only writer on a synced event', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const final = { providerGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 };
    await publish(externalId, [final]);
    const fromProvider = (await viewsOf(matches, event.id)).at(0);
    // A correction an admin wrote before results came only from the feed: Houston's (side 1's) score.
    await getPrisma().sportEventRoundMatchGameSideResult.updateMany({ where: { game: { sportEventId: event.id, gameNumber: 1, match: { matchNumber: 1 } }, side: { sideNumber: AWAY_SIDE } }, data: { score: 68 } });

    const again = await publish(externalId, [final]);

    expect(fromProvider).toMatchObject({ homeScore: 70, awayScore: 67 });
    expect(again).toMatchObject({ updatesPersisted: 1 });
    expect((await viewsOf(matches, event.id)).at(0)).toMatchObject({ homeScore: 70, awayScore: 67 });
  });

  it('links each game nobody linked to the match its teams play, records the final, and keeps the link for the next sync', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();
    await unmapGames(event.id);

    const result = await publish(externalId, [
      { providerGameId: 'p-1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 67, awayScore: 70 },
      { providerGameId: 'p-2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);

    expect(result).toMatchObject({ updatesPersisted: 1 });
    const [first, second, final] = await viewsOf(matches, event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 67 });
    expect(second).toMatchObject({ status: MatchStatus.SCHEDULED });
    expect(final).toMatchObject({ homeSportEventParticipantId: entryOf('Duke').id });
    // Each Game holds its provider id and its own score; the final's away side is still to be decided, so nothing maps to it yet.
    expect((await gamesOf(event.id)).map(({ place, providerGameId, status, homeScore, awayScore }) => ({ place, providerGameId, status, homeScore, awayScore }))).toEqual([
      { place: [1, 1, 1], providerGameId: 'p-1', status: MatchStatus.COMPLETED, homeScore: 70, awayScore: 67 },
      { place: [1, 2, 1], providerGameId: 'p-2', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
      { place: [2, 3, 1], providerGameId: null, status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
    ]);
  });

  it('links the final\'s Game 1, loaded with the bracket before its teams were known, to the provider\'s game once both semifinals send their winners into it, and records its result', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();
    await publish(externalId, [
      { providerGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 },
      { providerGameId: 'g2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.FINAL, homeScore: 60, awayScore: 66 },
    ]);

    await publish(externalId, [
      { providerGameId: 'f1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.FINAL, homeScore: 75, awayScore: 72 },
    ]);

    // The final's own Game 1, there since the bracket was loaded, now holds the provider's game.
    expect((await gamesOf(event.id)).find((game) => game.place.join('.') === '2.3.1')).toMatchObject({ providerGameId: 'f1', status: MatchStatus.COMPLETED, homeScore: 75, awayScore: 72 });
    const [, , final] = await viewsOf(matches, event.id);
    expect(final).toMatchObject({ homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: entryOf('Florida').id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME });
  });

  it('holds each NBA series game at its own Game with its own score, completes a series at four from its Games and sends its winner on, and shows a series still on as its wins so far (#1545)', async () => {
    // The NBA's conference finals and Finals slots are best of seven, as its reference data says.
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket(Sport.BASKETBALL, 'NBA', [{ slotKind: 'SEMIFINAL' }, { slotKind: 'FINAL' }]);
    await unmapGames(event.id);
    const final = (id: string, gameNumber: number, home: string, away: string, homeScore: number, awayScore: number): GameScoreUpdate =>
      ({ providerGameId: id, gameNumber, homeTeamExternalId: teamId(home), awayTeamExternalId: teamId(away), state: ProviderGameState.FINAL, homeScore, awayScore });
    const games: GameScoreUpdate[] = [
      final('a1', 1, 'Duke', 'Houston', 100, 90),
      final('a2', 2, 'Duke', 'Houston', 95, 99),
      final('a3', 3, 'Houston', 'Duke', 97, 101),
      final('a4', 4, 'Houston', 'Duke', 99, 104),
      final('a5', 5, 'Duke', 'Houston', 110, 102),
      final('b1', 1, 'Auburn', 'Florida', 88, 80),
      { providerGameId: 'b2', gameNumber: 2, homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 44 },
    ];

    const result = await publish(externalId, games);

    expect(result).toMatchObject({ updatesPersisted: 2 });
    const [first, second, nbaFinal] = await viewsOf(matches, event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 1 });
    expect(second).toMatchObject({ status: MatchStatus.IN_PROGRESS, winnerSide: null, homeScore: 1, awayScore: 0 });
    expect(nbaFinal).toMatchObject({ homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: null });
    // Not all at Game 1: each game is its own Game, scored from the match's sides.
    expect((await gamesOf(event.id)).map(({ place, providerGameId, status, winnerSide, homeScore, awayScore }) => [place.join('.'), providerGameId, status, winnerSide, homeScore, awayScore])).toEqual([
      ['1.1.1', 'a1', MatchStatus.COMPLETED, MatchSide.HOME, 100, 90],
      ['1.1.2', 'a2', MatchStatus.COMPLETED, MatchSide.AWAY, 95, 99],
      ['1.1.3', 'a3', MatchStatus.COMPLETED, MatchSide.HOME, 101, 97],
      ['1.1.4', 'a4', MatchStatus.COMPLETED, MatchSide.HOME, 104, 99],
      ['1.1.5', 'a5', MatchStatus.COMPLETED, MatchSide.HOME, 110, 102],
      ['1.2.1', 'b1', MatchStatus.COMPLETED, MatchSide.HOME, 88, 80],
      ['1.2.2', 'b2', MatchStatus.IN_PROGRESS, null, 40, 44],
      ['2.3.1', null, MatchStatus.SCHEDULED, null, null, null],
    ]);

    expect(await publish(externalId, games)).toMatchObject({ updatesPersisted: 0 });
  });

  it('counts a series\' games stored by earlier syncs, so a series is won by the sync that brings only its last game', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket(Sport.BASKETBALL, 'NBA', [{ slotKind: 'SEMIFINAL' }, { slotKind: 'FINAL' }]);
    await unmapGames(event.id);
    const win = (gameNumber: number): GameScoreUpdate => ({ providerGameId: `c${gameNumber}`, gameNumber, homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 90, awayScore: 80 });

    await publish(externalId, [win(1), win(2), win(3)]);
    const onThree = (await viewsOf(matches, event.id))[0];
    await publish(externalId, [win(4)]);

    expect(onThree).toMatchObject({ status: MatchStatus.IN_PROGRESS, homeScore: 3, awayScore: 0 });
    expect((await viewsOf(matches, event.id))[0]).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 0 });
  });

  it('moves a re-issued game id to the Game its teams and game number place it at, scores that Game, and raises a GAME_ID_REISSUED finding', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();

    await publish(externalId, [
      { providerGameId: 'g1-reissued', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 },
    ]);

    expect((await gamesOf(event.id))[0]).toMatchObject({ place: [1, 1, 1], providerGameId: 'g1-reissued', status: MatchStatus.COMPLETED, homeScore: 70, awayScore: 67 });
    expect((await viewsOf(matches, event.id))[0]).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME });
    expect(await getPrisma().providerSyncFinding.findMany({ where: { sportEventId: event.id }, select: { kind: true, severity: true, providerValue: true } }))
      .toEqual([{ kind: 'GAME_ID_REISSUED', severity: 'WARNING', providerValue: 'g1-reissued' }]);
  });

  it('marks a game the provider moved to another event moved, keeping the old Game, and moves its id to the Game it is played at now, with a GAME_MOVED finding', async () => {
    const week11 = await linkedBracket();
    const week12 = await linkedBracket(Sport.BASKETBALL, undefined, undefined, false);
    const [oldGame] = await gamesOf(week11.event.id);

    // The provider now lists g1 in week 12's games, between week 12's Duke and Houston.
    await publish(week12.externalId, [
      { providerGameId: 'g1', homeTeamExternalId: week12.teamId('Duke'), awayTeamExternalId: week12.teamId('Houston'), state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);

    const [newGame] = await gamesOf(week12.event.id);
    expect(newGame).toMatchObject({ place: [1, 1, 1], providerGameId: 'g1', movedToGameId: null });
    expect((await gamesOf(week11.event.id))[0]).toMatchObject({ id: expectDefined(oldGame, 'old Game').id, providerGameId: null, movedToGameId: expectDefined(newGame, 'new Game').id });
    expect(await getPrisma().providerSyncFinding.findMany({ where: { sportEventId: week12.event.id }, select: { kind: true, providerValue: true } }))
      .toEqual([{ kind: 'GAME_MOVED', providerValue: 'g1' }]);
  });

  it('refuses a second Game mapped to a provider game id another Game already holds', async () => {
    const { event } = await linkedBracket();

    await expect(mapGameOne(event.id, 2, 3, 'g1')).rejects.toThrow();
  });

  it('marks a match postponed, its live score taken off, when the provider postpones its game, and writes a batch of live scores in one statement each', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const live = (gameId: string, home: string, away: string, homeScore: number, awayScore: number) => ({
      providerGameId: gameId, homeTeamExternalId: teamId(home), awayTeamExternalId: teamId(away), state: ProviderGameState.IN_PROGRESS, homeScore, awayScore,
    });

    const { statements } = await recordStatements(() => publish(externalId, [live('g1', 'Duke', 'Houston', 20, 18), live('g2', 'Auburn', 'Florida', 11, 9)]));
    await publish(externalId, [{ ...live('g1', 'Duke', 'Houston', 0, 0), state: ProviderGameState.POSTPONED, homeScore: null, awayScore: null }]);

    // Pinned: the event's own reads, then one read of the matches, one of the sides, one of the
    // team mappings, and one update per live game and per side's score, with no result path and no rebuild.
    expect(statementCounts(statements)).toEqual([
      // The batch's shoot-outs taken off its side results (#2046), in one statement.
      ['DELETE sport_event_round_match_game_side_result_period_scores', 1],
      ['SELECT participant_provider_mappings', 1],
      // The mappings' Provider rows, for their names (#2040): one read for the batch.
      ['SELECT providers', 1],
      ['SELECT sport_event_participants', 1],
      // The event's provider ids and its Season, the event's path to its league (#2004).
      ['SELECT sport_event_provider_mappings', 1],
      // The event's Games with their provider ids (#2007), read once for the batch.
      ['SELECT sport_event_round_match_game_provider_mappings', 1],
      // Each Game's side results with their periods (#2046): the matches' and the Games' reads,
      // and the batch's write reading its side results once.
      ['SELECT sport_event_round_match_game_side_result_period_scores', 2],
      ['SELECT sport_event_round_match_game_side_results', 3],
      ['SELECT sport_event_round_match_games', 2],
      ['SELECT sport_event_round_match_sides', 4],
      ['SELECT sport_event_round_matches', 1],
      ['SELECT sport_event_rounds', 1],
      // The rounds' slots (#2006): each round reads its slot's definition and Season slot.
      ['SELECT sport_event_slots', 1],
      ['SELECT sport_events', 1],
      ['SELECT sport_league_competition_slots', 1],
      ['SELECT sport_league_season_competition_slots', 1],
      ['SELECT sport_league_seasons', 1],
      ['SELECT sport_leagues', 1],
      // The event's sport, read through its league (#2042), to pick its scoring family's writer.
      ['SELECT sports', 1],
      // Each side's own score in its Game (#2046), one row each.
      ['UPDATE sport_event_round_match_game_side_results', 4],
      // Each game's own status on its Game (#2007), one row each, as for its match.
      ['UPDATE sport_event_round_match_games', 2],
      ['UPDATE sport_event_round_matches', 2],
    ]);
    const [first, second] = await viewsOf(matches, event.id);
    expect(first).toMatchObject({ status: MatchStatus.POSTPONED, homeScore: null, awayScore: null });
    expect(second).toMatchObject({ status: MatchStatus.IN_PROGRESS, homeScore: 11, awayScore: 9 });
  });

  it('reads the event\'s matches, sides and team mappings once for a batch of finals, and pays only the result path for each', async () => {
    const { externalId, teamId } = await linkedBracket();

    const { statements } = await recordStatements(() => publish(externalId, [
      { providerGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 },
      { providerGameId: 'g2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.FINAL, homeScore: 80, awayScore: 70 },
    ]));

    // Pinned: a new statement here is a new cost on every sync of a live bracket. Each final writes
    // its follow-up jobs (the game's settling, the boards' rebuild) in one insert with its result.
    expect(statementCounts(statements)).toEqual([
      ['DELETE sport_event_participant_standings', 1],
      // Each final's Game 1 shoot-out taken off (#2046): one statement per result.
      ['DELETE sport_event_round_match_game_side_result_period_scores', 2],
      ['INSERT background_jobs', 2],
      ['INSERT sport_event_participant_standings', 2],
      ['SELECT contests', 2],
      ['SELECT participant_provider_mappings', 1],
      // The mappings' Provider rows, for their names (#2040), in one read for the batch; and each
      // read of the event names its provider ids' providers (#2004), one more each.
      ['SELECT providers', 3],
      ['SELECT sport_event_participant_standings', 2],
      ['SELECT sport_event_participants', 1],
      ['SELECT sport_event_provider_mappings', 3],
      // The event's Games with their provider ids (#2007), read once for the batch.
      ['SELECT sport_event_round_match_game_provider_mappings', 1],
      // Each read of the matches reads their sides and their Games' side results (#2046), and each
      // result's write reads its Game 1's side results once.
      ['SELECT sport_event_round_match_game_side_result_period_scores', 4],
      ['SELECT sport_event_round_match_game_side_results', 6],
      ['SELECT sport_event_round_match_games', 4],
      ['SELECT sport_event_round_match_sides', 9],
      ['SELECT sport_event_round_matches', 3],
      ['SELECT sport_event_rounds', 3],
      // Each full read of the event names its slot definitions (#2010), where templates are offered,
      // and each read of the rounds reads their slots (#2006): a fixed cost per read, not per round.
      ['SELECT sport_event_slots', 5],
      ['SELECT sport_events', 3],
      ['SELECT sport_league_competition_slots', 5],
      ['SELECT sport_league_competitions', 2],
      ['SELECT sport_league_phases', 2],
      ['SELECT sport_league_season_competition_slots', 5],
      ['SELECT sport_league_seasons', 3],
      ['SELECT sport_leagues', 3],
      ['SELECT sports', 3],
      // Each final's two side scores on its Game 1 (#2046), and the Game's status, one row each.
      ['UPDATE sport_event_round_match_game_side_results', 4],
      ['UPDATE sport_event_round_match_games', 2],
      // Each final's two side outcomes, and the side of the final its winner fills.
      ['UPDATE sport_event_round_match_sides', 6],
      ['UPDATE sport_event_round_matches', 2],
    ]);
  });
});
