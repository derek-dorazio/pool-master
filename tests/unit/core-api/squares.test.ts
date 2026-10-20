/**
 * Squares (#711, plans/super-bowl-squares.md): a 10x10 grid on one game. The scoring rules
 * (`squaresScoringMoments`, `squaresWinners`), claiming and clearing boxes, drawing the digits and
 * settling the contest with its game, against the stateful in-memory world, so the tests assert
 * stored boxes, entry statuses, frozen winners and standings rather than calls.
 *
 * One game, the Chiefs at home to the Eagles. Alice and Bob each have an entry, and Carol is the
 * commissioner, with no entry of her own.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  LeagueRole,
  MatchStatus,
  SelectionType,
  Sport,
  squaresScoringMoments,
  squaresWinners,
  type ContestEntry,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { ContestSettlementService } from '../../../packages/core-api/src/modules/contests/contest-settlement-service';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';
import { SquaresService, type SquaresActor } from '../../../packages/core-api/src/modules/selections/squares-service';
import { expectDefined } from '../../support/expect-defined';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';
import { InMemoryGamePicks } from '../../support/in-memory-game-picks';
import { InMemorySquares } from '../../support/in-memory-squares';

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2027-01-20T00:00:00.000Z');
const KICKOFF = new Date('2027-02-07T23:30:00.000Z');
const later = (when: Date, hours: number) => new Date(when.getTime() + hours * HOUR);
/** The digits 0 to 9 in order: row and column positions then equal the digits, which keeps the arithmetic readable. */
const IN_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function setup(options: { status?: ContestStatus; maxSquaresPerEntry?: number } = {}) {
  const world = new InMemoryContestWorld();
  const games = new InMemoryGamePicks(world);
  const squares = new InMemorySquares(world, T0);
  const league = world.addLeague();
  const superBowl = world.addSportEvent({ name: 'Super Bowl', startDate: KICKOFF, sport: Sport.AMERICAN_FOOTBALL });
  const game = games.addGame(superBowl.id, 1, KICKOFF);
  const contest = world.addContest(league.id, {
    name: 'Office squares',
    status: options.status ?? ContestStatus.OPEN,
    contestFormat: ContestFormat.SQUARES,
    selectionType: SelectionType.SQUARES,
    sportEventIds: [superBowl.id],
    squaresGameMatchId: game.id,
  });
  world.addConfiguration(contest.id, {
    selectionType: SelectionType.SQUARES,
    configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: options.maxSquaresPerEntry ?? 10 },
  });

  const commissioner = world.addUser({ email: 'carol@example.com' });
  world.addMember(league.id, commissioner.id, { role: LeagueRole.COMMISSIONER });
  const users = new Map<string, string>([['Carol', commissioner.id]]);
  const enter = (name: string): ContestEntry => {
    const user = world.addUser({ email: `${name.toLowerCase()}@example.com` });
    world.addMember(league.id, user.id);
    const squad = world.addSquad(league.id, `${name}'s Squares`);
    world.addSquadMember(squad.id, user.id);
    users.set(name, user.id);
    const entry: ContestEntry = {
      id: `entry-${name.toLowerCase()}`, contestId: contest.id, squadId: squad.id, entryNumber: 1, name,
      events: [{ sportEventId: superBowl.id, status: ContestEntryStatus.DRAFT }],
      createdAt: T0, updatedAt: T0,
    };
    world.entries.set(entry.id, entry);
    return entry;
  };
  const alice = enter('Alice');
  const bob = enter('Bob');

  let now = later(KICKOFF, -24);
  const service = new SquaresService({
    contests: world.contestRepo(),
    configurations: world.configurationRepo(),
    entries: world.entryRepo(),
    memberships: world.membershipRepo(),
    squadMemberships: world.squadMembershipRepo(),
    sportEvents: world.sportEventRepo(),
    matches: games.matchRepo(),
    field: games.fieldRepo(),
    participants: games.participantRepo(),
    squares: squares.repo(),
    standings: world.standingRepo(),
    now: () => now,
    drawSeed: () => 'seed',
  });
  const deps = world.contestServiceDeps({ matches: games.matchRepo(), participants: games.participantRepo(), eventParticipants: games.fieldService() });
  const settlement = new ContestSettlementService({ ...deps, contests: world.contestRepo(), sportEvents: world.sportEventRepo(), squares: squares.repo() });

  const actor = (name: string, isRootAdmin = false): SquaresActor => ({ userId: expectDefined(users.get(name)), isRootAdmin });
  const updateGame = (changes: Partial<SportEventMatch>) => {
    games.putMatches([{ ...expectDefined(games.matches.get(game.id)), ...changes }]);
  };
  /** Draws digits in order, as if the shuffle had left them unmoved, so a score's last digits name its box. */
  const drawInOrder = () => {
    squares.draws.set(contest.id, { contestId: contest.id, seed: 'seed', rowDigits: IN_ORDER, columnDigits: IN_ORDER, drawnByUserId: null, drawnAt: T0 });
  };
  return {
    world, games, squares, contest, superBowl, game, alice, bob, service, settlement, actor, updateGame, drawInOrder,
    setNow: (when: Date) => { now = when; },
    contestStatus: () => expectDefined(world.contests.get(contest.id)).status,
    entryStatus: (entry: ContestEntry) => expectDefined(world.entries.get(entry.id)).events[0]?.status,
  };
}

async function expectRefused(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SelectionError);
  expect(error).toMatchObject({ code, statusCode });
}

function scoredGame(overrides: Partial<SportEventMatch>): Pick<SportEventMatch, 'status' | 'homeScore' | 'awayScore' | 'periodScores'> {
  return { status: MatchStatus.IN_PROGRESS, homeScore: null, awayScore: null, periodScores: [], ...overrides };
}

const period = (periodNumber: number, homeScore: number, awayScore: number) => ({ periodNumber, homeScore, awayScore });

describe('squaresScoringMoments', () => {
  it('takes the first three quarters as entered, and no final while the game is still being played', () => {
    const moments = squaresScoringMoments(scoredGame({ periodScores: [period(2, 10, 7), period(1, 3, 0), period(3, 17, 14)] }), 4);
    expect(moments).toEqual([period(1, 3, 0), period(2, 10, 7), period(3, 17, 14)]);
  });

  it('scores the last moment on the final score, overtime included, not on the fourth quarter\'s entered score', () => {
    const moments = squaresScoringMoments(scoredGame({
      status: MatchStatus.COMPLETED,
      homeScore: 31,
      awayScore: 28,
      periodScores: [period(1, 7, 7), period(2, 14, 14), period(3, 21, 21), period(4, 28, 28)],
    }), 4);
    expect(moments.map((moment) => moment.periodNumber)).toEqual([1, 2, 3, 4]);
    expect(moments.at(-1)).toEqual(period(4, 31, 28));
  });
});

describe('squaresWinners', () => {
  const draw = { rowDigits: [5, 0, 1, 2, 3, 4, 6, 7, 8, 9], columnDigits: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] };

  it('finds the box whose row holds the away score\'s last digit and whose column holds the home score\'s', () => {
    // Home 17, away 10: the column with 7 is position 2, the row with 0 is position 1.
    const [winner] = squaresWinners(draw, [period(1, 17, 10)], [{ rowIndex: 1, columnIndex: 2, contestEntryId: 'entry-a' }]);
    expect(winner).toMatchObject({ rowIndex: 1, columnIndex: 2, contestEntryId: 'entry-a' });
  });

  it('names no winner for a moment whose box nobody claimed', () => {
    const [winner] = squaresWinners(draw, [period(1, 3, 0)], [{ rowIndex: 0, columnIndex: 0, contestEntryId: 'entry-a' }]);
    expect(winner).toMatchObject({ rowIndex: 1, columnIndex: 6, contestEntryId: null });
  });
});

describe('SquaresService claiming boxes', () => {
  it('lets a member claim an empty box for their own entry, and shows it on the board under the entry\'s name', async () => {
    const context = setup();
    const board = await context.service.claim(context.contest.id, 2, 3, context.alice.id, context.actor('Alice'));
    expect(board.boxes).toEqual([{ rowIndex: 2, columnIndex: 3, contestEntryId: context.alice.id, entryName: 'Alice' }]);
    expect(board.claimsOpen).toBe(true);
    expect(board.entries.find((entry) => entry.contestEntryId === context.alice.id)?.boxCount).toBe(1);
  });

  it('refuses a member claiming a box for another squad\'s entry, and stores nothing', async () => {
    const context = setup();
    await expectRefused(context.service.claim(context.contest.id, 0, 0, context.bob.id, context.actor('Alice')), 'ENTRY_ACCESS_DENIED', 403);
    expect(context.squares.boxesOf(context.contest.id)).toEqual([]);
  });

  it('lets the commissioner claim and clear boxes for any entry', async () => {
    const context = setup();
    await context.service.claim(context.contest.id, 0, 0, context.bob.id, context.actor('Carol'));
    expect(context.squares.boxesOf(context.contest.id).map((box) => box.contestEntryId)).toEqual([context.bob.id]);
    await context.service.clear(context.contest.id, 0, 0, context.actor('Carol'));
    expect(context.squares.boxesOf(context.contest.id)).toEqual([]);
  });

  it('refuses a box someone already holds', async () => {
    const context = setup();
    context.squares.addBox(context.contest.id, context.bob.id, 4, 4);
    await expectRefused(context.service.claim(context.contest.id, 4, 4, context.alice.id, context.actor('Alice')), 'SQUARES_BOX_TAKEN', 409);
  });

  it('refuses a claim past the contest\'s box limit per entry', async () => {
    const context = setup({ maxSquaresPerEntry: 2 });
    context.squares.addBox(context.contest.id, context.alice.id, 0, 0);
    context.squares.addBox(context.contest.id, context.alice.id, 0, 1);
    await expectRefused(context.service.claim(context.contest.id, 0, 2, context.alice.id, context.actor('Alice')), 'SQUARES_BOX_LIMIT_REACHED', 409);
    expect(context.squares.boxesOf(context.contest.id)).toHaveLength(2);
  });

  it('lets a member clear their own box but not another squad\'s', async () => {
    const context = setup();
    context.squares.addBox(context.contest.id, context.alice.id, 1, 1);
    context.squares.addBox(context.contest.id, context.bob.id, 2, 2);
    await expectRefused(context.service.clear(context.contest.id, 2, 2, context.actor('Alice')), 'ENTRY_ACCESS_DENIED', 403);
    await context.service.clear(context.contest.id, 1, 1, context.actor('Alice'));
    expect(context.squares.boxesOf(context.contest.id).map((box) => box.contestEntryId)).toEqual([context.bob.id]);
  });

  it('refuses clearing a box nobody holds', async () => {
    const context = setup();
    await expectRefused(context.service.clear(context.contest.id, 5, 5, context.actor('Carol')), 'SQUARES_BOX_NOT_CLAIMED', 404);
  });

  it('closes claiming at the game\'s kickoff time, even before the game is marked under way', async () => {
    const context = setup();
    context.setNow(later(KICKOFF, 0.1));
    await expectRefused(context.service.claim(context.contest.id, 0, 0, context.alice.id, context.actor('Alice')), 'SQUARES_CLAIMING_CLOSED', 409);
    expect((await context.service.getBoard(context.contest.id, context.actor('Alice'))).claimsOpen).toBe(false);
  });

  it('hides a draft contest from members, as if it did not exist, but shows it to the commissioner', async () => {
    const context = setup({ status: ContestStatus.DRAFT });
    await expectRefused(context.service.getBoard(context.contest.id, context.actor('Alice')), 'CONTEST_NOT_FOUND', 404);
    await expect(context.service.getBoard(context.contest.id, context.actor('Carol'))).resolves.toMatchObject({ claimsOpen: false });
  });
});

describe('SquaresService drawing the numbers', () => {
  it('shuffles 0 to 9 along each side, submits every entry holding a box, and closes claiming', async () => {
    const context = setup();
    context.squares.addBox(context.contest.id, context.alice.id, 0, 0);
    const board = await context.service.draw(context.contest.id, context.actor('Carol'));
    const digits = expectDefined(board.digits ?? undefined);
    expect([...digits.rowDigits].sort((left, right) => left - right)).toEqual(IN_ORDER);
    expect([...digits.columnDigits].sort((left, right) => left - right)).toEqual(IN_ORDER);
    expect(board.claimsOpen).toBe(false);
    expect(board.drawOpen).toBe(false);
    expect(context.entryStatus(context.alice)).toBe(ContestEntryStatus.SUBMITTED);
    expect(context.entryStatus(context.bob)).toBe(ContestEntryStatus.DRAFT);
    await expectRefused(context.service.claim(context.contest.id, 1, 1, context.alice.id, context.actor('Alice')), 'SQUARES_CLAIMING_CLOSED', 409);
  });

  it('draws the same digits from the same seed, so a draw can be replayed', async () => {
    const first = setup();
    const second = setup();
    const one = await first.service.draw(first.contest.id, first.actor('Carol'));
    const two = await second.service.draw(second.contest.id, second.actor('Carol'));
    expect(one.digits?.rowDigits).toEqual(two.digits?.rowDigits);
    expect(one.digits?.columnDigits).toEqual(two.digits?.columnDigits);
  });

  it('refuses a second draw, keeping the first draw\'s digits', async () => {
    const context = setup();
    const first = await context.service.draw(context.contest.id, context.actor('Carol'));
    await expectRefused(context.service.draw(context.contest.id, context.actor('Carol')), 'SQUARES_ALREADY_DRAWN', 409);
    expect(context.squares.draws.get(context.contest.id)?.rowDigits).toEqual(first.digits?.rowDigits);
  });

  it('still draws once the game is under way, until the first quarter\'s score is in', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    context.setNow(later(KICKOFF, 0.2));
    context.updateGame({ status: MatchStatus.IN_PROGRESS });
    expect((await context.service.getBoard(context.contest.id, context.actor('Carol'))).drawOpen).toBe(true);
    context.updateGame({ periodScores: [period(1, 7, 0)] });
    await expectRefused(context.service.draw(context.contest.id, context.actor('Carol')), 'SQUARES_DRAW_CLOSED', 409);
    expect(context.squares.draws.has(context.contest.id)).toBe(false);
  });

  it('shows each scored quarter\'s winning box on the board as soon as its score is in', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    context.squares.addBox(context.contest.id, context.alice.id, 0, 7);
    context.drawInOrder();
    context.updateGame({ status: MatchStatus.IN_PROGRESS, periodScores: [period(1, 7, 0), period(2, 7, 3)] });
    const board = await context.service.getBoard(context.contest.id, context.actor('Bob'));
    expect(board.winners.map((winner) => [winner.periodNumber, winner.entryName])).toEqual([[1, 'Alice'], [2, null]]);
  });
});

describe('ContestSettlementService settling a squares contest with its game', () => {
  it('freezes each quarter\'s winner, places entries by quarters won with ties shared, and completes the contest', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    // Q1 7-0 and the final 27-20 fall in Alice's boxes; Q2 14-3 in Bob's; Q3 21-13 in nobody's.
    context.squares.addBox(context.contest.id, context.alice.id, 0, 7);
    context.squares.addBox(context.contest.id, context.alice.id, 0, 1);
    context.squares.addBox(context.contest.id, context.alice.id, 0, 0);
    context.squares.addBox(context.contest.id, context.bob.id, 3, 4);
    context.squares.addBox(context.contest.id, context.bob.id, 9, 9);
    context.drawInOrder();
    context.updateGame({
      status: MatchStatus.COMPLETED, homeScore: 27, awayScore: 20,
      periodScores: [period(1, 7, 0), period(2, 14, 3), period(3, 21, 13), period(4, 24, 20)],
    });
    // The final's box is row 0 (away 20), column 7 (home 27): Alice's.
    const completedAt = later(KICKOFF, 4);

    await expect(context.settlement.settleFinishedGame(context.superBowl.id, context.game.id, { completedAt })).resolves.toBe(1);

    expect(context.contestStatus()).toBe(ContestStatus.COMPLETED);
    const frozen = context.squares.winners.get(context.contest.id) ?? [];
    expect(frozen.map((winner) => [winner.periodNumber, winner.contestEntryId])).toEqual([
      [1, context.alice.id], [2, context.bob.id], [3, null], [4, context.alice.id],
    ]);
    const standings = [...context.world.standings.values()].map((standing) => [standing.contestEntryId, standing.displayPosition, standing.totalScore]);
    expect(standings).toEqual(expect.arrayContaining([[context.alice.id, '1', 2], [context.bob.id, '2', 1]]));
  });

  it('shares a place between entries that won the same number of quarters', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    context.squares.addBox(context.contest.id, context.alice.id, 0, 7);
    context.squares.addBox(context.contest.id, context.bob.id, 0, 0);
    context.drawInOrder();
    context.updateGame({ status: MatchStatus.COMPLETED, homeScore: 10, awayScore: 0, periodScores: [period(1, 7, 0)] });
    await context.settlement.settleFinishedGame(context.superBowl.id, context.game.id, { completedAt: later(KICKOFF, 4) });
    const positions = [...context.world.standings.values()].map((standing) => standing.displayPosition);
    expect(positions).toEqual(['T1', 'T1']);
  });

  it('completes a contest whose numbers were never drawn with no winners and no standings', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    context.squares.addBox(context.contest.id, context.alice.id, 0, 0);
    context.updateGame({ status: MatchStatus.COMPLETED, homeScore: 10, awayScore: 0 });
    await context.settlement.settleFinishedGame(context.superBowl.id, context.game.id, { completedAt: later(KICKOFF, 4) });
    expect(context.contestStatus()).toBe(ContestStatus.COMPLETED);
    expect(context.squares.winners.has(context.contest.id)).toBe(false);
    expect(context.world.standings.size).toBe(0);
  });

  it('completes a contest on a cancelled game with no winners and no standings', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    context.squares.addBox(context.contest.id, context.alice.id, 0, 0);
    context.drawInOrder();
    context.updateGame({ status: MatchStatus.CANCELLED });
    await context.settlement.settleFinishedGame(context.superBowl.id, context.game.id, { completedAt: later(KICKOFF, 4) });
    expect(context.contestStatus()).toBe(ContestStatus.COMPLETED);
    expect(context.world.standings.size).toBe(0);
  });

  it('leaves squares contests on other games of the event unsettled', async () => {
    const context = setup({ status: ContestStatus.ACTIVE });
    const other = context.games.addGame(context.superBowl.id, 2, KICKOFF);
    context.updateGame({ status: MatchStatus.COMPLETED, homeScore: 10, awayScore: 0 });
    await expect(context.settlement.settleFinishedGame(context.superBowl.id, other.id, { completedAt: later(KICKOFF, 4) })).resolves.toBe(0);
    expect(context.contestStatus()).toBe(ContestStatus.ACTIVE);
  });
});
