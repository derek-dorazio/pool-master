import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptInvitation,
  claimSquaresBox,
  clearSquaresBox,
  createContest,
  drawSquaresNumbers,
  enterContest,
  generateInviteLink,
  getContest,
  getEventBracket,
  getSquaresBoard,
  listContestConfigTemplates,
  listEvents,
  listSportLeagues,
  openContest,
  recordEventMatchPeriodScore,
  recordEventMatchResult,
  transitionEvent,
  listEventSquaresGames,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, isAtPlace, MatchSide, matchPlaceOf, PeriodUnit, SelectionType, Sport } from '@poolmaster/shared/domain';
import { SquaresBoardResponseSchema, SquaresGameChoicesResponseSchema } from '@poolmaster/shared/dto';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, inCurrentSeason, promoteToRootAdmin, seasonEvents } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { EVERY_GAME_PLAYED, oneEventOf } from '../support/sport-test-seed';
import { sportRowKeys } from '../support/sport-rows';
import { periodBody, resultBody, withHomeAwayRead } from '../support/match-requests';
import { squaresGameIdOf } from './squares-games';

// Super Bowl squares end to end over HTTP (#711): the NFL playoffs test seed loads with its Super
// Bowl still to play. A commissioner runs a squares contest on it from the NFL's squares preset,
// two members claim boxes, the commissioner draws the numbers, an admin enters the quarter scores
// and the final, and the contest settles with the game: each quarter's box wins, and the entries
// are placed by the quarters they won.

const RUN = `squares-${Date.now()}`;
const SEED_FILE = join(__dirname, '../../packages/core-api/scripts/seed-golf/american-football-2026-nfl-playoffs-test.json');
/** The Super Bowl's place: round 4's match 1, as each round numbers its games from 1 (#2161). */
const SUPER_BOWL = { roundNumber: 4, matchNumber: 1 };

const created = { sportEventIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  // The run's players, read before its fields go (the loader finds a player by name, #2040).
  const runParticipantIds = (await db.sportEventParticipant.findMany({ where: { sportEventId: { in: eventIds } }, select: { participantId: true } }))
    .map((row) => row.participantId);
  if (eventIds.length) {
    await db.contestSquaresGame.deleteMany({ where: { game: { sportEventId: { in: eventIds } } } });
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventSlotParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  // Only those no other event's field still holds.
  await db.participant.deleteMany({ where: { id: { in: runParticipantIds }, sportEventParticipants: { none: {} } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Super Bowl squares', () => {
  it('runs a squares contest on the Super Bowl from claiming boxes to settled winners, each quarter\'s box winning', async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.FOOTBALL },
      create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Squares Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;

    // --- The test seed, its Super Bowl not yet played ---------------------------------------------
    const file = parseSportDataFile(JSON.parse(readFileSync(SEED_FILE, 'utf8')) as unknown);
    const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
    const [playoffs] = file.sportLeagues[0].events;
    playoffs.name = `NFL Playoffs ${RUN}`;
    for (const player of file.sportLeagues[0].players) player.key = expectDefined(tagged(player.key));
    for (const entry of playoffs.field) entry.player = expectDefined(tagged(entry.player));
    for (const match of playoffs.matches ?? []) match.sides = match.sides.map((side) => ({ ...side, player: tagged(side.player) }));
    const superBowlRow = expectDefined((playoffs.matches ?? []).find((match) => isAtPlace(match, SUPER_BOWL)));
    delete superBowlRow.result;
    delete superBowlRow.periodScores;
    // The loader makes the event in the NFL's current Season; another suite may have moved it.
    await inCurrentSeason((await getFunctionalPrisma().sportLeague.findFirstOrThrow({ where: { name: 'NFL', displayOrder: { not: null } }, select: { id: true } })).id, 2026);
    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED });

    const nfl = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'NFL'));
    const event = expectDefined((await seasonEvents(a, nfl.id, 2026))
      .find((row) => row.name === playoffs.name));
    created.sportEventIds.add(event.id);
    const superBowl = expectDefined(expectDefined((await getEventBracket({ client: a, path: { eventId: event.id } })).data).matches.map(withHomeAwayRead)
      .find((match) => isAtPlace(match, SUPER_BOWL)));
    expect([superBowl.status, superBowl.homeScore]).toEqual(['SCHEDULED', null]);

    // --- The league, and a squares contest from the NFL's squares preset ----------------------------
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Squares Commissioner', leagueName: `Squares ${RUN}` });
    const [alice, bob] = await Promise.all(['Squares Alice', 'Squares Bob'].map((displayName) => buildRegisteredUser({ displayName })));
    for (const member of [alice, bob]) {
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    }
    const [preset] = expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sportLeagueId: nfl.id, active: true },
    })).data).templates
      .filter((template) => template.contestFormat === ContestFormat.SQUARES);
    expect([preset.templateKey, preset.isDefault]).toEqual(['nfl-squares', true]);

    // The API lists the Games a squares contest can be played on, the Super Bowl's first and its default (#2050).
    const choices = expectMatchesSchema(SquaresGameChoicesResponseSchema, (await listEventSquaresGames({ client: commissioner.client, path: { eventId: event.id } })).data);
    const [firstChoice] = choices.games;
    expect([firstChoice.match.id, firstChoice.gameNumber]).toEqual([superBowl.id, 1]);
    expect(choices.defaultSportEventRoundMatchGameId).toBe(firstChoice.sportEventRoundMatchGameId);
    expect(choices.games.every((choice) => choice.match.status === 'SCHEDULED')).toBe(true);
    const superBowlGameId = firstChoice.sportEventRoundMatchGameId;
    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Super Bowl Squares ${RUN}`,
        sportEventIds: [event.id],
        sportEventRoundMatchGameId: superBowlGameId,
        contestFormat: ContestFormat.SQUARES,
        selectionType: SelectionType.SQUARES,
        templateId: preset.id,
      },
    });
    expect(contest.response?.status).toBe(201);
    const contestId = expectDefined(contest.data).contest.id;
    // Rules sent as the configuration, as Create contest sends them, are taken as they are: the
    // request's rules union must not strip the box limit while it tries the other selection types.
    const configured = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Configured Squares ${RUN}`,
        sportEventIds: [event.id],
        sportEventRoundMatchGameId: superBowlGameId,
        contestFormat: ContestFormat.SQUARES,
        selectionType: SelectionType.SQUARES,
        templateId: preset.id,
        configuration: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 7, maxEntriesPerSquad: 1 },
      },
    });
    expect([configured.response?.status, configured.error?.error.message]).toEqual([201, undefined]);
    // A draft is the commissioner's alone.
    expect((await getSquaresBoard({ client: alice.client, path: { contestId } })).response?.status).toBe(404);
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    // --- Claiming boxes ------------------------------------------------------------------------------
    const aliceEntry = expectDefined((await enterContest({ client: alice.client, path: { contestId } })).data).entry.id;
    const bobEntry = expectDefined((await enterContest({ client: bob.client, path: { contestId } })).data).entry.id;
    const box = (rowIndex: number, columnIndex: number) => ({ contestId, rowIndex, columnIndex });
    // Alice holds the whole top row, Bob the whole left column but its top box.
    for (let column = 0; column < 10; column += 1) {
      expect((await claimSquaresBox({ client: alice.client, path: box(0, column), body: { contestEntryId: aliceEntry } })).response?.status).toBe(200);
    }
    expect((await claimSquaresBox({ client: alice.client, path: box(1, 1), body: { contestEntryId: aliceEntry } })).error?.error.code).toBe('SQUARES_BOX_LIMIT_REACHED');
    expect((await claimSquaresBox({ client: bob.client, path: box(0, 0), body: { contestEntryId: bobEntry } })).error?.error.code).toBe('SQUARES_BOX_TAKEN');
    expect((await claimSquaresBox({ client: bob.client, path: box(1, 0), body: { contestEntryId: aliceEntry } })).response?.status).toBe(403);
    for (let row = 1; row < 10; row += 1) {
      // The commissioner claims Bob's last box for him.
      const claimant = row === 9 ? commissioner.client : bob.client;
      expect((await claimSquaresBox({ client: claimant, path: box(row, 0), body: { contestEntryId: bobEntry } })).response?.status).toBe(200);
    }
    // Cleared and claimed again, the box is Bob's as before.
    expect((await clearSquaresBox({ client: bob.client, path: box(5, 0) })).response?.status).toBe(200);
    const claimed = expectMatchesSchema(SquaresBoardResponseSchema, (await claimSquaresBox({ client: bob.client, path: box(5, 0), body: { contestEntryId: bobEntry } })).data);
    expect(claimed.boxes).toHaveLength(19);
    expect([claimed.claimsOpen, claimed.drawOpen, claimed.digits]).toEqual([true, true, null]);

    // --- The draw ------------------------------------------------------------------------------------
    expect((await drawSquaresNumbers({ client: alice.client, path: { contestId } })).response?.status).toBe(403);
    const drawn = expectMatchesSchema(SquaresBoardResponseSchema, (await drawSquaresNumbers({ client: commissioner.client, path: { contestId } })).data);
    const digits = expectDefined(drawn.digits ?? undefined);
    expect([...digits.rowDigits].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([drawn.claimsOpen, drawn.drawOpen]).toEqual([false, false]);
    expect((await drawSquaresNumbers({ client: commissioner.client, path: { contestId } })).error?.error.code).toBe('SQUARES_ALREADY_DRAWN');
    expect((await claimSquaresBox({ client: bob.client, path: box(9, 9), body: { contestEntryId: bobEntry } })).error?.error.code).toBe('SQUARES_CLAIMING_CLOSED');

    // --- The game: three quarters, then the final --------------------------------------------------
    // Scores chosen from the drawn digits: the away team's last digit picks the row, the home team's the column.
    const homeFor = (column: number) => expectDefined(digits.columnDigits[column]);
    const awayFor = (row: number) => expectDefined(digits.rowDigits[row]);
    // Q1 lands in Alice's top row; Q2 in Bob's left column; Q3 in a box nobody holds; the final in Alice's top row.
    const quarters = [
      { periodNumber: 1, homeScore: homeFor(3), awayScore: awayFor(0) },
      { periodNumber: 2, homeScore: 10 + homeFor(0), awayScore: 10 + awayFor(4) },
      { periodNumber: 3, homeScore: 20 + homeFor(5), awayScore: 20 + awayFor(5) },
    ];
    const final = { homeScore: 30 + homeFor(7), awayScore: 40 + awayFor(0) };
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).response?.status).toBe(200);
    for (const { periodNumber, ...score } of quarters) {
      expect((await recordEventMatchPeriodScore({ client: a, path: { eventId: event.id, ...SUPER_BOWL, periodNumber }, body: periodBody(score) })).response?.status).toBe(200);
    }
    const live = expectMatchesSchema(SquaresBoardResponseSchema, (await getSquaresBoard({ client: bob.client, path: { contestId } })).data);
    expect(live.contestStatus).toBe(ContestStatus.ACTIVE);
    expect(live.winners.map((winner) => [winner.periodNumber, winner.rowIndex, winner.columnIndex, winner.contestEntryId]))
      .toEqual([[1, 0, 3, aliceEntry], [2, 4, 0, bobEntry], [3, 5, 5, null]]);

    expect((await recordEventMatchResult({
      client: a,
      path: { eventId: event.id, ...SUPER_BOWL },
      body: resultBody({ winnerSide: MatchSide.AWAY, ...final }),
    })).response?.status).toBe(200);

    // --- Settled with its game, though the playoffs event is still under way -----------------------
    expect(expectDefined((await getContest({ client: alice.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = expectMatchesSchema(SquaresBoardResponseSchema, (await getSquaresBoard({ client: alice.client, path: { contestId } })).data);
    expect(settled.winners.map((winner) => [winner.periodNumber, winner.contestEntryId, winner.entryName !== null]))
      .toEqual([[1, aliceEntry, true], [2, bobEntry, true], [3, null, false], [4, aliceEntry, true]]);
    expect(settled.entries.map((entry) => [entry.contestEntryId, entry.boxCount, entry.periodsWon, entry.displayPosition]))
      .toEqual([[aliceEntry, 10, 2, '1'], [bobEntry, 9, 1, '2']]);
  });
});

// Each league's squares preset on its own final: men's college basketball played in two halves,
// women's in quarters (#786), each read from the final's slot (#2047). Squares are only on football
// and March Madness (#2164). Each test seed loads with every game played but the final; one entry
// holds the top row, the other the left column, and every scoring moment lands in the top row.
const LEAGUE_FINALS = [
  { sport: Sport.BASKETBALL, file: 'basketball-2026-ncaa-tournaments-test.json', league: 'NCAA Men\'s Basketball', event: 'NCAA Men\'s Tournament', templateKey: 'ncaa-men-squares', periods: { unit: PeriodUnit.HALF, count: 2 } },
  { sport: Sport.BASKETBALL, file: 'basketball-2026-ncaa-tournaments-test.json', league: 'NCAA Women\'s Basketball', event: 'NCAA Women\'s Tournament', templateKey: 'ncaa-women-squares', periods: { unit: PeriodUnit.QUARTER, count: 4 } },
] as const;

describe('SDK Functional: squares on each league\'s final, scored at the end of each of its periods', () => {
  it.each(LEAGUE_FINALS.map((row) => [row.league, row.periods.unit, row] as const))(
    '%s, %s: the league\'s squares preset runs on its final, takes a score for each period but the last, and settles a winner for every period',
    async (_league, _unit, row) => {
      const admin = await buildRegisteredUser({ displayName: 'College Squares Director' });
      await promoteToRootAdmin(admin);
      const a = admin.client;
      const tag = `${RUN}-${row.templateKey}`;
      const file = oneEventOf(row.file, row.league, row.event)(tag, 2099);
      const [event] = file.sportLeagues[0].events;
      const matches = event.matches ?? [];
      // The final is the one game of the last round.
      const finalRow = expectDefined(matches.find((match) => match.roundNumber === Math.max(...matches.map((each) => each.roundNumber))));
      const finalPlace = matchPlaceOf(finalRow);
      delete finalRow.result;
      delete finalRow.periodScores;
      await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED });

      const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: row.sport } })).data).sportLeagues
        .find((league) => league.name === row.league));
      const loaded = expectDefined(expectDefined((await listEvents({ client: a, query: { sportLeagueId: sportLeague.id } })).data).events
        .find((each) => each.name === event.name));
      created.sportEventIds.add(loaded.id);
      const final = expectDefined(expectDefined((await getEventBracket({ client: a, path: { eventId: loaded.id } })).data).matches.map(withHomeAwayRead)
        .find((match) => isAtPlace(match, finalPlace)));
      expect([final.status, final.slot.periods]).toEqual(['SCHEDULED', row.periods]);

      const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'College Squares Commissioner', leagueName: `College Squares ${tag}` });
      const member = await buildRegisteredUser({ displayName: 'College Squares Member' });
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
      const preset = expectDefined(expectDefined((await listContestConfigTemplates({
        client: commissioner.client,
        query: { sportLeagueId: sportLeague.id, active: true },
      })).data).templates.find((template) => template.contestFormat === ContestFormat.SQUARES && template.sportLeagueId === sportLeague.id), `${row.league}'s squares preset`);
      expect([preset.templateKey, preset.isDefault]).toEqual([row.templateKey, true]);
      const contest = await createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: {
          name: `College Squares ${tag}`,
          sportEventIds: [loaded.id],
          sportEventRoundMatchGameId: await squaresGameIdOf(commissioner.client, loaded.id, final.id),
          contestFormat: ContestFormat.SQUARES,
          selectionType: SelectionType.SQUARES,
          templateId: preset.id,
        },
      });
      expect([contest.error, contest.response?.status]).toEqual([undefined, 201]);
      const contestId = expectDefined(contest.data).contest.id;
      await openContest({ client: commissioner.client, path: { id: league.id, contestId } });

      // The commissioner's entry holds the top row, the member's the left column below it.
      const topRow = expectDefined((await enterContest({ client: commissioner.client, path: { contestId } })).data).entry.id;
      const leftColumn = expectDefined((await enterContest({ client: member.client, path: { contestId } })).data).entry.id;
      for (let index = 0; index < 10; index += 1) {
        await claimSquaresBox({ client: commissioner.client, path: { contestId, rowIndex: 0, columnIndex: index }, body: { contestEntryId: topRow } });
        if (index > 0) await claimSquaresBox({ client: member.client, path: { contestId, rowIndex: index, columnIndex: 0 }, body: { contestEntryId: leftColumn } });
      }
      const drawn = expectMatchesSchema(SquaresBoardResponseSchema, (await drawSquaresNumbers({ client: commissioner.client, path: { contestId } })).data);
      expect(drawn.periods).toEqual(row.periods);
      const digits = expectDefined(drawn.digits ?? undefined);
      const homeFor = (column: number) => expectDefined(digits.columnDigits[column]);
      const awayFor = (rowIndex: number) => expectDefined(digits.rowDigits[rowIndex]);

      // Every moment lands in the top row: the away score's last digit is row 0's, each period in a new column.
      const { count } = row.periods;
      expect((await transitionEvent({ client: a, path: { eventId: final.sportEventId }, body: { toStatus: 'IN_PROGRESS' } })).response?.status).toBe(200);
      for (let periodNumber = 1; periodNumber < count; periodNumber += 1) {
        const score = { homeScore: 10 * periodNumber + homeFor(periodNumber), awayScore: 10 * periodNumber + awayFor(0) };
        expect((await recordEventMatchPeriodScore({ client: a, path: { eventId: final.sportEventId, ...finalPlace, periodNumber }, body: periodBody(score) })).response?.status).toBe(200);
      }
      // The last period's score is the final result, never a period score of its own.
      expectFunctionalError(
        await recordEventMatchPeriodScore({ client: a, path: { eventId: final.sportEventId, ...finalPlace, periodNumber: count }, body: periodBody({ homeScore: 90, awayScore: 90 }) }),
        { status: 422, code: 'MATCH_PERIOD_INVALID' },
      );
      expect((await recordEventMatchResult({
        client: a,
        path: { eventId: final.sportEventId, ...finalPlace },
        body: resultBody({ winnerSide: MatchSide.HOME, homeScore: 100 + homeFor(0), awayScore: 90 + awayFor(0) }),
      })).response?.status).toBe(200);

      expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
      const settled = expectMatchesSchema(SquaresBoardResponseSchema, (await getSquaresBoard({ client: member.client, path: { contestId } })).data);
      expect(settled.winners.map((winner) => [winner.periodNumber, winner.rowIndex, winner.contestEntryId]))
        .toEqual(Array.from({ length: count }, (_, index) => [index + 1, 0, topRow]));
      expect(settled.entries.map((entry) => [entry.contestEntryId, entry.periodsWon, entry.displayPosition])).toEqual([[topRow, count, '1'], [leftColumn, 0, '2']]);
    },
    120_000,
  );
});
