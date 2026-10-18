import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContestEntryStatus, ContestStatus, Sport } from '@poolmaster/shared/domain';
import {
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { expectDefined } from '../../support/expect-defined';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// A pick'em entry's game picks against real Postgres (#716): the prediction port's read and its
// one write (upsert, clear and the week's status, all or none), the database checks the migration
// adds to contest_entry_match_predictions, and what removing an event from a contest does to the
// picks on its games. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

function repos() {
  const prisma = getPrisma();
  return {
    contests: new PrismaContestRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    predictions: new PrismaContestEntryMatchPredictionRepository(prisma),
  };
}

const AT = new Date('2026-09-08T18:00:00.000Z');
const LATER = new Date('2026-09-09T18:00:00.000Z');

/** An NFL week of three games (match numbers 1 to 3), its six teams on the field. */
async function createWeek(label: string, startDate: Date) {
  const prisma = getPrisma();
  // The integration cleanup empties sport leagues no template names, so the football rows are set up here.
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'KNOCKOUT_BRACKET' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NFL' } },
    create: { sportId: sport.id, name: 'NFL' },
    update: {},
  });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `${label} ${randomUUID()}` } });
  const event = await new PrismaSportEventRepository(prisma).create({
    eventSeriesId: eventSeries.id,
    eventYear: 2026,
    externalId: `pickem-${randomUUID()}`,
    providerId: 'integration-test',
    sport: Sport.AMERICAN_FOOTBALL,
    name: label,
    startDate,
    status: 'SCHEDULED',
    rounds: 1,
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
  });
  await new PrismaSportEventRoundRepository(prisma).createMany(event.id, [{ roundNumber: 1, scheduledDate: startDate }]);
  const teams = await Promise.all(['Bills', 'Jets', 'Chiefs', 'Raiders', 'Eagles', 'Giants'].map((name) => prisma.participant.create({
    data: { sportId: sport.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' },
  })));
  const field = new PrismaSportEventParticipantRepository(prisma);
  await field.createMany(event.id, teams.map((team) => ({ participantId: team.id })));
  const rows = await field.findBySportEvent(event.id);
  const rowOf = (index: number) => expectDefined(rows.find((row) => row.participantId === teams[index]?.id));
  const matchRepo = new PrismaSportEventMatchRepository(prisma);
  // Written out of order so the read's match-number order is the repository's, not insertion's.
  await matchRepo.replaceBracket(event.id, [3, 1, 2].map((matchNumber) => ({
    id: randomUUID(),
    roundNumber: 1,
    matchNumber,
    homeSportEventParticipantId: rowOf((matchNumber - 1) * 2).id,
    awaySportEventParticipantId: rowOf((matchNumber - 1) * 2 + 1).id,
    isNeutralSite: false,
    scheduledDate: new Date(startDate.getTime() + matchNumber * 60 * 60 * 1000),
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
  })));
  const games = await matchRepo.findBySportEvent(event.id);
  const game = (matchNumber: number) => expectDefined(games.find((match) => match.matchNumber === matchNumber));
  return { event, game };
}

/** A league with a squad, a PICK_EM contest over `sportEventIds`, and one entry in it. */
async function createPickEmEntry(sportEventIds: string[]) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Pickem Repo ${suffix}` });
  const league = await prisma.league.create({
    data: { leagueCode: `CREPO${suffix.toUpperCase()}`, name: `Pickem Repo League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Pickers ${suffix}` } });
  const contest = await repos().contests.create({
    leagueId: league.id,
    sportEventIds,
    name: `Confidence ${suffix}`,
    status: ContestStatus.OPEN,
    contestFormat: 'PREDICTION',
    selectionType: 'PICK_EM',
  });
  const result = await repos().entries.create({ contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Pickers', tiebreakerValue: null });
  if (result.status !== 'created') throw new Error(`seed: entry refused (${result.status})`);
  return { contest, entry: result.entry };
}

function weekStatus(entry: { events: { sportEventId: string; status: string; submittedAt?: Date }[] }, sportEventId: string) {
  const row = entry.events.find((event) => event.sportEventId === sportEventId);
  return { status: row?.status, submittedAt: row?.submittedAt ?? null };
}

describe('PrismaContestEntryMatchPredictionRepository', () => {
  it('saves picks and reads them back in game-number order, whatever order they were saved in', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);

    await repos().predictions.save({
      contestEntryId: entry.id,
      sportEventId: event.id,
      saves: [3, 1, 2].map((matchNumber) => ({
        sportEventMatchId: game(matchNumber).id,
        sportEventParticipantId: expectDefined(game(matchNumber).homeSportEventParticipantId),
        confidence: matchNumber,
      })),
      clearedMatchIds: [],
      eventStatus: null,
      at: AT,
    });

    const picks = await repos().predictions.findByEntryAndEvent(entry.id, event.id);
    expect(picks.map((pick) => [pick.sportEventMatchId, pick.confidence, pick.pickedAt])).toEqual([
      [game(1).id, 1, AT],
      [game(2).id, 2, AT],
      [game(3).id, 3, AT],
    ]);
  });

  it('replaces the entry\'s pick on a game it saves again, keeping the row and stamping the new pickedAt', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const first = game(1);
    const save = (sportEventParticipantId: string, confidence: number | null, at: Date) => repos().predictions.save({
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at,
      saves: [{ sportEventMatchId: first.id, sportEventParticipantId, confidence }],
    });

    await save(expectDefined(first.homeSportEventParticipantId), 2, AT);
    const [before] = await repos().predictions.findByEntryAndEvent(entry.id, event.id);
    await save(expectDefined(first.awaySportEventParticipantId), null, LATER);
    const after = await repos().predictions.findByEntryAndEvent(entry.id, event.id);

    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: expectDefined(before).id,
      sportEventParticipantId: first.awaySportEventParticipantId,
      confidence: null,
      pickedAt: LATER,
    });
  });

  it('clears only the games named, leaving the entry\'s other picks', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    await repos().predictions.save({
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT,
      saves: [1, 2, 3].map((matchNumber) => ({
        sportEventMatchId: game(matchNumber).id,
        sportEventParticipantId: expectDefined(game(matchNumber).awaySportEventParticipantId),
        confidence: null,
      })),
    });

    await repos().predictions.save({
      contestEntryId: entry.id, sportEventId: event.id, saves: [], clearedMatchIds: [game(2).id], eventStatus: null, at: LATER,
    });

    expect((await repos().predictions.findByEntryAndEvent(entry.id, event.id)).map((pick) => pick.sportEventMatchId))
      .toEqual([game(1).id, game(3).id]);
  });

  it('stamps submittedAt when the week is set SUBMITTED, clears it when set back to DRAFT, and leaves the status alone when none is given', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const pick = { sportEventMatchId: game(1).id, sportEventParticipantId: expectDefined(game(1).homeSportEventParticipantId), confidence: null };
    const reread = async () => weekStatus(expectDefined(await repos().entries.findByIdWithSquad(entry.id)), event.id);

    await repos().predictions.save({ contestEntryId: entry.id, sportEventId: event.id, saves: [], clearedMatchIds: [], eventStatus: ContestEntryStatus.SUBMITTED, at: AT });
    expect(await reread()).toEqual({ status: ContestEntryStatus.SUBMITTED, submittedAt: AT });

    await repos().predictions.save({ contestEntryId: entry.id, sportEventId: event.id, saves: [pick], clearedMatchIds: [], eventStatus: null, at: LATER });
    expect(await reread()).toEqual({ status: ContestEntryStatus.SUBMITTED, submittedAt: AT });

    await repos().predictions.save({ contestEntryId: entry.id, sportEventId: event.id, saves: [], clearedMatchIds: [game(1).id], eventStatus: ContestEntryStatus.DRAFT, at: LATER });
    expect(await reread()).toEqual({ status: ContestEntryStatus.DRAFT, submittedAt: null });
  });

  it('reads only the asked-about event\'s picks of an entry playing two weeks', async () => {
    const week1 = await createWeek('Week 1', AT);
    const week2 = await createWeek('Week 2', LATER);
    const { entry } = await createPickEmEntry([week1.event.id, week2.event.id]);
    for (const week of [week1, week2]) {
      await repos().predictions.save({
        contestEntryId: entry.id, sportEventId: week.event.id, clearedMatchIds: [], eventStatus: null, at: AT,
        saves: [{ sportEventMatchId: week.game(1).id, sportEventParticipantId: expectDefined(week.game(1).homeSportEventParticipantId), confidence: null }],
      });
    }

    expect((await repos().predictions.findByEntryAndEvent(entry.id, week2.event.id)).map((pick) => pick.sportEventMatchId))
      .toEqual([week2.game(1).id]);
  });

  it('writes none of a save when one pick breaks a database check, status included', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);

    await expect(repos().predictions.save({
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: ContestEntryStatus.SUBMITTED, at: AT,
      saves: [
        { sportEventMatchId: game(1).id, sportEventParticipantId: expectDefined(game(1).homeSportEventParticipantId), confidence: 1 },
        { sportEventMatchId: game(2).id, sportEventParticipantId: expectDefined(game(2).homeSportEventParticipantId), confidence: 0 },
      ],
    })).rejects.toThrow();

    await expect(repos().predictions.findByEntryAndEvent(entry.id, event.id)).resolves.toEqual([]);
    expect(weekStatus(expectDefined(await repos().entries.findByIdWithSquad(entry.id)), event.id).status).toBe(ContestEntryStatus.DRAFT);
  });
});

describe('contest_entry_match_predictions constraints', () => {
  async function seeded() {
    const week = await createWeek('Week 1', AT);
    const { contest, entry } = await createPickEmEntry([week.event.id]);
    const row = (confidence: number | null) => ({
      contestEntryId: entry.id,
      sportEventMatchId: week.game(1).id,
      sportEventParticipantId: expectDefined(week.game(1).homeSportEventParticipantId),
      confidence,
      pickedAt: AT,
    });
    return { ...week, contest, entry, row };
  }

  it.each([0, -3])('refuses confidence %p with the confidence check', async (confidence) => {
    const { row } = await seeded();
    await expect(getPrisma().contestEntryMatchPrediction.create({ data: row(confidence) }))
      .rejects.toThrow(/contest_entry_match_predictions_confidence_positive/);
  });

  it('allows a pick with no confidence value', async () => {
    const { row } = await seeded();
    await expect(getPrisma().contestEntryMatchPrediction.create({ data: row(null) })).resolves.toMatchObject({ confidence: null });
  });

  it('refuses a second pick by the same entry on the same game with a unique violation', async () => {
    const { row } = await seeded();
    await getPrisma().contestEntryMatchPrediction.create({ data: row(1) });
    await expect(getPrisma().contestEntryMatchPrediction.create({ data: row(2) })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('deletes an entry\'s picks with the entry', async () => {
    const { entry, row } = await seeded();
    await getPrisma().contestEntryMatchPrediction.create({ data: row(1) });

    await getPrisma().contestEntry.delete({ where: { id: entry.id } });

    await expect(getPrisma().contestEntryMatchPrediction.count({ where: { contestEntryId: entry.id } })).resolves.toBe(0);
  });

  it('refuses deleting a game an entry has picked, so a pick never loses its game', async () => {
    const { game, row } = await seeded();
    await getPrisma().contestEntryMatchPrediction.create({ data: row(1) });

    await expect(getPrisma().sportEventMatch.delete({ where: { id: game(1).id } })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('PrismaContestRepository.replaceSportEvents with game picks', () => {
  it('removes an event from a pick\'em contest with the entry\'s picks on its games, keeping the other week\'s picks', async () => {
    const week1 = await createWeek('Week 1', AT);
    const week2 = await createWeek('Week 2', LATER);
    const { contest, entry } = await createPickEmEntry([week1.event.id, week2.event.id]);
    for (const week of [week1, week2]) {
      await repos().predictions.save({
        contestEntryId: entry.id, sportEventId: week.event.id, clearedMatchIds: [], eventStatus: null, at: AT,
        saves: [1, 2].map((matchNumber) => ({
          sportEventMatchId: week.game(matchNumber).id,
          sportEventParticipantId: expectDefined(week.game(matchNumber).homeSportEventParticipantId),
          confidence: matchNumber,
        })),
      });
    }

    await repos().contests.replaceSportEvents(contest.id, [week2.event.id]);

    await expect(repos().predictions.findByEntryAndEvent(entry.id, week1.event.id)).resolves.toEqual([]);
    expect((await repos().predictions.findByEntryAndEvent(entry.id, week2.event.id)).map((pick) => pick.sportEventMatchId))
      .toEqual([week2.game(1).id, week2.game(2).id]);
    // With its picks gone, the removed week's games can be deleted.
    await expect(getPrisma().sportEventMatch.deleteMany({ where: { sportEventId: week1.event.id } })).resolves.toMatchObject({ count: 3 });
  });
});
