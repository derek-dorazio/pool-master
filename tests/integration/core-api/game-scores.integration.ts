import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { MatchResultSource, MatchSide, MatchStatus, ProviderGameState, Sport } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import {
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { headToHeadScoringFamily } from '../../../packages/core-api/src/modules/scoring-families/head-to-head';
import { expectDefined } from '../../support/expect-defined';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts } from '../statement-log';

// A provider's game scores written into a linked bracket against real Postgres (#1496): the
// head-to-head family's GAME writer, through the admin's result path, with the teams' provider
// mappings deciding which side won. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER = 'balldontlie';

/**
 * An in-progress four-team bracket on the provider, its two semifinals linked to games g1 and
 * g2: basketball's, or soccer's, whose level knockout games a shoot-out settles.
 */
async function linkedBracket(sportOf: typeof Sport.BASKETBALL | typeof Sport.SOCCER = Sport.BASKETBALL) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: sportOf },
    create: { sport: sportOf, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const leagueName = sportOf === Sport.SOCCER ? 'FIFA World Cup' : 'NCAA Division I Men';
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: leagueName } },
    create: { sportId: sport.id, name: leagueName },
    update: {},
  });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Bracket ${randomUUID()}` } });
  const events = new PrismaSportEventRepository(getAppPrisma());
  const externalId = `scope-${randomUUID()}`;
  const event = await createSportEventRow(events, {
    eventSeriesId: eventSeries.id,
    eventYear: 2027,
    externalId,
    providerId: PROVIDER,
    sport: sportOf,
    name: 'Final Four',
    startDate: new Date('2027-04-03T22:00:00.000Z'),
    status: 'IN_PROGRESS',
    rounds: 2,
    syncScope: 'SCORES_ONLY',
    autoLifecycleEnabled: false,
  });
  await createRoundRows(new PrismaSportEventRoundRepository(getAppPrisma()), event.id, [
    { roundNumber: 1, scheduledDate: new Date('2027-04-03T22:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-04-05T01:00:00.000Z') },
  ]);
  const names = ['Duke', 'Houston', 'Auburn', 'Florida'];
  const teams = await Promise.all(names.map((name) => prisma.participant.create({ data: { sportId: sport.id, name, participantType: 'TEAM' } })));
  await prisma.participantProviderMapping.createMany({
    data: teams.map((team, index) => ({ participantId: team.id, providerId: PROVIDER, externalId: `${externalId}-team-${String(index + 1)}` })),
  });
  const field = new PrismaSportEventParticipantRepository(getAppPrisma());
  await field.createMany(event.id, teams.map((team, index) => ({ participantId: team.id, seedNumber: index + 1 })));
  const entries = await field.findBySportEvent(event.id);
  const entryOf = (name: string) => expectDefined(entries.find((entry) => entry.participantId === teams.find((team) => team.name === name)?.id), name);
  const teamId = (name: string) => `${externalId}-team-${String(names.indexOf(name) + 1)}`;

  const matches = new PrismaSportEventMatchRepository(getAppPrisma());
  const finalId = randomUUID();
  await matches.replaceBracket(event.id, [
    { id: randomUUID(), roundNumber: 1, matchNumber: 1, homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: entryOf('Houston').id, isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSide: MatchSide.HOME, regionLabel: null },
    { id: randomUUID(), roundNumber: 1, matchNumber: 2, homeSportEventParticipantId: entryOf('Auburn').id, awaySportEventParticipantId: entryOf('Florida').id, isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSide: MatchSide.AWAY, regionLabel: null },
    { id: finalId, roundNumber: 2, matchNumber: 3, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSide: null, regionLabel: null },
  ]);
  // Linked directly here; the sync links games itself, which the auto-linking test covers.
  await prisma.sportEventMatch.updateMany({ where: { sportEventId: event.id, matchNumber: 1 }, data: { externalGameId: 'g1' } });
  await prisma.sportEventMatch.updateMany({ where: { sportEventId: event.id, matchNumber: 2 }, data: { externalGameId: 'g2' } });
  return { event, externalId, entryOf, teamId, matches };
}

function publish(externalEventId: string, games: GameScoreUpdate[]) {
  return publishLiveScoreUpdate(
    { category: 'GAME', externalEventId, games },
    { prisma: getAppPrisma(), providerId: PROVIDER, scoringFamilyForEvent: () => headToHeadScoringFamily },
  );
}

describe('game scores from a provider', () => {
  it('completes each linked match the provider calls final and sends its winner on, and shows a live game\'s score, scoring the side each team plays', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();

    const result = await publish(externalId, [
      // Listed Houston at home, though the match has Duke at home.
      { externalGameId: 'g1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 67, awayScore: 70 },
      { externalGameId: 'g2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 38 },
    ]);

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 2, updatesSkipped: 0 });
    const [first, second, final] = await matches.findBySportEvent(event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 67 });
    // A live score decides nothing: no winner, no result source.
    expect(second).toMatchObject({ status: MatchStatus.IN_PROGRESS, winnerSide: null, homeScore: 40, awayScore: 38, resultSource: null });
    expect(final.homeSportEventParticipantId).toBe(entryOf('Duke').id);
  });

  it('completes a match that was showing a live score once a later sync calls its game final, and sends the winner on as the provider\'s result', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();
    const game = { externalGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston') };
    await publish(externalId, [{ ...game, state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 44 }]);
    const live = (await matches.findBySportEvent(event.id)).at(0);

    const result = await publish(externalId, [{ ...game, state: ProviderGameState.FINAL, homeScore: 66, awayScore: 71 }]);

    expect(live).toMatchObject({ status: MatchStatus.IN_PROGRESS, homeScore: 40, awayScore: 44, winnerSide: null });
    expect(result).toMatchObject({ updatesPersisted: 1, updatesSkipped: 0 });
    const [first, , final] = await matches.findBySportEvent(event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, homeScore: 66, awayScore: 71, winnerSide: MatchSide.AWAY, resultSource: MatchResultSource.PROVIDER });
    expect(final.homeSportEventParticipantId).toBe(entryOf('Houston').id);
  });

  it('completes a soccer knockout match level after extra time as its shoot-out\'s winner, keeping the shoot-out apart, and writes nothing when it arrives again (#1532)', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket(Sport.SOCCER);
    // Listed Houston at home, though the match has Duke at home: Houston won the shoot-out 4-2.
    const final = { externalGameId: 'g1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 1, awayScore: 1, homeShootoutScore: 4, awayShootoutScore: 2 };

    const first = await publish(externalId, [final]);
    const again = await publish(externalId, [final]);

    expect(first).toMatchObject({ updatesPersisted: 1, updatesSkipped: 0 });
    expect(again).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    const [semifinal, , theFinal] = await matches.findBySportEvent(event.id);
    expect(semifinal).toMatchObject({
      status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4, resultSource: MatchResultSource.PROVIDER,
    });
    expect(theFinal.homeSportEventParticipantId).toBe(entryOf('Houston').id);
  });

  it('writes nothing when the same final arrives again', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const final = { externalGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 };
    await publish(externalId, [final]);
    const written = expectDefined((await matches.findBySportEvent(event.id)).at(0), 'match 1');

    const again = await publish(externalId, [final]);

    expect(again).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(again.writeDiagnostics.summary).toMatchObject({ total: 1, unchanged: 1 });
    expect((await matches.findBySportEvent(event.id)).at(0)?.updatedAt).toEqual(written.updatedAt);
  });

  it('marks a result the provider wrote as the provider\'s, and leaves alone one an admin has since corrected (#1531)', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const final = { externalGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 };
    await publish(externalId, [final]);
    const fromProvider = (await matches.findBySportEvent(event.id)).at(0);
    // The admin's correction, as the admin's result route writes it.
    await getPrisma().sportEventMatch.updateMany({ where: { sportEventId: event.id, matchNumber: 1 }, data: { awayScore: 68, resultSource: MatchResultSource.ADMIN } });

    const again = await publish(externalId, [final]);

    expect(fromProvider).toMatchObject({ homeScore: 70, awayScore: 67, resultSource: MatchResultSource.PROVIDER });
    expect(again).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect((await matches.findBySportEvent(event.id)).at(0)).toMatchObject({ homeScore: 70, awayScore: 68, resultSource: MatchResultSource.ADMIN });
  });

  it('links each game nobody linked to the match its teams play, records the final, and keeps the link for the next sync', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();
    await getPrisma().sportEventMatch.updateMany({ where: { sportEventId: event.id }, data: { externalGameId: null } });

    const result = await publish(externalId, [
      { externalGameId: 'p-1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 67, awayScore: 70 },
      { externalGameId: 'p-2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);

    expect(result).toMatchObject({ updatesPersisted: 1 });
    const [first, second, final] = await matches.findBySportEvent(event.id);
    expect(first).toMatchObject({ externalGameId: 'p-1', status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 67 });
    expect(second).toMatchObject({ externalGameId: 'p-2', status: MatchStatus.SCHEDULED });
    // The final's away side is still to be decided, so nothing links to it yet.
    expect(final).toMatchObject({ externalGameId: null, homeSportEventParticipantId: entryOf('Duke').id });
  });

  it('refuses a second match of the event linked to a game another of its matches already takes', async () => {
    const { event } = await linkedBracket();

    await expect(getPrisma().sportEventMatch.updateMany({ where: { sportEventId: event.id, matchNumber: 3 }, data: { externalGameId: 'g1' } }))
      .rejects.toThrow();
  });

  it('takes a live score back off a match whose game the provider postpones, and writes a batch of live scores in one statement each', async () => {
    const { event, externalId, teamId, matches } = await linkedBracket();
    const live = (gameId: string, home: string, away: string, homeScore: number, awayScore: number) => ({
      externalGameId: gameId, homeTeamExternalId: teamId(home), awayTeamExternalId: teamId(away), state: ProviderGameState.IN_PROGRESS, homeScore, awayScore,
    });

    const { statements } = await recordStatements(() => publish(externalId, [live('g1', 'Duke', 'Houston', 20, 18), live('g2', 'Auburn', 'Florida', 11, 9)]));
    await publish(externalId, [{ ...live('g1', 'Duke', 'Houston', 0, 0), state: ProviderGameState.POSTPONED, homeScore: null, awayScore: null }]);

    // Pinned: the event's own reads, then one read of the matches, one of the sides, one of the
    // team mappings, and one update per live game, with no result path and no rebuild.
    expect(statementCounts(statements)).toEqual([
      ['SELECT event_series', 1],
      ['SELECT participant_provider_mappings', 1],
      ['SELECT sport_event_match_period_scores', 1],
      ['SELECT sport_event_matches', 1],
      ['SELECT sport_event_participants', 1],
      ['SELECT sport_event_rounds', 1],
      ['SELECT sport_events', 1],
      ['SELECT sport_leagues', 1],
      ['UPDATE sport_event_matches', 2],
    ]);
    const [first, second] = await matches.findBySportEvent(event.id);
    expect(first).toMatchObject({ status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null });
    expect(second).toMatchObject({ status: MatchStatus.IN_PROGRESS, homeScore: 11, awayScore: 9 });
  });

  it('reads the event\'s matches, sides and team mappings once for a batch of finals, and pays only the result path for each', async () => {
    const { externalId, teamId } = await linkedBracket();

    const { statements } = await recordStatements(() => publish(externalId, [
      { externalGameId: 'g1', homeTeamExternalId: teamId('Duke'), awayTeamExternalId: teamId('Houston'), state: ProviderGameState.FINAL, homeScore: 70, awayScore: 67 },
      { externalGameId: 'g2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.FINAL, homeScore: 80, awayScore: 70 },
    ]));

    // Pinned: a new statement here is a new cost on every sync of a live bracket.
    expect(statementCounts(statements)).toEqual([
      ['DELETE sport_event_participant_standings', 1],
      ['INSERT sport_event_participant_standings', 2],
      ['SELECT contests', 2],
      ['SELECT event_series', 3],
      ['SELECT participant_provider_mappings', 1],
      ['SELECT sport_event_match_period_scores', 3],
      ['SELECT sport_event_matches', 3],
      ['SELECT sport_event_participant_golf_standings', 1],
      ['SELECT sport_event_participant_standings', 2],
      ['SELECT sport_event_participants', 1],
      ['SELECT sport_event_rounds', 3],
      ['SELECT sport_events', 3],
      ['SELECT sport_leagues', 3],
      ['UPDATE sport_event_matches', 4],
    ]);
  });
});
