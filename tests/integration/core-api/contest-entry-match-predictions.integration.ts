import { expect } from '@jest/globals';
import type { ContestEntryMatchPredictionWrite, LockedPredictionWeek } from '@poolmaster/shared/db';
import { randomUUID } from 'node:crypto';
import { ContestEntryStatus, ContestStatus, PredictedResult, Sport, contestEntryEventStatus, contestEntryEventTiebreaker } from '@poolmaster/shared/domain';
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
import { writePicks } from '../../support/prediction-writes';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { countingPrisma } from '../../support/counting-prisma';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { createContestRow } from '../../support/contest-rows';

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
    create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId: sport.id, name: 'NFL' } },
    create: { sportId: sport.id, name: 'NFL' },
    update: {},
  });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `${label} ${randomUUID()}` } });
  const event = await createSportEventRow(new PrismaSportEventRepository(prisma), {
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
  await createRoundRows(new PrismaSportEventRoundRepository(prisma), event.id, [{ roundNumber: 1, scheduledDate: startDate }]);
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
    data: { cupName: 'Test Cup', leagueCode: `CREPO${suffix.toUpperCase()}`, name: `Pickem Repo League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Pickers ${suffix}` } });
  const contest = await createContestRow(repos().contests, {
    leagueId: league.id,
    seasonYear: 2026,
    sportEventIds,
    name: `Confidence ${suffix}`,
    status: ContestStatus.OPEN,
    contestFormat: 'PREDICTION',
    selectionType: 'PICK_EM',
  });
  const result = await repos().entries.create({ contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Pickers', tiebreakerValue: null }, { entriesPerContest: () => null });
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

    await writePicks(repos().predictions, {
      contestEntryId: entry.id,
      sportEventId: event.id,
      saves: [3, 1, 2].map((matchNumber) => ({
        sportEventMatchId: game(matchNumber).id,
        predictedResult: PredictedResult.TEAM,
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

  it('replaces the entry\'s pick on a game it saves again with the new pick alone, stamping the new pickedAt', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const first = game(1);
    const save = (sportEventParticipantId: string, confidence: number | null, at: Date) => writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at,
      saves: [{ sportEventMatchId: first.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId, confidence }],
    });

    await save(expectDefined(first.homeSportEventParticipantId), 2, AT);
    await save(expectDefined(first.awaySportEventParticipantId), null, LATER);
    const after = await repos().predictions.findByEntryAndEvent(entry.id, event.id);

    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      sportEventParticipantId: first.awaySportEventParticipantId,
      confidence: null,
      pickedAt: LATER,
    });
  });

  it('saves a full slate of picks, replacing earlier ones, in the same number of queries as one pick (#1254)', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry: oneGame } = await createPickEmEntry([event.id]);
    const { entry: fullSlate } = await createPickEmEntry([event.id]);
    const counted = countingPrisma(getPrisma());
    const predictions = new PrismaContestEntryMatchPredictionRepository(counted.prisma);
    const saveOn = (contestEntryId: string, matchNumbers: readonly number[], at: Date) => writePicks(predictions, {
      contestEntryId,
      sportEventId: event.id,
      saves: matchNumbers.map((matchNumber) => ({
        sportEventMatchId: game(matchNumber).id,
        predictedResult: PredictedResult.TEAM,
        sportEventParticipantId: expectDefined(game(matchNumber).awaySportEventParticipantId),
        confidence: matchNumber,
      })),
      clearedMatchIds: [],
      eventStatus: ContestEntryStatus.DRAFT,
      at,
    });
    await writePicks(repos().predictions, {
      contestEntryId: fullSlate.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT,
      saves: [{ sportEventMatchId: game(1).id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game(1).homeSportEventParticipantId), confidence: 1 }],
    });

    await saveOn(oneGame.id, [1], LATER);
    const oneGameQueries = counted.total();
    await saveOn(fullSlate.id, [1, 2, 3], LATER);
    const fullSlateQueries = counted.total() - oneGameQueries;

    expect(fullSlateQueries).toBe(oneGameQueries);
    expect(counted.count('ContestEntryMatchPrediction.upsert')).toBe(0);
    const picks = await repos().predictions.findByEntryAndEvent(fullSlate.id, event.id);
    expect(picks.map((pick) => [pick.sportEventMatchId, pick.sportEventParticipantId, pick.confidence, pick.pickedAt])).toEqual(
      [1, 2, 3].map((matchNumber) => [game(matchNumber).id, game(matchNumber).awaySportEventParticipantId, matchNumber, LATER]),
    );
  });

  it.each([
    ['that all move the entry\'s week to draft', [ContestEntryStatus.DRAFT, ContestEntryStatus.DRAFT, ContestEntryStatus.DRAFT, ContestEntryStatus.DRAFT, ContestEntryStatus.DRAFT]],
    ['that all leave the entry\'s week as it is', [null, null, null, null, null]],
    ['of both kinds', [ContestEntryStatus.DRAFT, null, ContestEntryStatus.DRAFT, null, ContestEntryStatus.DRAFT]],
  ] as const)('runs overlapping saves to one entry\'s same games %s one after the other, each succeeding and one save\'s picks standing (#1254)', async (_, eventStatuses) => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const save = (eventStatus: ContestEntryStatus | null, index: number) => writePicks(repos().predictions, {
      contestEntryId: entry.id,
      sportEventId: event.id,
      saves: [1, 2, 3].map((matchNumber) => ({
        sportEventMatchId: game(matchNumber).id,
        predictedResult: PredictedResult.TEAM,
        sportEventParticipantId: expectDefined(game(matchNumber).homeSportEventParticipantId),
        confidence: index + 1,
      })),
      clearedMatchIds: [],
      eventStatus,
      at: LATER,
    });

    await Promise.all(eventStatuses.map(save));

    const picks = await repos().predictions.findByEntryAndEvent(entry.id, event.id);
    expect(picks.map((pick) => pick.sportEventMatchId)).toEqual([1, 2, 3].map((matchNumber) => game(matchNumber).id));
    expect(new Set(picks.map((pick) => pick.confidence)).size).toBe(1);
  });

  it('hands decide the week as it stands under the lock, in game order with the entry\'s row for the event, and answers with the change written and the week it left (#1268)', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const homePick = (matchNumber: number) => ({
      sportEventMatchId: game(matchNumber).id,
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: expectDefined(game(matchNumber).homeSportEventParticipantId),
      confidence: null,
    });
    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, saves: [homePick(3), homePick(1)], clearedMatchIds: [], eventStatus: null, tiebreakerValue: 41, at: AT,
    });
    const seen: LockedPredictionWeek[] = [];

    const { written, week: after } = await repos().predictions.save({
      contestEntryId: entry.id,
      sportEventId: event.id,
      at: LATER,
      decide: (week) => {
        seen.push(week);
        return { saves: [homePick(2)], clearedMatchIds: [game(3).id], eventStatus: ContestEntryStatus.SUBMITTED };
      },
    });

    expect(seen.map((week) => ({ games: week.predictions.map((pick) => pick.sportEventMatchId), event: week.event }))).toEqual([
      { games: [game(1).id, game(3).id], event: { sportEventId: event.id, status: ContestEntryStatus.DRAFT, submittedAt: undefined, tiebreakerValue: 41 } },
    ]);
    expect(written).toEqual({ saves: [homePick(2)], clearedMatchIds: [game(3).id], eventStatus: ContestEntryStatus.SUBMITTED });
    expect(after.predictions.map((pick) => pick.sportEventMatchId)).toEqual([game(1).id, game(2).id]);
    expect(after.event).toEqual({ sportEventId: event.id, status: ContestEntryStatus.SUBMITTED, submittedAt: LATER, tiebreakerValue: 41 });
    expect(after.predictions).toEqual(await repos().predictions.findByEntryAndEvent(entry.id, event.id));
  });

  it('writes no pick and no status when decide answers null, answering with no change and the week as it stood (#1268)', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT,
      saves: [{ sportEventMatchId: game(2).id, predictedResult: PredictedResult.TIE, sportEventParticipantId: null, confidence: null }],
    });
    const stored = await repos().predictions.findByEntryAndEvent(entry.id, event.id);

    const { written, week: after } = await repos().predictions.save({ contestEntryId: entry.id, sportEventId: event.id, at: LATER, decide: () => null });

    expect(written).toBeNull();
    expect(after).toEqual({ predictions: stored, event: { sportEventId: event.id, status: ContestEntryStatus.DRAFT, submittedAt: undefined, tiebreakerValue: undefined } });
    expect(await repos().predictions.findByEntryAndEvent(entry.id, event.id)).toEqual(stored);
  });

  it('writes none of a change when decide refuses it, the entry\'s update time included (#1268)', async () => {
    const { event } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const before = await getPrisma().contestEntry.findUniqueOrThrow({ where: { id: entry.id } });

    await expect(repos().predictions.save({
      contestEntryId: entry.id,
      sportEventId: event.id,
      at: LATER,
      decide: () => {
        throw new Error('refused');
      },
    })).rejects.toThrow('refused');

    expect(await repos().predictions.findByEntryAndEvent(entry.id, event.id)).toEqual([]);
    expect((await getPrisma().contestEntry.findUniqueOrThrow({ where: { id: entry.id } })).updatedAt).toEqual(before.updatedAt);
  });

  it('says whether any entry has picked a game, so a picked game\'s spread stays fixed (#720)', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT,
      saves: [{ sportEventMatchId: game(2).id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game(2).homeSportEventParticipantId), confidence: null }],
    });

    await expect(repos().predictions.hasAnyOnMatch(game(2).id)).resolves.toBe(true);
    await expect(repos().predictions.hasAnyOnMatch(game(1).id)).resolves.toBe(false);
  });

  it('clears only the games named, leaving the entry\'s other picks', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT,
      saves: [1, 2, 3].map((matchNumber) => ({
        sportEventMatchId: game(matchNumber).id,
        predictedResult: PredictedResult.TEAM,
        sportEventParticipantId: expectDefined(game(matchNumber).awaySportEventParticipantId),
        confidence: null,
      })),
    });

    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, saves: [], clearedMatchIds: [game(2).id], eventStatus: null, at: LATER,
    });

    expect((await repos().predictions.findByEntryAndEvent(entry.id, event.id)).map((pick) => pick.sportEventMatchId))
      .toEqual([game(1).id, game(3).id]);
  });

  it('stamps submittedAt when the week is set SUBMITTED, clears it when set back to DRAFT, and leaves the status alone when none is given', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const pick = { sportEventMatchId: game(1).id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game(1).homeSportEventParticipantId), confidence: null };
    const reread = async () => weekStatus(expectDefined(await repos().entries.findByIdWithSquad(entry.id)), event.id);

    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, saves: [], clearedMatchIds: [], eventStatus: ContestEntryStatus.SUBMITTED, at: AT });
    expect(await reread()).toEqual({ status: ContestEntryStatus.SUBMITTED, submittedAt: AT });

    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, saves: [pick], clearedMatchIds: [], eventStatus: null, at: LATER });
    expect(await reread()).toEqual({ status: ContestEntryStatus.SUBMITTED, submittedAt: AT });

    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, saves: [], clearedMatchIds: [game(1).id], eventStatus: ContestEntryStatus.DRAFT, at: LATER });
    expect(await reread()).toEqual({ status: ContestEntryStatus.DRAFT, submittedAt: null });
  });

  it('reads only the asked-about event\'s picks of an entry playing two weeks', async () => {
    const week1 = await createWeek('Week 1', AT);
    const week2 = await createWeek('Week 2', LATER);
    const { entry } = await createPickEmEntry([week1.event.id, week2.event.id]);
    for (const week of [week1, week2]) {
      await writePicks(repos().predictions, {
        contestEntryId: entry.id, sportEventId: week.event.id, clearedMatchIds: [], eventStatus: null, at: AT,
        saves: [{ sportEventMatchId: week.game(1).id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(week.game(1).homeSportEventParticipantId), confidence: null }],
      });
    }

    expect((await repos().predictions.findByEntryAndEvent(entry.id, week2.event.id)).map((pick) => pick.sportEventMatchId))
      .toEqual([week2.game(1).id]);
  });

  it('writes none of a save when one pick breaks a database check, status included', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);

    await expect(writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: ContestEntryStatus.SUBMITTED, at: AT,
      saves: [
        { sportEventMatchId: game(1).id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game(1).homeSportEventParticipantId), confidence: 1 },
        { sportEventMatchId: game(2).id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game(2).homeSportEventParticipantId), confidence: 0 },
      ],
    })).rejects.toThrow();

    await expect(repos().predictions.findByEntryAndEvent(entry.id, event.id)).resolves.toEqual([]);
    expect(weekStatus(expectDefined(await repos().entries.findByIdWithSquad(entry.id)), event.id).status).toBe(ContestEntryStatus.DRAFT);
  });
});

describe('PrismaContestEntryMatchPredictionRepository — several entries and the tiebreaker (#721, #717)', () => {
  /** A second entry in the same contest, on a new squad of its league. */
  async function secondEntry(contest: { id: string; leagueId: string }, name: string) {
    const prisma = getPrisma();
    const creator = await prisma.leagueMembership.findFirstOrThrow({ where: { leagueId: contest.leagueId } });
    const squad = await prisma.squad.create({ data: { leagueId: contest.leagueId, createdBy: creator.userId, name: `${name} ${randomUUID().slice(0, 6)}` } });
    const result = await repos().entries.create({ contestId: contest.id, squadId: squad.id, entryNumber: 1, name, tiebreakerValue: null }, { entriesPerContest: () => null });
    if (result.status !== 'created') throw new Error(`seed: entry refused (${result.status})`);
    return result.entry;
  }

  const homePick = (game: { id: string; homeSportEventParticipantId: string | null }) =>
    ({ sportEventMatchId: game.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game.homeSportEventParticipantId), confidence: null });

  it('reads several entries\' picks on one event by entry, each in game order, leaving out other entries and other events (#1315)', async () => {
    const week1 = await createWeek('Week 1', AT);
    const week2 = await createWeek('Week 2', LATER);
    const { contest, entry: first } = await createPickEmEntry([week1.event.id, week2.event.id]);
    const second = await secondEntry(contest, 'Second');
    const third = await secondEntry(contest, 'Third');
    for (const entry of [first, second, third]) {
      await writePicks(repos().predictions, {
        contestEntryId: entry.id, sportEventId: week1.event.id, clearedMatchIds: [], eventStatus: null, at: AT,
        saves: [homePick(week1.game(2)), homePick(week1.game(1))],
      });
    }
    await writePicks(repos().predictions, {
      contestEntryId: first.id, sportEventId: week2.event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves: [homePick(week2.game(1))],
    });

    const picks = await repos().predictions.findByEntriesAndEvent([second.id, first.id], week1.event.id);

    const [lower, higher] = [first.id, second.id].sort();
    expect(picks.map((pick) => [pick.sportEventMatchId, pick.contestEntryId])).toEqual([
      [week1.game(1).id, lower],
      [week1.game(2).id, lower],
      [week1.game(1).id, higher],
      [week1.game(2).id, higher],
    ]);
  });

  it('reads several entries\' picks across the asked-about events, each with its event and its team, leaving out other entries and events (#719)', async () => {
    const week1 = await createWeek('Week 1', AT);
    const week2 = await createWeek('Week 2', LATER);
    const week3 = await createWeek('Week 3', LATER);
    const { contest, entry: first } = await createPickEmEntry([week1.event.id, week2.event.id, week3.event.id]);
    const second = await secondEntry(contest, 'Second');
    const third = await secondEntry(contest, 'Third');
    const save = (entryId: string, week: { event: { id: string } }, game: { id: string; homeSportEventParticipantId: string | null }) =>
      writePicks(repos().predictions, { contestEntryId: entryId, sportEventId: week.event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves: [homePick(game)] });
    await save(first.id, week1, week1.game(1));
    await save(first.id, week2, week2.game(2));
    await save(first.id, week3, week3.game(3));
    await save(second.id, week1, week1.game(3));
    await save(third.id, week1, week1.game(2));

    const picks = await repos().predictions.findByEntriesAndEvents([first.id, second.id], [week1.event.id, week2.event.id]);

    const field = await new PrismaSportEventParticipantRepository(getPrisma()).findBySportEvent(week1.event.id);
    const participantOf = (fieldRowId: string | null) => expectDefined(field.find((row) => row.id === fieldRowId)).participantId;
    const key = (row: readonly string[]) => row.join(':');
    expect(picks.map((pick) => key([pick.contestEntryId, pick.sportEventId, pick.sportEventMatchId])).sort((left, right) => left.localeCompare(right))).toEqual([
      key([first.id, week1.event.id, week1.game(1).id]),
      key([first.id, week2.event.id, week2.game(2).id]),
      key([second.id, week1.event.id, week1.game(3).id]),
    ].sort((left, right) => left.localeCompare(right)));
    expect(picks.find((pick) => pick.contestEntryId === second.id)?.participantId).toBe(participantOf(week1.game(3).homeSportEventParticipantId));
    await expect(repos().predictions.findByEntriesAndEvents([], [week1.event.id])).resolves.toEqual([]);
  });

  it('saves a tie pick naming no team, reads it back as a tie on one event and across events, and swaps it for a team pick (#792)', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const save = (saves: readonly ContestEntryMatchPredictionWrite[]) =>
      writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves });

    await save([{ sportEventMatchId: game(1).id, predictedResult: PredictedResult.TIE, sportEventParticipantId: null, confidence: null }]);

    expect(await repos().predictions.findByEntryAndEvent(entry.id, event.id)).toEqual([
      expect.objectContaining({ sportEventMatchId: game(1).id, predictedResult: PredictedResult.TIE, sportEventParticipantId: null }),
    ]);
    expect(await repos().predictions.findByEntriesAndEvents([entry.id], [event.id])).toEqual([
      expect.objectContaining({ sportEventId: event.id, predictedResult: PredictedResult.TIE, sportEventParticipantId: null, participantId: null }),
    ]);

    await save([homePick(game(1))]);
    expect(await repos().predictions.findByEntryAndEvent(entry.id, event.id)).toEqual([
      expect.objectContaining({ predictedResult: PredictedResult.TEAM, sportEventParticipantId: game(1).homeSportEventParticipantId }),
    ]);
  });

  it('reads no picks for no entries', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves: [homePick(game(1))] });

    await expect(repos().predictions.findByEntriesAndEvent([], event.id)).resolves.toEqual([]);
  });

  it('writes the tiebreaker onto the entry\'s row for the event with the picks, leaves it alone when a save gives none, and clears it with null', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);
    const tiebreaker = async () => contestEntryEventTiebreaker(expectDefined(await repos().entries.findByIdWithSquad(entry.id)), event.id);

    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves: [homePick(game(1))], tiebreakerValue: 141,
    });
    expect(await tiebreaker()).toBe(141);

    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: LATER, saves: [homePick(game(2))] });
    expect(await tiebreaker()).toBe(141);

    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: LATER, saves: [], tiebreakerValue: null });
    expect(await tiebreaker()).toBeNull();
    expect(expectDefined(await repos().entries.findByIdWithSquad(entry.id)).tiebreakerValue).toBeUndefined();
  });

  it('keeps each week\'s tiebreaker apart, and keeps it when the week\'s status changes', async () => {
    const week1 = await createWeek('Week 1', AT);
    const week2 = await createWeek('Week 2', LATER);
    const { entry } = await createPickEmEntry([week1.event.id, week2.event.id]);
    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: week1.event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves: [], tiebreakerValue: 41 });
    await writePicks(repos().predictions, { contestEntryId: entry.id, sportEventId: week2.event.id, clearedMatchIds: [], eventStatus: null, at: AT, saves: [], tiebreakerValue: 38 });
    await writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: week1.event.id, clearedMatchIds: [], eventStatus: ContestEntryStatus.SUBMITTED, at: LATER, saves: [],
    });

    const stored = expectDefined(await repos().entries.findByIdWithSquad(entry.id));
    expect(contestEntryEventTiebreaker(stored, week1.event.id)).toBe(41);
    expect(contestEntryEventTiebreaker(stored, week2.event.id)).toBe(38);
    expect(contestEntryEventStatus(stored, week1.event.id)).toBe(ContestEntryStatus.SUBMITTED);
  });

  it('writes no tiebreaker when a pick of the same save breaks a database check', async () => {
    const { event, game } = await createWeek('Week 1', AT);
    const { entry } = await createPickEmEntry([event.id]);

    await expect(writePicks(repos().predictions, {
      contestEntryId: entry.id, sportEventId: event.id, clearedMatchIds: [], eventStatus: null, at: AT, tiebreakerValue: 141,
      saves: [{ ...homePick(game(1)), confidence: 0 }],
    })).rejects.toThrow();

    expect(contestEntryEventTiebreaker(expectDefined(await repos().entries.findByIdWithSquad(entry.id)), event.id)).toBeNull();
  });
});

describe('contest_entry_match_predictions constraints', () => {
  async function seeded() {
    const week = await createWeek('Week 1', AT);
    const { contest, entry } = await createPickEmEntry([week.event.id]);
    const row = (confidence: number | null) => ({
      contestEntryId: entry.id,
      sportEventMatchId: week.game(1).id,
      predictedResult: PredictedResult.TEAM,
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

  it.each([
    ['a team pick naming no team', { predictedResult: PredictedResult.TEAM, sportEventParticipantId: null }],
    ['a tie pick naming a team', { predictedResult: PredictedResult.TIE }],
  ])('refuses %s with the team-with-team-result check (#792)', async (_label, choice) => {
    const { row } = await seeded();
    await expect(getPrisma().contestEntryMatchPrediction.create({ data: { ...row(null), ...choice } }))
      .rejects.toThrow(/contest_entry_match_predictions_team_with_team_result/);
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
      await writePicks(repos().predictions, {
        contestEntryId: entry.id, sportEventId: week.event.id, clearedMatchIds: [], eventStatus: null, at: AT,
        saves: [1, 2].map((matchNumber) => ({
          sportEventMatchId: week.game(matchNumber).id,
          predictedResult: PredictedResult.TEAM,
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
