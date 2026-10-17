import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { MatchSide, MatchStatus, ParticipantStatus, Sport } from '@poolmaster/shared/domain';
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
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// An event's bracket against real Postgres (#698): the match port's one read and its writes, what
// removing a field row or the event does to it, the play-in fill, and every database check the
// migration adds to sport_event_matches. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

function repos() {
  const prisma = getPrisma();
  return {
    events: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
  };
}

/** A two-round basketball event with a field of four teams. */
async function createBracketEvent() {
  const prisma = getPrisma();
  // The integration cleanup empties sport leagues no template names, so the basketball rows are set up here.
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'KNOCKOUT_BRACKET' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NCAA Division I Men' } },
    create: { sportId: sport.id, name: 'NCAA Division I Men' },
    update: {},
  });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Bracket ${randomUUID()}` } });
  const { events, rounds, field } = repos();
  const event = await events.create({
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
  await rounds.createMany(event.id, [
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
    { id: randomUUID(), roundNumber: 1, matchNumber: 1, homeSportEventParticipantId: entryOf('Duke').id, awaySportEventParticipantId: entryOf('Vermont').id, isNeutralSite: true, scheduledDate: new Date('2027-03-18T19:10:00.000Z'), advancesToMatchId: finalId, advancesToSide: MatchSide.HOME },
    { id: randomUUID(), roundNumber: 1, matchNumber: 2, homeSportEventParticipantId: entryOf('Houston').id, awaySportEventParticipantId: entryOf('Texas').id, isNeutralSite: true, scheduledDate: null, advancesToMatchId: finalId, advancesToSide: MatchSide.AWAY },
    { id: finalId, roundNumber: 2, matchNumber: 3, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesToMatchId: null, advancesToSide: null },
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

  it('edits one match, clearing a value sent as null and keeping the ones left out', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));
    const [first] = await repos().matches.findBySportEvent(event.id);

    await repos().matches.update(first.id, { scheduledDate: null, isNeutralSite: false });

    const [edited] = await repos().matches.findBySportEvent(event.id);
    expect(edited).toMatchObject({ scheduledDate: null, isNeutralSite: false, homeSportEventParticipantId: entryOf('Duke').id });
  });

  it('deletes the bracket with its event', async () => {
    const { event, entryOf } = await createBracketEvent();
    await repos().matches.replaceBracket(event.id, fourTeamBracket(entryOf));

    await repos().events.delete(event.id);

    await expect(getPrisma().sportEventMatch.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
  });
});

describe('PrismaSportEventParticipantRepository.fillPlayInSlot', () => {
  it('points the field row at the winning team and inactivates the pairing, together', async () => {
    const { event, sport, entryOf } = await createBracketEvent();
    const prisma = getPrisma();
    const pairing = await prisma.participant.create({ data: { sportId: sport.id, name: 'Texas / Xavier', participantType: 'TEAM' } });
    const xavier = await prisma.participant.create({ data: { sportId: sport.id, name: 'Xavier', participantType: 'TEAM' } });
    await repos().field.createMany(event.id, [{ participantId: pairing.id, seedNumber: 11 }]);
    const slot = expectDefined((await repos().field.findBySportEvent(event.id)).find((entry) => entry.participantId === pairing.id));
    expect(entryOf('Duke')).toBeDefined();

    await repos().field.fillPlayInSlot({ id: slot.id, winnerParticipantId: xavier.id, pairingParticipantId: pairing.id });

    await expect(repos().field.findById(slot.id)).resolves.toMatchObject({ participantId: xavier.id, seedNumber: 11 });
    await expect(prisma.participant.findUnique({ where: { id: pairing.id } })).resolves.toMatchObject({ status: ParticipantStatus.INACTIVE });
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
