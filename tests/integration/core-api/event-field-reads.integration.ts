import { testDomainEvents } from '../../support/domain-events';
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { GameSideStatus, MatchStatus, PeriodKind, Sport, SportEventStatus, gameNumbered, matchParticipantIds, matchSpread } from '@poolmaster/shared/domain';
import type { SportEventParticipantListResponse, SportEventParticipantResponse } from '@poolmaster/shared/dto';
import {
  PrismaFieldGameRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
} from '../../../packages/core-api/src/adapters';
import { createRoundRows } from '../../support/sport-event-rows';
import { writeGolfRounds } from '../golf-rounds';
import { createSportEventParticipantService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { recordStatements, statementCounts, statementParams, statementsOn, StatementVerb, type RecordedStatement } from '../statement-log';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';
import { passReadCacheTtl, restoreReadCacheClock } from '../../support/read-cache-clock';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { linkTestSlot } from '../../support/test-slots';
import { oneEventSlotId } from '../../support/test-slots';
import { createMatchRow } from '../../support/match-rows';
import { inTierSet, tierSetSlot } from '../../support/event-tier-sets';

// An event's field against real Postgres (#1163): read in one repository call on one connection,
// shared by every contest and pick screen on the event for 30 seconds, and read afresh once an
// admin write to the event answers. A write to one field row answers with that row alone.
// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());
afterEach(() => restoreReadCacheClock());

/**
 * A golf event two rounds in, with a field of three: Ana (seed 1), Bea (seed 2) and Cal
 * (unseeded). Ana and Bea are affiliated with the event's tour, Cal is invited from elsewhere.
 * Ana is priced and has played both rounds, entered here second round first, and stands first.
 */
async function golfEvent() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  const edition = await freshEventEdition(prisma);
  const { sportLeagueId } = edition;
  const event = await prisma.sportEvent.create({
    data: {
      ...edition,
      name: `Field Reads Open ${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: SportEventStatus.DRAFT,
    },
  });
  const [round2, round1] = [
    await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 2, scheduledDate: new Date('2026-05-08') } }),
    await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 1, scheduledDate: new Date('2026-05-07') } }),
  ];
  const golfer = async (name: string, seedNumber: number | null, affiliated: boolean) => {
    const participant = await prisma.participant.create({
      data: {
        // On the event's sport league's roster, or a participant of another league of the sport.
        sportLeagueId: affiliated ? sportLeagueId : await participantLeagueId(prisma, sport.id),
        name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE',
      },
    });
    return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, seedNumber, ranking: 10 } });
  };
  const cal = await golfer('Cal', null, false);
  const bea = await golfer('Bea', 2, true);
  const ana = await golfer('Ana', 1, true);
  await prisma.sportEventSlotParticipantValuation.create({ data: { ...inTierSet(await tierSetSlot(prisma, event.id)), sportEventParticipantId: ana.id, price: 12, priceAssignedSource: 'MANUAL' } });
  await writeGolfRounds(prisma, event.id, ([[round2, 70], [round1, 68]] as const).map(([round, strokes]) => ({
    roundNumber: round.roundNumber,
    scores: [{ sportEventParticipantId: ana.id, strokes, scoreToPar: strokes - 72 }],
  })));
  await prisma.sportEventParticipantStanding.create({
    data: { sportEventParticipantId: ana.id, position: 1, status: 'ACTIVE', scoreToPar: -6, total: 138 },
  });
  return { event, ana, bea, cal };
}

/** A draft event of `sport` on a fixture tour of its own, with a field of `names`, each a new participant of the sport. */
async function eventWithField(sport: Sport, names: readonly string[]) {
  const prisma = getPrisma();
  const sportRow = await prisma.sport.findUniqueOrThrow({ where: { sport } });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { sport })),
      name: `Field Reads ${sport} ${randomUUID().slice(0, 6)}`,
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      status: SportEventStatus.DRAFT,
    },
  });
  const field = [];
  for (const name of names) {
    const participant = await prisma.participant.create({
      data: { sportLeagueId: await participantLeagueId(prisma, sportRow.id), name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM', status: 'ACTIVE' },
    });
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } }));
  }
  return { event, field };
}

describe('An event\'s field', () => {
  it('is read in one call on the field table, each row with its participant, whether it is in the event league, price, standing and rounds in round order, seeded first', async () => {
    const { event, ana, bea, cal } = await golfEvent();

    const { result: field, statements } = await recordStatements(() => createSportEventParticipantService(getAppPrisma(), testDomainEvents()).listEventParticipants(event.id));

    // The event's own row, then the field and each of its relations in one statement: no read per
    // row, and nothing else. A field row's games are read through the match sides naming it (#2046);
    // a field with no matches reads no further. The event's FIELD matches (a race, a golf round,
    // #2008) are read first by the event, then their side results in one statement.
    expect(statementCounts(statements)).toEqual([
      // In the field's query, whether a tiered or budget template lists each of its event's slots,
      // which decides the slot whose set prices the field (#2044).
      ['SELECT contest_config_template_slots', 1],
      ['SELECT participants', 1],
      ['SELECT sport_event_participant_standings', 1],
      ['SELECT sport_event_participants', 1],
      ['SELECT sport_event_provider_mappings', 1],
      // The golfers' rounds: their side results in the rounds' FIELD Games (#2008), with each Game.
      ['SELECT sport_event_round_match_game_side_result_period_scores', 1],
      ['SELECT sport_event_round_match_game_side_results', 1],
      ['SELECT sport_event_round_match_games', 1],
      // Once for the head-to-head matches naming a row, once for the event's FIELD matches.
      ['SELECT sport_event_round_match_sides', 2],
      ['SELECT sport_event_round_matches', 2],
      ['SELECT sport_event_rounds', 1],
      // A field row's price is its event's tier-set slot's (#2044).
      ['SELECT sport_event_slot_participant_valuations', 1],
      // The event's slot definitions (#2010), where templates are offered; and in the field's own
      // query, its event's slots in their places in play, one of which prices the field (#2044).
      ['SELECT sport_event_slots', 2],
      ['SELECT sport_events', 2],
      // The event's rounds are played in its slot (#2006): the slot's definition and its place in
      // play, read for the event and again in the field's query.
      ['SELECT sport_league_competition_slots', 2],
      ['SELECT sport_league_competitions', 1],
      ['SELECT sport_league_phases', 1],
      ['SELECT sport_league_season_competition_slots', 2],
      ['SELECT sport_league_seasons', 1],
      ['SELECT sport_leagues', 1],
      // The event's sport, read through its league (#2042).
      ['SELECT sports', 1],
    ]);
    expect(field.map((row) => [row.entry.id, row.affiliatedWithSportLeague])).toEqual([[ana.id, true], [bea.id, true], [cal.id, false]]);
    const [anaRow, beaRow] = field;
    expect(anaRow.valuation).toMatchObject({ price: 12 });
    expect(anaRow.standing).toMatchObject({ position: 1, scoreToPar: -6, total: 138 });
    // Each golf round is the golfer's side result in that round's FIELD Game (#2008), in round order.
    expect(anaRow.fieldResults.map(({ roundNumber, result }) => [roundNumber, result.score, result.scoreToPar])).toEqual([[1, 68, -4], [2, 70, -2]]);
    expect(anaRow.matches).toEqual([]);
    expect(beaRow).toMatchObject({ valuation: null, standing: null, fieldResults: [] });
  });

  it('is read once for every contest and pick screen on the event within 30 seconds, and again after', async () => {
    const { event } = await golfEvent();
    const contestReads = createSportEventParticipantService(getAppPrisma(), testDomainEvents());
    const pickScreenReads = createSportEventParticipantService(getAppPrisma(), testDomainEvents());
    const fieldReads = (statements: readonly RecordedStatement[]) => statementsOn(statements, StatementVerb.SELECT, 'sport_event_participants');

    const shared = await recordStatements(async () => {
      await contestReads.listCachedEventParticipants(event.id);
      await pickScreenReads.listCachedEventParticipants(event.id);
    });
    passReadCacheTtl();
    const afterTtl = await recordStatements(() => pickScreenReads.listCachedEventParticipants(event.id));

    expect(fieldReads(shared.statements)).toHaveLength(1);
    expect(fieldReads(afterTtl.statements)).toHaveLength(1);
  });

  it('is read afresh as soon as an admin write to the event answers, so the next poll shows the change', async () => {
    const { event, bea } = await golfEvent();
    const admin = await createTestUser({ isRootAdmin: true });
    const readField = async () => (await getApp().inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/participants`,
      headers: admin.headers,
    })).json<SportEventParticipantListResponse>().participants;

    await readField();
    const saved = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/participants`,
      headers: admin.headers,
      payload: { participants: [{ sportEventParticipantId: bea.id, ranking: 3 }] },
    });
    const polled = await readField();

    expect(saved.statusCode).toBe(200);
    expect(polled.find((row) => row.id === bea.id)?.ranking).toBe(3);
  });

  it('is read afresh once a participant on it is renamed, or the event\'s sport league re-ranks one, so the next poll shows it', async () => {
    const { event, ana, bea } = await golfEvent();
    const { sportLeagueId } = event;
    const admin = await createTestUser({ isRootAdmin: true });
    const readField = async () => (await getApp().inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/participants`,
      headers: admin.headers,
    })).json<SportEventParticipantListResponse>().participants;

    await readField();
    const renamed = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/participants/${ana.participantId}`,
      headers: admin.headers,
      payload: { name: 'Ana Renamed' },
    });
    const afterRename = await readField();
    const ranked = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/sport-leagues/${sportLeagueId}/participants/rankings`,
      headers: admin.headers,
      payload: { rankings: [{ participantId: bea.participantId, ranking: 4 }] },
    });
    const afterRanking = await readField();

    expect([renamed.statusCode, ranked.statusCode]).toEqual([200, 200]);
    expect(afterRename.find((row) => row.id === ana.id)?.participant.name).toBe('Ana Renamed');
    expect(afterRanking.find((row) => row.id === bea.id)?.participant.ranking).toBe(4);
  });
});

// The relations of the families golf leaves empty, against real Postgres: what the field read
// gives each row is what the per-table reads it replaced gave (#1163).
describe('An event\'s field, for every scoring family', () => {
  it('gives each team the bracket matches naming it on either side, in match order, as the event\'s match read gives them', async () => {
    const prisma = getPrisma();
    const { event, field: [duke, unc, kansas, baylor] } = await eventWithField(Sport.BASKETBALL, ['Duke', 'UNC', 'Kansas', 'Baylor']);
    const sportEventSlotId = await oneEventSlotId(prisma, event.id);
    const [round1, round2] = await Promise.all([1, 2].map((roundNumber) => prisma.sportEventRound.create({
      data: { sportEventId: event.id, sportEventSlotId, roundNumber, scheduledDate: new Date(`2026-03-${19 + roundNumber}`) },
    })));
    // Duke is on side 1 of match 1 and side 2 of match 2; written match 2 first.
    const match2 = await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: round2.id, sportEventSlotId, matchNumber: 2, teams: [null, duke.id], isNeutralSite: true });
    const match1 = await createMatchRow(prisma, {
      sportEventId: event.id, sportEventRoundId: round1.id, sportEventSlotId, matchNumber: 1, teams: [duke.id, unc.id], isNeutralSite: true,
      result: { winnerSideNumber: 1, scores: [75, 70] },
    });
    await prisma.sportEventRoundMatch.update({ where: { id: match1.id }, data: { advancesToMatchId: match2.id, advancesToSideNumber: 2 } });
    const matchRepo = new PrismaSportEventRoundMatchRepository(getAppPrisma());
    await matchRepo.update(match1.id, { spread: 3.5 });
    const gameOne = await prisma.sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventRoundMatchId: match1.id, gameNumber: 1 } });
    await matchRepo.saveGamePeriodScores({
      sportEventRoundMatchId: match1.id,
      gameId: gameOne.id,
      sides: [
        { sideNumber: 1, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber: 2, score: 37 }, { kind: PeriodKind.REGULAR, periodNumber: 1, score: 38 }] },
        { sideNumber: 2, periodScores: [{ kind: PeriodKind.REGULAR, periodNumber: 2, score: 40 }, { kind: PeriodKind.REGULAR, periodNumber: 1, score: 30 }] },
      ],
    });
    await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: round1.id, sportEventSlotId, matchNumber: 3, teams: [baylor.id, kansas.id], isNeutralSite: true });

    const rows = await createSportEventParticipantService(getAppPrisma(), testDomainEvents()).listEventParticipants(event.id);
    const matches = await matchRepo.findBySportEvent(event.id);

    const dukeRow = rows.find((row) => row.entry.id === duke.id);
    expect(dukeRow?.matches.map((match) => [match.matchNumber, match.roundNumber])).toEqual([[1, 1], [2, 2]]);
    const first = expectDefined(dukeRow?.matches[0]);
    expect(matchSpread(first)).toBe(3.5);
    expect(expectDefined(gameNumbered(first, 1)).sideResults.map((result) => [result.sideNumber, result.periodScores.map((period) => period.score)])).toEqual([[1, [38, 37]], [2, [30, 40]]]);
    for (const row of rows) {
      expect(row.matches).toEqual(matches.filter((match) => (
        matchParticipantIds(match).includes(row.entry.id)
      )));
    }
  });

  it('gives a runner its race result on the race\'s FIELD Game once one is entered, and none to a runner without one, as the event\'s race read gives them', async () => {
    const prisma = getPrisma();
    const { event, field: [winner, scratched, unplaced] } = await eventWithField(Sport.HORSE_RACING, ['Secretariat', 'Sham', 'Twice A Prince']);
    await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: event.startDate }]);
    const fieldGames = new PrismaFieldGameRepository(getAppPrisma());
    const raced = { score: null, scoreToPar: null, periodsCompleted: null };
    await fieldGames.applyResults(event.id, {
      games: [{
        roundNumber: 1,
        status: MatchStatus.COMPLETED,
        completedAt: new Date('2026-05-07T12:05:00.000Z'),
        sides: [
          { ...raced, sportEventParticipantId: winner.id, position: 1, startPosition: 2, status: GameSideStatus.FINISHED },
          { ...raced, sportEventParticipantId: scratched.id, position: null, startPosition: null, status: GameSideStatus.DID_NOT_START },
        ],
      }],
      standings: [],
    });

    const rows = await createSportEventParticipantService(getAppPrisma(), testDomainEvents()).listEventParticipants(event.id);
    const results = await fieldGames.findResults(event.id);

    const byRow = new Map(rows.map((row) => [row.entry.id, row]));
    expect(byRow.get(winner.id)?.fieldResults.map(({ roundNumber, gameStatus, result }) => [roundNumber, gameStatus, result.position, result.startPosition, result.status]))
      .toEqual([[1, MatchStatus.COMPLETED, 1, 2, GameSideStatus.FINISHED]]);
    expect(byRow.get(scratched.id)?.fieldResults.map(({ result }) => [result.position, result.status])).toEqual([[null, GameSideStatus.DID_NOT_START]]);
    expect(byRow.get(unplaced.id)?.fieldResults).toEqual([]);
    // The race's FIELD match is not one of a runner's head-to-head matches.
    expect(rows.flatMap((row) => row.matches)).toEqual([]);
    for (const row of rows) {
      const result = results.find((entry) => entry.sportEventParticipantId === row.entry.id);
      expect(row.fieldResults.map(({ result: side }) => side.position)).toEqual(result ? [result.position] : []);
    }
  });
  it('reads a head-to-head event\'s field without looking up FIELD matches: the matches are read once, as the ones naming its rows (#2227)', async () => {
    const prisma = getPrisma();
    const { event, field: [duke, unc] } = await eventWithField(Sport.BASKETBALL, ['Duke', 'UNC']);
    const sportEventSlotId = await oneEventSlotId(prisma, event.id);
    const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber: 1, scheduledDate: new Date('2026-03-20') } });
    await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: round.id, sportEventSlotId, matchNumber: 1, teams: [duke.id, unc.id], isNeutralSite: true });

    const { result: rows, statements } = await recordStatements(() => createSportEventParticipantService(getAppPrisma(), testDomainEvents()).listEventParticipants(event.id));

    // The event's slot definitions say none of its slots plays FIELD, so the field read reads no
    // FIELD match ids first: its one read of the matches is the include of the match sides naming its rows.
    expect(statementsOn(statements, StatementVerb.SELECT, 'sport_event_round_matches')).toHaveLength(1);
    expect(rows.map((row) => row.matches.length)).toEqual([1, 1]);
  });
});

describe('A write to one field row', () => {
  it('reads that row alone to answer, with the values the whole field read gives it', async () => {
    const { event, ana } = await golfEvent();
    const service = createSportEventParticipantService(getAppPrisma(), testDomainEvents());

    const { result: row, statements } = await recordStatements(() => service.getEventParticipant(event.id, ana.id));

    const fieldReads = statementsOn(statements, StatementVerb.SELECT, 'sport_event_participants');
    expect(fieldReads).toHaveLength(1);
    expect(statementParams(expectDefined(fieldReads[0]))).toContain(ana.id);
    expect(expectDefined(fieldReads[0]).sql).toContain('LIMIT');
    const [fromField] = await createSportEventParticipantService(getAppPrisma(), testDomainEvents()).listEventParticipants(event.id);
    expect(row).toEqual(fromField);
  });

  it('answers a golf score correction with the corrected golfer alone', async () => {
    const { event, ana } = await golfEvent();
    // The admin score correction writes only on a test event (#2074).
    await linkTestSlot(getPrisma(), event);
    const admin = await createTestUser({ isRootAdmin: true });

    const res = await getApp().inject({
      method: 'PATCH',
      url: `/api/v1/events/${event.id}/rounds/1/golf-scores/${ana.id}`,
      headers: admin.headers,
      payload: { strokes: 67, scoreToPar: -5 },
    });

    expect(res.statusCode).toBe(200);
    const { participant } = res.json<SportEventParticipantResponse>();
    expect(participant.id).toBe(ana.id);
    expect(participant.rounds.map((round) => [round.roundNumber, round.golf?.strokes])).toEqual([[1, 67], [2, 70]]);
  });
});
