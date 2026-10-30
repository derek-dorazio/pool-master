import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { MatchEnding, MatchSide, MatchStatus, ParticipantInactiveReason, ParticipantStatus, Sport } from '@poolmaster/shared/domain';
import type { SportEventMatchWrite } from '@poolmaster/shared/db';
import { expectDefined } from '../../support/expect-defined';
import {
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';

// An event's bracket against real Postgres (#698): the match port's one read and its writes, what
// removing a field row or the event does to it, the play-in fill, and every database check the
// migration adds to sport_event_matches. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** A result with no shoot-out, played to its end. */
const NO_SHOOTOUT = { homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED };

function repos() {
  return {
    events: new PrismaSportEventRepository(getAppPrisma()),
    rounds: new PrismaSportEventRoundRepository(getAppPrisma()),
    field: new PrismaSportEventParticipantRepository(getAppPrisma()),
    matches: new PrismaSportEventMatchRepository(getAppPrisma()),
  };
}

/** A two-round basketball event with a field of four teams. */
async function createBracketEvent() {
  const prisma = getPrisma();
  // The integration cleanup empties sport leagues no template names, so the basketball rows are set up here.
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
  const { events, rounds, field } = repos();
  const event = await createSportEventRow(events, {
    eventSeriesId: eventSeries.id,
    eventYear: 2027,
    externalId: `bracket-${randomUUID()}`,
    providerId: 'integration-test',
    sport: Sport.BASKETBALL,
    name: 'NCAA Tournament',
    startDate: new Date('2027-03-18T16:00:00.000Z'),
    status: 'DRAFT',
    rounds: 2,
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
  });
  await createRoundRows(rounds, event.id, [
    { roundNumber: 1, scheduledDate: new Date('2027-03-18T16:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2027-03-20T16:00:00.000Z') },
  ]);
  const teams = await Promise.all(['Duke', 'Vermont', 'Houston', 'Texas'].map((name) => prisma.participant.create({
    data: { sportId: sport.id, name, participantType: 'TEAM' },
  })));
  await field.createMany(event.id, teams.map((team, index) => ({ participantId: team.id, seedNumber: index + 1 })));
  const entries = await field.findBySportEvent(event.id);
  const entryOf = (name: string) => expectDefined(entries.find((entry) => entry.participantId === teams.find((team) => team.name === name)?.id), name);
  return { event, sport, entries, entryOf };
}

/** Two semifinals feeding a final, with ids chosen up front so the links can name them. */
function fourTeamBracket(entryOf: (name: string) => { id: string }): SportEventMatchWrite[] {
  const finalId = randomUUID();
  return [
    { id: randomUUID(), roundNumber: 1, matchNumber: 1, homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: entryOf('Vermont').id, isNeutralSite: true, scheduledDate: new Date('2027-03-18T19:10:00.000Z'), advancesToMatchId: finalId, advancesToSide: MatchSide.HOME, regionLabel: null },
    { id: randomUUID(), roundNumber: 1, matchNumber: 2, homeSportEventParticipantId: entryOf('Houston').id, awaySportEventParticipantId: entryOf('Texas').id, isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSide: MatchSide.AWAY, regionLabel: null },
    { id: finalId, roundNumber: 2, matchNumber: 3, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSide: null, regionLabel: null },
  ];
}

describe('PrismaSportEventMatchRepository', () => {
  it('loads a bracket in one write and reads it back in match order with each match\'s round number and where its winner goes', async () => {
    const { event, entryOf } = await createBracketEvent();
    const bracket = fourTeamBracket(entryOf);

    await repos().matches.replaceBracket(event.id, [...bracket].reverse());
    const matches = await repos().matches.findBySportEvent(event.id);

    expect(matches.map((match) => ({
      matchNumber: match.matchNumber,
      roundNumber: match.roundNumber,
      advancesToMatchId: match.advancesToMatchId,
      advancesToSide: match.advancesToSide,
      status: match.status,
    }))).toEqual([
      { matchNumber: 1, roundNumber: 1, advancesToMatchId: bracket[2].id, advancesToSide: MatchSide.HOME, status: MatchStatus.SCHEDULED },
      { matchNumber: 2, roundNumber: 1, advancesToMatchId: bracket[2].id, advancesToSide: MatchSide.AWAY, status: MatchStatus.SCHEDULED },
      { matchNumber: 3, roundNumber: 2, advancesToMatchId: null, advancesToSide: null, status: MatchStatus.SCHEDULED },
    ]);
    expect(matches[0]).toMatchObject({
      homeSportEventParticipantId: entryOf('Duke').id,
      scheduledDate: new Date('2027-03-18T19:10:00.000Z'),
      winnerSide: null,
      homeScore: null,
    });
  });

  it('replaces a loaded bracket whole, though its matches point at each other', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));

    const [first] = fourTeamBracket(entryOf);
    await repos().matches.replaceBracket(event.id, [{ ...first, advancesToMatchId: null, advancesToSide: null }]);

    expect((await repos().matches.findBySportEvent(event.id)).map((match) => match.matchNumber)).toEqual([1]);
  });

  it('reads only the asked-about event\'s matches', async () => {
    const one = await createBracketEvent();
    const other = await createBracketEvent();
    await repos().matches.replaceBracket(one.event.id, fourTeamBracket(one.entryOf));

    await expect(repos().matches.findBySportEvent(other.event.id)).resolves.toEqual([]);
  });

  it('reads several events\' matches in one call, each event\'s in match order, leaving out events not asked about and reading none for none', async () => {
    const one = await createBracketEvent();
    const two = await createBracketEvent();
    const notAsked = await createBracketEvent();
    for (const { event, entryOf } of [one, two, notAsked]) {
      await repos().matches.replaceBracket(event.id, [...fourTeamBracket(entryOf)].reverse());
    }

    const matches = await repos().matches.findBySportEvents([two.event.id, one.event.id]);

    const byEvent = (sportEventId: string) => matches.filter((match) => match.sportEventId === sportEventId).map((match) => [match.matchNumber, match.roundNumber]);
    expect(matches).toHaveLength(6);
    expect(byEvent(one.event.id)).toEqual([[1, 1], [2, 1], [3, 2]]);
    expect(byEvent(two.event.id)).toEqual([[1, 1], [2, 1], [3, 2]]);
    await expect(repos().matches.findBySportEvents([])).resolves.toEqual([]);
  });

  it('reads one match by id, as the event read reads it with its round number and its period scores in period order, and null for no match', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const final = expectDefined((await repos().matches.findBySportEvent(event.id)).find((match) => match.roundNumber === 2));
    await repos().matches.savePeriodScore(final.id, { periodNumber: 2, homeScore: 30, awayScore: 28 });
    await repos().matches.savePeriodScore(final.id, { periodNumber: 1, homeScore: 14, awayScore: 10 });

    const read = await repos().matches.findById(final.id);

    expect(read).toEqual((await repos().matches.findBySportEvent(event.id)).find((match) => match.id === final.id));
    expect(read?.periodScores.map((score) => score.periodNumber)).toEqual([1, 2]);
    await expect(repos().matches.findById(randomUUID())).resolves.toBeNull();
  });

  it('edits one match, clearing a value sent as null and keeping the ones left out', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.update(first.id, { scheduledDate: null, isNeutralSite: false });

    const [edited] = await repos().matches.findBySportEvent(event.id);
    expect(edited).toMatchObject({ scheduledDate: null, isNeutralSite: false, homeSportEventParticipantId: entryOf('Duke').id });
  });

  it('stores a game\'s spread in half points and reads it back as a number, clearing it with null (#720)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first, second] = await repos().matches.findBySportEvent(event.id);
    expect([first.homeSpread, second.homeSpread]).toEqual([null, null]);

    await repos().matches.update(first.id, { homeSpread: -3.5 });
    await repos().matches.update(second.id, { homeSpread: 14 });
    expect((await repos().matches.findBySportEvent(event.id)).slice(0, 2).map((match) => match.homeSpread)).toEqual([-3.5, 14]);

    await repos().matches.update(first.id, { homeSpread: null });
    expect((await repos().matches.findBySportEvent(event.id))[0]?.homeSpread).toBeNull();
  });

  it('saves, replaces and deletes a game\'s period scores, reading them in period order, and drops them with the bracket (#772)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.savePeriodScore(first.id, { periodNumber: 3, homeScore: 21, awayScore: 14 });
    await repos().matches.savePeriodScore(first.id, { periodNumber: 1, homeScore: 7, awayScore: 0 });
    await repos().matches.savePeriodScore(first.id, { periodNumber: 1, homeScore: 7, awayScore: 3 });
    expect((await repos().matches.findBySportEvent(event.id))[0]?.periodScores).toEqual([
      { periodNumber: 1, homeScore: 7, awayScore: 3 },
      { periodNumber: 3, homeScore: 21, awayScore: 14 },
    ]);

    await repos().matches.deletePeriodScore(first.id, 3);
    await repos().matches.deletePeriodScore(first.id, 2);
    expect((await repos().matches.findBySportEvent(event.id))[0]?.periodScores).toEqual([{ periodNumber: 1, homeScore: 7, awayScore: 3 }]);

    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    await expect(getPrisma().sportEventMatchPeriodScore.count({ where: { sportEventMatchId: first.id } })).resolves.toBe(0);
  });

  it('refuses a period before the first and a negative period score in the database', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await expect(repos().matches.savePeriodScore(first.id, { periodNumber: 0, homeScore: 0, awayScore: 0 })).rejects.toThrow(/period_number_check/);
    await expect(repos().matches.savePeriodScore(first.id, { periodNumber: 1, homeScore: -1, awayScore: 0 })).rejects.toThrow(/scores_check/);
  });

  it('deletes the bracket with its event', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));

    await repos().events.delete(event.id);

    await expect(getPrisma().sportEventMatch.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
  });
});

describe('PrismaSportEventMatchRepository.applyResult', () => {
  it('completes the match, fills the next match\'s side and writes every standing in one transaction, then rewrites them', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first, , final] = await repos().matches.findBySportEvent(event.id);
    const asOf = new Date('2027-03-19T04:00:00.000Z');

    await repos().matches.applyResult({
      result: { id: first.id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 80, ...NO_SHOOTOUT },
      sideFill: { id: final.id, side: MatchSide.HOME, sportEventParticipantId: entryOf('Vermont').id },
      standings: [
        { sportEventParticipantId: entryOf('Vermont').id, position: 1, displayPosition: '1', status: 'ACTIVE', currentRound: 2, asOf },
        { sportEventParticipantId: entryOf('Duke').id, position: 4, displayPosition: '4', status: 'ELIMINATED', currentRound: 1, asOf },
      ],
    });
    await repos().matches.applyResult({
      result: { id: first.id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 81, ...NO_SHOOTOUT },
      sideFill: null,
      standings: [{ sportEventParticipantId: entryOf('Duke').id, position: 3, displayPosition: 'T3', status: 'ELIMINATED', currentRound: 1, asOf }],
    });

    const [completed, , filled] = await repos().matches.findBySportEvent(event.id);
    expect(completed).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 70, awayScore: 81 });
    expect(filled.homeSportEventParticipantId).toBe(entryOf('Vermont').id);
    const standings = await getPrisma().sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: event.id } } });
    expect(Object.fromEntries(standings.map((row) => [row.sportEventParticipantId, [row.displayPosition, row.status]]))).toEqual({
      [entryOf('Duke').id]: ['T3', 'ELIMINATED'],
      [entryOf('Vermont').id]: ['1', 'ACTIVE'],
    });
  });

  it('stores a level match\'s shoot-out apart from its score, and clears it with the result (#791)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);
    const level = { id: first.id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1 };

    await repos().matches.applyResult({ result: { ...level, homeShootoutScore: 3, awayShootoutScore: 4, ending: MatchEnding.PLAYED }, sideFill: null, standings: [] });
    const [settled] = await repos().matches.findBySportEvent(event.id);
    await repos().matches.applyResult({
      result: { id: first.id, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, ...NO_SHOOTOUT },
      sideFill: null,
      standings: [],
    });
    const [cleared] = await repos().matches.findBySportEvent(event.id);

    expect(settled).toMatchObject({ homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4, winnerSide: MatchSide.AWAY });
    expect(cleared).toMatchObject({ homeShootoutScore: null, awayShootoutScore: null });
  });

  it('stores how a match ended, and a walkover with no score, and puts it back to played when cleared (#704)', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.applyResult({
      result: { id: first.id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: null, awayScore: null, ...NO_SHOOTOUT, ending: MatchEnding.WALKOVER },
      sideFill: null,
      standings: [],
    });
    const [walkover] = await repos().matches.findBySportEvent(event.id);
    await repos().matches.applyResult({
      result: { id: first.id, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, ...NO_SHOOTOUT },
      sideFill: null,
      standings: [],
    });
    const [cleared] = await repos().matches.findBySportEvent(event.id);

    expect(walkover).toMatchObject({ status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: null, ending: MatchEnding.WALKOVER });
    expect(cleared).toMatchObject({ status: MatchStatus.SCHEDULED, ending: MatchEnding.PLAYED });
  });

  it('writes nothing when one part of the result is refused by the database', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await expect(repos().matches.applyResult({
      result: { id: first.id, status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 80, awayScore: 70, ...NO_SHOOTOUT },
      sideFill: { id: randomUUID(), side: MatchSide.HOME, sportEventParticipantId: entryOf('Duke').id },
      standings: [],
    })).rejects.toThrow();

    const [unchanged] = await repos().matches.findBySportEvent(event.id);
    expect(unchanged).toMatchObject({ status: MatchStatus.SCHEDULED, winnerSide: null });
  });
});

describe('PrismaSportEventParticipantRepository.fillPlayInSlot', () => {
  it('points the field row at the winning team, ends its play-in place and inactivates the pairing, together', async () => {
    const { event, sport, entryOf } = await createBracketEvent();
    const prisma = getPrisma();
    const pairing = await prisma.participant.create({ data: { sportId: sport.id, name: 'Texas / Xavier', participantType: 'TEAM' } });
    const xavier = await prisma.participant.create({ data: { sportId: sport.id, name: 'Xavier', participantType: 'TEAM' } });
    await repos().field.createMany(event.id, [{ participantId: pairing.id, seedNumber: 11 }]);
    const slot = expectDefined((await repos().field.findBySportEvent(event.id)).find((entry) => entry.participantId === pairing.id));
    expect(entryOf('Duke')).toBeDefined();
    await repos().field.updateMany([{ id: slot.id, updates: { isPlayInPlace: true } }]);
    await expect(repos().field.findById(slot.id)).resolves.toMatchObject({ isPlayInPlace: true });

    await repos().field.fillPlayInSlot({ id: slot.id, winnerParticipantId: xavier.id, pairingParticipantId: pairing.id });

    await expect(repos().field.findById(slot.id)).resolves.toMatchObject({ participantId: xavier.id, seedNumber: 11, isPlayInPlace: false });
    await expect(prisma.participant.findUnique({ where: { id: pairing.id } })).resolves.toMatchObject({ status: ParticipantStatus.INACTIVE });
  });
});

describe('PrismaSportEventParticipantRepository.replaceWithdrawn', () => {
  it('adds the replacement with its valuation, names it on the withdrawn row\'s side and inactivates that row as WITHDRAWN, together', async () => {
    const { event, sport, entryOf } = await createBracketEvent();
    const prisma = getPrisma();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const tier = await prisma.sportEventTier.create({ data: { sportEventId: event.id, tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 } });
    const luckyLoser = await prisma.participant.create({ data: { sportId: sport.id, name: 'Lucky Loser', participantType: 'TEAM' } });
    const [first] = await repos().matches.findBySportEvent(event.id);

    const replacementId = await repos().field.replaceWithdrawn({
      withdrawnId: entryOf('Vermont').id,
      matchId: expectDefined(first).id,
      side: MatchSide.AWAY,
      replacementParticipantId: luckyLoser.id,
      valuation: { sportEventTierId: tier.id, tierOrderIndex: 5, price: 4500 },
    });

    await expect(repos().field.findById(replacementId)).resolves.toMatchObject({ participantId: luckyLoser.id, isActive: true, seedNumber: undefined });
    await expect(repos().field.findById(entryOf('Vermont').id)).resolves.toMatchObject({ isActive: false, inactiveReason: ParticipantInactiveReason.WITHDRAWN, seedNumber: 2 });
    const [replaced] = await repos().matches.findBySportEvent(event.id);
    expect(replaced).toMatchObject({ homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: replacementId });
    const valuation = await prisma.sportEventParticipantValuation.findUniqueOrThrow({ where: { sportEventParticipantId: replacementId } });
    expect(valuation).toMatchObject({ sportEventTierId: tier.id, tierOrderIndex: 5, tierAssignedSource: 'MANUAL', priceAssignedSource: 'MANUAL' });
    expect(Number(valuation.price)).toBe(4500);
  });

  it('writes nothing when the replacement is already on the field, so the withdrawn row keeps its place', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await expect(repos().field.replaceWithdrawn({
      withdrawnId: entryOf('Vermont').id,
      matchId: expectDefined(first).id,
      side: MatchSide.AWAY,
      replacementParticipantId: entryOf('Houston').participantId,
      valuation: null,
    })).rejects.toThrow();

    await expect(repos().field.findById(entryOf('Vermont').id)).resolves.toMatchObject({ isActive: true });
    const [unchanged] = await repos().matches.findBySportEvent(event.id);
    expect(expectDefined(unchanged).awaySportEventParticipantId).toBe(entryOf('Vermont').id);
  });
});

describe('sport_event_matches database checks', () => {
  /** Inserts one match of the event directly, as only a defect in the service could. */
  async function insertMatch(event: { id: string }, values: Record<string, unknown> = {}) {
    const round = await getPrisma().sportEventRound.findFirstOrThrow({ where: { sportEventId: event.id, roundNumber: 1 } });
    return getPrisma().sportEventMatch.create({
      data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: true, ...values },
    });
  }

  it('refuses a match whose two sides are one team', async () => {
    const { event, entryOf } = await createBracketEvent();

    await expect(insertMatch(event, { homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: entryOf('Duke').id }))
      .rejects.toThrow(/sport_event_matches_sides_differ/);
  });

  it('refuses a side to advance to without the match, and a match to advance to without the side', async () => {
    const { event } = await createBracketEvent();
    const next = await insertMatch(event, { matchNumber: 2 });

    await expect(insertMatch(event, { advancesToSide: MatchSide.HOME })).rejects.toThrow(/sport_event_matches_advances_to_side_with_match/);
    await expect(insertMatch(event, { advancesToMatchId: next.id })).rejects.toThrow(/sport_event_matches_advances_to_side_with_match/);
  });

  it('refuses a match that advances into itself', async () => {
    const { event } = await createBracketEvent();
    const match = await insertMatch(event);

    await expect(getPrisma().sportEventMatch.update({ where: { id: match.id }, data: { advancesToMatchId: match.id, advancesToSide: MatchSide.HOME } }))
      .rejects.toThrow(/sport_event_matches_advances_elsewhere/);
  });

  it('refuses a winner on a match that is not COMPLETED, and takes one on a COMPLETED match', async () => {
    const { event } = await createBracketEvent();

    await expect(insertMatch(event, { winnerSide: MatchSide.HOME, status: MatchStatus.IN_PROGRESS }))
      .rejects.toThrow(/sport_event_matches_winner_only_when_completed/);
    await expect(insertMatch(event, { winnerSide: MatchSide.HOME, status: MatchStatus.COMPLETED, homeScore: 4, awayScore: 2 }))
      .resolves.toMatchObject({ winnerSide: MatchSide.HOME });
  });

  it('refuses a negative score and a match number below 1', async () => {
    const { event } = await createBracketEvent();

    await expect(insertMatch(event, { homeScore: -1 })).rejects.toThrow(/sport_event_matches_scores_not_negative/);
    await expect(insertMatch(event, { matchNumber: 0 })).rejects.toThrow(/sport_event_matches_match_number_positive/);
  });

  it('refuses one shoot-out score without the other and a negative one, and takes both (#791)', async () => {
    const { event } = await createBracketEvent();

    await expect(insertMatch(event, { homeShootoutScore: 4 })).rejects.toThrow(/sport_event_matches_shootout_scores_check/);
    await expect(insertMatch(event, { homeShootoutScore: -1, awayShootoutScore: 3 })).rejects.toThrow(/sport_event_matches_shootout_scores_check/);
    await expect(insertMatch(event, { homeShootoutScore: 4, awayShootoutScore: 3 })).resolves.toMatchObject({ homeShootoutScore: 4 });
  });

  it('refuses an early ending on a match without a winner and a walkover with a score, and takes a retirement whose winner trailed (#704)', async () => {
    const { event } = await createBracketEvent();

    await expect(insertMatch(event, { ending: MatchEnding.RETIREMENT })).rejects.toThrow(/sport_event_matches_ending_check/);
    await expect(insertMatch(event, { ending: MatchEnding.WALKOVER, winnerSide: MatchSide.HOME, status: MatchStatus.COMPLETED, homeScore: 1, awayScore: 0 }))
      .rejects.toThrow(/sport_event_matches_ending_check/);
    await expect(insertMatch(event, { ending: MatchEnding.RETIREMENT, winnerSide: MatchSide.HOME, status: MatchStatus.COMPLETED, homeScore: 0, awayScore: 1 }))
      .resolves.toMatchObject({ ending: MatchEnding.RETIREMENT });
  });

  it('refuses a spread that is not in half points, and takes one that is (#720)', async () => {
    const { event } = await createBracketEvent();

    await expect(insertMatch(event, { homeSpread: 3.2 })).rejects.toThrow(/sport_event_matches_home_spread_half_points_check/);
    await expect(insertMatch(event, { homeSpread: -6.5 })).resolves.toMatchObject({ matchNumber: 1 });
  });

  it('refuses a match number used twice in one event, and two matches advancing to one side', async () => {
    const { event } = await createBracketEvent();
    const final = await insertMatch(event, { matchNumber: 3 });
    await insertMatch(event, { matchNumber: 1, advancesToMatchId: final.id, advancesToSide: MatchSide.HOME });

    await expect(insertMatch(event, { matchNumber: 1 })).rejects.toThrow(/Unique constraint/);
    await expect(insertMatch(event, { matchNumber: 2, advancesToMatchId: final.id, advancesToSide: MatchSide.HOME }))
      .rejects.toThrow(/Unique constraint/);
  });

  it('refuses to remove a field row a match names, so a bracket never loses a team silently', async () => {
    const { event, entryOf } = await createBracketEvent();
    await insertMatch(event, { homeSportEventParticipantId: entryOf('Duke').id });

    await expect(repos().field.delete(entryOf('Duke').id)).rejects.toThrow(/Foreign key constraint/);
    await expect(repos().field.findById(entryOf('Duke').id)).resolves.not.toBeNull();
  });
});
