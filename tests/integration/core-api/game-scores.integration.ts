import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { MatchSide, MatchStatus, ProviderGameState, Sport } from '@poolmaster/shared/domain';
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

/** An in-progress four-team bracket on the provider, its two semifinals linked to games g1 and g2. */
async function linkedBracket() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NCAA Division I Men' } },
    create: { sportId: sport.id, name: 'NCAA Division I Men' },
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
    sport: Sport.BASKETBALL,
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
  // Linking is the admin's action (a later part of #1496); here the rows are linked directly.
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
  it('completes each linked match the provider calls final and sends its winner on, scoring the side each team plays', async () => {
    const { event, externalId, entryOf, teamId, matches } = await linkedBracket();

    const result = await publish(externalId, [
      // Listed Houston at home, though the match has Duke at home.
      { externalGameId: 'g1', homeTeamExternalId: teamId('Houston'), awayTeamExternalId: teamId('Duke'), state: ProviderGameState.FINAL, homeScore: 67, awayScore: 70 },
      { externalGameId: 'g2', homeTeamExternalId: teamId('Auburn'), awayTeamExternalId: teamId('Florida'), state: ProviderGameState.IN_PROGRESS, homeScore: 40, awayScore: 38 },
    ]);

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    const [first, second, final] = await matches.findBySportEvent(event.id);
    expect(first).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 70, awayScore: 67 });
    expect(second).toMatchObject({ status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null });
    expect(final.homeSportEventParticipantId).toBe(entryOf('Duke').id);
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

  it('refuses a second match of the event linked to a game another of its matches already takes', async () => {
    const { event } = await linkedBracket();

    await expect(getPrisma().sportEventMatch.updateMany({ where: { sportEventId: event.id, matchNumber: 3 }, data: { externalGameId: 'g1' } }))
      .rejects.toThrow();
  });
});
