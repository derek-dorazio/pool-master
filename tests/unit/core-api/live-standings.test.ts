/**
 * Live standings emails (#877, catalog rows E2, E3, E5 and E6): when a stroke-play round counts as
 * finished, which standings email is due, who gets it, what it shows, and that a second sweep
 * never sends one twice. The contest world is in memory and the leaderboard is a fixed board;
 * the email service is the real one over an in-memory outbox, so the tests assert on the emails
 * recorded.
 */
import type { StandingsEmailPosition } from '@poolmaster/shared/db';
import {
  ContestFormat,
  ContestStatus,
  LeagueMembershipStatus,
  LeagueRole,
  ParticipantRoundStatus,
  ParticipantStandingStatus,
  SelectionType,
  SportEventStatus,
  SurvivorWeekOutcome,
  type Contest,
  type SportEvent,
} from '@poolmaster/shared/domain';
import type { ContestLeaderboardEntryRow, ContestLeaderboardModel } from '../../../packages/core-api/src/mappers/contests.mapper';
import type { PickEmLeaderboardModel } from '../../../packages/core-api/src/mappers/pick-em-leaderboard.mapper';
import type { SurvivorLeaderboardModel } from '../../../packages/core-api/src/mappers/survivor-leaderboard.mapper';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { LiveStandings } from '../../../packages/core-api/src/modules/notifications/live-standings';
import { lastFinishedRound } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/finished-rounds';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

const MINUTE = 60_000;
const ROUND_1_DONE = new Date('2026-04-09T23:10:00.000Z');
const ROUND_2_DONE = new Date('2026-04-10T23:20:00.000Z');

function after(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE);
}

interface RoundSpec {
  roundNumber: number;
  status: ParticipantRoundStatus;
  completedAt?: Date | null;
  updatedAt?: Date;
  thru?: number | null;
}

/** One field row, with only what round detection and cut news read. */
function golfer(id: string, rounds: RoundSpec[], options: { standing?: ParticipantStandingStatus; isActive?: boolean } = {}): SportEventParticipantView {
  return {
    entry: { id, isActive: options.isActive ?? true },
    participant: { name: `Golfer ${id}` },
    standing: options.standing === undefined ? null : { standing: { status: options.standing }, golf: null },
    rounds: rounds.map((round) => ({
      round: {
        roundNumber: round.roundNumber,
        status: round.status,
        completedAt: round.completedAt === undefined ? null : round.completedAt,
        updatedAt: round.updatedAt ?? new Date(0),
      },
      golf: { strokes: 70, scoreToPar: -2, thru: round.thru === undefined ? 18 : round.thru },
    })),
    matches: [],
  } as unknown as SportEventParticipantView;
}

function done(roundNumber: number, completedAt: Date): RoundSpec {
  return { roundNumber, status: ParticipantRoundStatus.COMPLETED, completedAt };
}

describe('lastFinishedRound', () => {
  it('is nothing while any golfer still in the event is playing the only round started', () => {
    expect(lastFinishedRound([
      golfer('a', [done(1, ROUND_1_DONE)]),
      golfer('b', [{ roundNumber: 1, status: ParticipantRoundStatus.IN_PROGRESS, thru: 14 }]),
    ])).toBeNull();
  });

  it('is the round every golfer has completed, finished when the last of them did', () => {
    expect(lastFinishedRound([
      golfer('a', [done(1, after(ROUND_1_DONE, -90))]),
      golfer('b', [done(1, ROUND_1_DONE)]),
    ])).toEqual({ roundNumber: 1, finishedAt: ROUND_1_DONE });
  });

  it('reads a round with no completion time as finished when its score was last written, as an admin entering scores leaves it', () => {
    expect(lastFinishedRound([
      golfer('a', [{ roundNumber: 1, status: ParticipantRoundStatus.COMPLETED, completedAt: null, updatedAt: ROUND_1_DONE }]),
      golfer('b', [done(1, after(ROUND_1_DONE, -30))]),
    ])).toEqual({ roundNumber: 1, finishedAt: ROUND_1_DONE });
  });

  it('counts a round with all 18 holes scored as finished before its status catches up', () => {
    expect(lastFinishedRound([
      golfer('a', [{ roundNumber: 1, status: ParticipantRoundStatus.IN_PROGRESS, thru: 18, completedAt: null, updatedAt: ROUND_1_DONE }]),
    ])?.roundNumber).toBe(1);
  });

  it('is the last round the whole field finished while the next one is under way', () => {
    expect(lastFinishedRound([
      golfer('a', [done(1, ROUND_1_DONE), done(2, ROUND_2_DONE)]),
      golfer('b', [done(1, ROUND_1_DONE), { roundNumber: 2, status: ParticipantRoundStatus.IN_PROGRESS, thru: 9 }]),
    ])).toEqual({ roundNumber: 1, finishedAt: ROUND_1_DONE });
  });

  it('leaves out golfers who are out of the event: cut, withdrawn or removed from the field', () => {
    expect(lastFinishedRound([
      golfer('a', [done(1, ROUND_1_DONE), done(2, ROUND_2_DONE), done(3, after(ROUND_2_DONE, 1440))]),
      golfer('cut', [done(1, ROUND_1_DONE), { roundNumber: 2, status: ParticipantRoundStatus.MISSED_CUT, completedAt: ROUND_2_DONE }], { standing: ParticipantStandingStatus.ELIMINATED }),
      golfer('withdrew', [{ roundNumber: 1, status: ParticipantRoundStatus.DNF, thru: 7 }], { standing: ParticipantStandingStatus.WITHDRAWN }),
      golfer('removed', [], { isActive: false }),
    ])?.roundNumber).toBe(3);
  });
});

describe('LiveStandings.queueDue', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let logger: ReturnType<typeof fakeLogger>;
  let fields: Map<string, SportEventParticipantView[]>;
  let boards: Map<string, ContestLeaderboardEntryRow[]>;
  let pickEmBoards: Map<string, PickEmLeaderboardModel>;
  let survivorBoards: Map<string, SurvivorLeaderboardModel>;
  let positions: Map<string, number | null>;
  let failingContestId: string | null;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    logger = fakeLogger();
    fields = new Map();
    boards = new Map();
    pickEmBoards = new Map();
    survivorBoards = new Map();
    positions = new Map();
    failingContestId = null;
  });

  function standings(config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' })): LiveStandings {
    const email = new EmailService({
      messages: outbox,
      providerName: 'smtp',
      readConfig: () => config,
      senderAddress: 'noreply@poolmaster.test',
      suppressions: inMemoryEmailSuppressions(),
      optOuts: inMemoryEmailOptOuts(),
      unsubscribe: TEST_UNSUBSCRIBE,
      logger,
    });
    return new LiveStandings({
      contests: world.contestRepo(),
      sportEvents: world.sportEventRepo(),
      eventParticipants: { listEventParticipants: async (sportEventId) => fields.get(sportEventId) ?? [] },
      eventStandings: world.eventStandingRepo(),
      leaderboards: {
        leaderboardOf: async (contest: Contest, sportEventId?: string): Promise<ContestLeaderboardModel> => {
          if (contest.id === failingContestId) throw new Error('leaderboard unavailable');
          return {
            contestId: contest.id,
            sportEventId: sportEventId ?? '',
            sport: 'GOLF',
            scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
            countingRule: { type: 'BEST_N', count: 4 },
            participants: fields.get(sportEventId ?? '') ?? [],
            entries: boards.get(contest.id) ?? [],
            asOf: null,
          };
        },
        pickEmLeaderboardOf: async (contest: Contest) => {
          const board = pickEmBoards.get(contest.id);
          if (!board) throw new Error('no pick\'em board');
          return board;
        },
        survivorLeaderboardOf: async (contest: Contest) => {
          const board = survivorBoards.get(contest.id);
          if (!board) throw new Error('no survivor board');
          return board;
        },
      },
      positions: {
        findByContest: async (contestId) => new Map(
          [
            ...(boards.get(contestId) ?? []),
            ...(pickEmBoards.get(contestId)?.entries ?? []),
            ...(survivorBoards.get(contestId)?.entries ?? []),
          ].flatMap((row) => {
            const position = positions.get(row.entryId);
            return position === undefined || position === null ? [] : [[row.entryId, position] as const];
          }),
        ),
        record: async (rows: readonly StandingsEmailPosition[]) => {
          for (const row of rows) positions.set(row.contestEntryId, row.position);
        },
      },
      leagues: world.leagueRepo(),
      memberships: world.membershipRepo(),
      squadMemberships: world.squadMembershipRepo(),
      users: world.userRepo(),
      email,
      readConfig: () => config,
      appBaseUrl: 'https://app.example.test/',
      logger,
    });
  }

  /** A member of the league who owns a squad of their own. */
  function member(leagueId: string, firstName: string, options: { role?: LeagueRole; membership?: LeagueMembershipStatus } = {}) {
    const user = world.addUser({ firstName, lastName: 'Member' });
    world.addMember(leagueId, user.id, { role: options.role ?? LeagueRole.MEMBER, status: options.membership ?? LeagueMembershipStatus.ACTIVE });
    const squad = world.addSquad(leagueId, `${firstName}'s Squad`);
    world.addSquadMember(squad.id, user.id);
    return { user, squad };
  }

  /** A board row: the entry's total and place, as the leaderboard ranks it. */
  function row(entryId: string, squad: { id: string; name: string }, position: number | null, score: number | null, extra: Partial<ContestLeaderboardEntryRow> = {}): ContestLeaderboardEntryRow {
    return {
      entryId,
      entryName: `Entry ${entryId}`,
      entryNumber: 1,
      squadId: squad.id,
      squadName: squad.name,
      score,
      position,
      displayPosition: position === null ? null : String(position),
      countingPickLimit: 4,
      scoredPickCount: 4,
      picks: [],
      events: [],
      ...extra,
    };
  }

  /** A live golf contest on a 4-round event whose whole field finished round 1 at ROUND_1_DONE. */
  function liveMasters(overrides: Partial<SportEvent> = {}) {
    const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
    const masters = world.addSportEvent({ name: 'The Masters', startDate: new Date('2026-04-09T11:40:00.000Z'), status: SportEventStatus.IN_PROGRESS, rounds: 4, ...overrides });
    const contest = world.addContest(league.id, { name: 'Masters Pick 6', status: ContestStatus.ACTIVE, sportEventIds: [masters.id] });
    fields.set(masters.id, [golfer('g1', [done(1, ROUND_1_DONE)]), golfer('g2', [done(1, after(ROUND_1_DONE, -20))])]);
    return { league, masters, contest };
  }

  function emailsTo(userId: string) {
    return outbox.rows.filter((email) => email.recipientUserId === userId);
  }

  it('sends round standings once the buffer has passed, to every entry owner and the commissioners, and to no member without an entry', async () => {
    const { league, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    const ben = member(league.id, 'Ben');
    const casey = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });
    const watcher = member(league.id, 'Wes');
    member(league.id, 'Gone', { membership: LeagueMembershipStatus.INACTIVE });
    boards.set(contest.id, [row('e1', ana.squad, 1, -6), row('e2', ben.squad, 2, -3)]);

    await standings().queueDue(after(ROUND_1_DONE, 29));
    expect(outbox.rows).toHaveLength(0);

    await standings().queueDue(after(ROUND_1_DONE, 31));
    expect(outbox.rows.map((email) => email.recipientUserId ?? '').sort((left, right) => left.localeCompare(right)))
      .toEqual([ana.user.id, ben.user.id, casey.user.id].sort((left, right) => left.localeCompare(right)));
    expect(emailsTo(watcher.user.id)).toHaveLength(0);
    const [toAna] = emailsTo(ana.user.id);
    expect(toAna.templateKey).toBe('CONTEST_STANDINGS');
    expect(toAna.subject).toBe('After round 1: Masters Pick 6');
    expect(toAna.textBody).toContain('1. Entry e1 (Ana\'s Squad), yours, -6');
    expect(toAna.textBody).toContain('2. Entry e2 (Ben\'s Squad), -3');
    expect(toAna.textBody).toContain(`Leaderboard: https://app.example.test/league/OFFICE24/contests/${contest.id}/leaderboard`);
  });

  it('queues each round\'s standings once however many sweeps run in its hour, and none more than an hour late', async () => {
    const { league, masters, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6)]);
    const service = standings();

    await service.queueDue(after(ROUND_1_DONE, 31));
    await service.queueDue(after(ROUND_1_DONE, 36));
    await service.queueDue(after(ROUND_1_DONE, 89));
    expect(outbox.rows.map((email) => email.idempotencyKey)).toEqual([`CONTEST_STANDINGS:${contest.id}:${masters.id}:round-1:${ana.user.id}`]);

    outbox.rows.length = 0;
    await standings().queueDue(after(ROUND_1_DONE, 91));
    expect(outbox.rows).toHaveLength(0);
  });

  it('keeps the places the queued email showed as the next one\'s baseline, though the board changes in the rest of its hour', async () => {
    const { league, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    const ben = member(league.id, 'Ben');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6), row('e2', ben.squad, 2, -3)]);
    const service = standings();
    await service.queueDue(after(ROUND_1_DONE, 31));

    // A score correction later in the hour reorders the board.
    boards.set(contest.id, [row('e2', ben.squad, 1, -7), row('e1', ana.squad, 2, -6)]);
    await service.queueDue(after(ROUND_1_DONE, 36));

    expect(positions).toEqual(new Map([['e1', 1], ['e2', 2]]));
  });

  it('waits the buffer the settings name', async () => {
    const { league, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6)]);
    const config = { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), standingsBufferMinutes: 60 };

    await standings(config).queueDue(after(ROUND_1_DONE, 45));
    expect(outbox.rows).toHaveLength(0);
    await standings(config).queueDue(after(ROUND_1_DONE, 61));
    expect(outbox.rows).toHaveLength(1);
  });

  it('shows each entry\'s movement since the last standings email, measured from the places that email recorded', async () => {
    const { league, masters, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    const ben = member(league.id, 'Ben');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6), row('e2', ben.squad, 2, -3)]);
    await standings().queueDue(after(ROUND_1_DONE, 31));
    expect(positions).toEqual(new Map([['e1', 1], ['e2', 2]]));

    fields.set(masters.id, [golfer('g1', [done(1, ROUND_1_DONE), done(2, ROUND_2_DONE)]), golfer('g2', [done(1, ROUND_1_DONE), done(2, ROUND_2_DONE)])]);
    boards.set(contest.id, [row('e2', ben.squad, 1, -9), row('e1', ana.squad, 2, -7)]);
    await standings().queueDue(after(ROUND_2_DONE, 31));

    const [round2] = emailsTo(ana.user.id).filter((email) => email.subject?.startsWith('After round 2'));
    expect(round2.textBody).toContain('1. Entry e2 (Ben\'s Squad), -9, up 1');
    expect(round2.textBody).toContain('2. Entry e1 (Ana\'s Squad), yours, -7, down 1');
    expect(positions).toEqual(new Map([['e1', 2], ['e2', 1]]));
  });

  it('sends nothing after the event\'s last round, which the event\'s result covers', async () => {
    const { league, contest } = liveMasters({ rounds: 1 });
    const ana = member(league.id, 'Ana');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6)]);

    await standings().queueDue(after(ROUND_1_DONE, 31));

    expect(outbox.rows).toHaveLength(0);
  });

  it('sends nothing for a contest that is not live, or for an event that is not stroke play', async () => {
    const { league, masters, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6)]);
    world.contests.set(contest.id, { ...contest, status: ContestStatus.COMPLETED });
    const race = world.addSportEvent({ name: 'Kentucky Derby', sport: 'HORSE_RACING', startDate: new Date('2026-05-02T22:57:00.000Z'), status: SportEventStatus.IN_PROGRESS, rounds: 2 } as Partial<SportEvent> & { startDate: Date });
    const derby = world.addContest(league.id, { status: ContestStatus.ACTIVE, sportEventIds: [race.id] });
    fields.set(race.id, fields.get(masters.id) ?? []);
    boards.set(derby.id, [row('e9', ana.squad, 1, 10)]);

    await standings().queueDue(after(ROUND_1_DONE, 31));

    expect(outbox.rows).toHaveLength(0);
  });

  it('lists the top 10 with anyone tied with the 10th, then the reader\'s entries placed below them', async () => {
    const { league, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    const others = member(league.id, 'Ben');
    const leaders = Array.from({ length: 9 }, (_, index) => row(`L${String(index + 1)}`, others.squad, index + 1, -10 + index));
    boards.set(contest.id, [
      ...leaders,
      row('T10a', others.squad, 10, 0, { displayPosition: 'T10' }),
      row('T10b', others.squad, 10, 0, { displayPosition: 'T10' }),
      row('L12', others.squad, 12, 1),
      row('mine', ana.squad, 13, 2),
    ]);

    await standings().queueDue(after(ROUND_1_DONE, 31));

    const [toAna] = emailsTo(ana.user.id);
    expect(toAna.textBody).toContain('Top 11 of 13:');
    expect(toAna.textBody).toContain('T10. Entry T10b (Ben\'s Squad), E');
    expect(toAna.textBody).not.toContain('Entry L12');
    expect(toAna.textBody).toContain('Your entry:\n13. Entry mine (Ana\'s Squad), yours, +2');
  });

  it('tells a reader which of their golfers missed the cut in the round', async () => {
    const { league, masters, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    fields.set(masters.id, [
      golfer('g1', [done(1, ROUND_1_DONE), done(2, ROUND_2_DONE)]),
      golfer('g2', [done(1, ROUND_1_DONE), { roundNumber: 2, status: ParticipantRoundStatus.MISSED_CUT, completedAt: ROUND_2_DONE }], { standing: ParticipantStandingStatus.ELIMINATED }),
    ]);
    const pick = (sportEventParticipantId: string) => ({ sportEventParticipantId }) as ContestLeaderboardEntryRow['picks'][number];
    boards.set(contest.id, [row('e1', ana.squad, 1, -6, { picks: [pick('g1'), pick('g2')] })]);

    await standings().queueDue(after(ROUND_2_DONE, 31));

    const [toAna] = emailsTo(ana.user.id);
    expect(toAna.subject).toBe('After round 2: Masters Pick 6');
    expect(toAna.textBody).toContain('Missed the cut from Entry e1: Golfer g2.');
  });

  it('sends a season contest\'s result for an event once it settles, with each entry\'s result in it and the next event, but not after the last event', async () => {
    const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
    const masters = world.addSportEvent({ name: 'The Masters', startDate: new Date('2026-04-09T11:40:00.000Z'), status: SportEventStatus.COMPLETED, rounds: 4 });
    const pga = world.addSportEvent({ name: 'PGA Championship', startDate: new Date('2026-05-14T11:00:00.000Z'), status: SportEventStatus.SCHEDULED, rounds: 4 });
    const contest = world.addContest(league.id, {
      name: 'Majors Pool',
      status: ContestStatus.ACTIVE,
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
      sportEventIds: [masters.id, pga.id],
    });
    const ana = member(league.id, 'Ana');
    const settledAt = new Date('2026-04-13T00:00:00.000Z');
    await world.eventStandingRepo().upsert({
      contestId: contest.id,
      contestEntryId: 'e1',
      sportEventId: masters.id,
      position: 2,
      displayPosition: 'T2',
      countingPickLimit: 4,
      scoredPickCount: 4,
      totalScore: -9,
      asOf: settledAt,
      settledAt,
    });
    boards.set(contest.id, [row('e1', ana.squad, 1, -9, { events: [{ sportEventId: masters.id, score: -9, position: 2, displayPosition: 'T2' }] })]);

    await standings().queueDue(after(settledAt, 31));

    const [toAna] = emailsTo(ana.user.id);
    expect(toAna.subject).toBe('After The Masters: Majors Pool');
    expect(toAna.textBody).toContain('1. Entry e1 (Ana\'s Squad), yours, -9, this event T2, -9');
    expect(toAna.textBody).toContain('Next event: PGA Championship');
    expect(toAna.textBody).toContain('Picks close: ');
    expect(toAna.idempotencyKey).toBe(`CONTEST_STANDINGS:${contest.id}:${masters.id}:event:${ana.user.id}`);

    outbox.rows.length = 0;
    world.sportEvents.set(pga.id, { ...pga, status: SportEventStatus.COMPLETED });
    const pgaSettledAt = new Date('2026-05-18T00:00:00.000Z');
    await world.eventStandingRepo().upsert({
      contestId: contest.id,
      contestEntryId: 'e1',
      sportEventId: pga.id,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 4,
      scoredPickCount: 4,
      totalScore: -5,
      asOf: pgaSettledAt,
      settledAt: pgaSettledAt,
    });
    await standings().queueDue(after(pgaSettledAt, 31));
    expect(outbox.rows).toHaveLength(0);
  });

  /** A live prediction contest of three weeks whose first week settled at `settledAt`. */
  async function liveWeeks(selectionType: typeof SelectionType.PICK_EM | typeof SelectionType.SURVIVOR, settledAt: Date) {
    const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
    const week1 = world.addSportEvent({ name: 'Week 1', startDate: new Date('2026-09-11T00:20:00.000Z'), status: SportEventStatus.COMPLETED });
    const week2 = world.addSportEvent({ name: 'Week 2', startDate: new Date('2026-09-18T00:15:00.000Z'), status: SportEventStatus.SCHEDULED });
    const week3 = world.addSportEvent({ name: 'Week 3', startDate: new Date('2026-09-25T00:15:00.000Z'), status: SportEventStatus.SCHEDULED });
    const contest = world.addContest(league.id, {
      name: selectionType === SelectionType.PICK_EM ? 'NFL Pick\'em' : 'Last One Standing',
      status: ContestStatus.ACTIVE,
      contestFormat: ContestFormat.PREDICTION,
      selectionType,
      sportEventIds: [week1.id, week2.id, week3.id],
    });
    await settle(contest.id, week1.id, 'e1', settledAt);
    return { league, contest, week1, week2, week3 };
  }

  async function settle(contestId: string, sportEventId: string, contestEntryId: string, settledAt: Date) {
    await world.eventStandingRepo().upsert({
      contestId,
      contestEntryId,
      sportEventId,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 1,
      scoredPickCount: 1,
      totalScore: 1,
      asOf: settledAt,
      settledAt,
    });
  }

  function pickEmBoard(contestId: string, weekIds: string[], entries: Array<{ entryId: string; squad: { id: string; name: string }; position: number; total: number; week1: { position: number; points: number; display?: string } | null }>): PickEmLeaderboardModel {
    return {
      contestId,
      mode: 'STRAIGHT_UP',
      againstTheSpread: false,
      weeks: weekIds.map((sportEventId, index) => ({
        sportEventId,
        name: `Week ${String(index + 1)}`,
        startDate: new Date(0),
        status: index === 0 ? SportEventStatus.COMPLETED : SportEventStatus.SCHEDULED,
        started: index === 0,
        settled: index === 0,
        gameCount: 16,
        tiebreakerTotalPoints: null,
        winnerEntryIds: index === 0 ? entries.filter((entry) => entry.week1?.position === 1).map((entry) => entry.entryId) : [],
      })),
      entries: entries.map((entry) => ({
        entryId: entry.entryId,
        entryName: `Entry ${entry.entryId}`,
        entryNumber: 1,
        squadId: entry.squad.id,
        squadName: entry.squad.name,
        position: entry.position,
        displayPosition: String(entry.position),
        totalPoints: entry.total,
        weeks: weekIds.map((sportEventId, index) => ({
          sportEventId,
          submitted: index === 0 && entry.week1 !== null,
          points: index === 0 ? entry.week1?.points ?? null : null,
          position: index === 0 ? entry.week1?.position ?? null : null,
          displayPosition: index === 0 && entry.week1 ? entry.week1.display ?? String(entry.week1.position) : null,
          weeklyWinner: index === 0 && entry.week1?.position === 1,
        })),
      })),
    } as PickEmLeaderboardModel;
  }

  it('sends a settled pick\'em week\'s results once the buffer has passed: the week\'s winner and leaders, the season, next week and a picks link for readers with an entry, but not after the last week', async () => {
    const settledAt = new Date('2026-09-15T04:00:00.000Z');
    const { league, contest, week1, week2, week3 } = await liveWeeks(SelectionType.PICK_EM, settledAt);
    const ana = member(league.id, 'Ana');
    const ben = member(league.id, 'Ben');
    const casey = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });
    const watcher = member(league.id, 'Wes');
    pickEmBoards.set(contest.id, pickEmBoard(contest.id, [week1.id, week2.id, week3.id], [
      { entryId: 'e1', squad: ana.squad, position: 1, total: 12, week1: { position: 1, points: 12 } },
      { entryId: 'e2', squad: ben.squad, position: 2, total: 9, week1: { position: 2, points: 9 } },
      { entryId: 'e3', squad: ben.squad, position: 3, total: 0, week1: null },
    ]));

    await standings().queueDue(after(settledAt, 29));
    expect(outbox.rows).toHaveLength(0);
    await standings().queueDue(after(settledAt, 31));

    expect(outbox.rows.map((email) => email.recipientUserId ?? '').sort((left, right) => left.localeCompare(right)))
      .toEqual([ana.user.id, ben.user.id, casey.user.id].sort((left, right) => left.localeCompare(right)));
    expect(emailsTo(watcher.user.id)).toHaveLength(0);
    const [toBen] = emailsTo(ben.user.id);
    expect(toBen.subject).toBe('After Week 1: NFL Pick\'em');
    expect(toBen.idempotencyKey).toBe(`CONTEST_STANDINGS:${contest.id}:${week1.id}:week:${ben.user.id}`);
    expect(toBen.textBody).toContain('Week 1 is done. Entry e1 (Ana\'s Squad) won the week.');
    expect(toBen.textBody).toContain('Week 1, everyone:\n1. Entry e1 (Ana\'s Squad), 12\n2. Entry e2 (Ben\'s Squad), yours, 9\n');
    expect(toBen.textBody).toContain('Season standings, by points:\n1. Entry e1 (Ana\'s Squad), 12\n2. Entry e2 (Ben\'s Squad), yours, 9\n3. Entry e3 (Ben\'s Squad), yours, 0');
    expect(toBen.textBody).toContain('Next week: Week 2, first kickoff');
    expect(toBen.textBody).toContain(`Make picks for next week: https://app.example.test/league/OFFICE24/contests/${contest.id}\n`);
    const [toCasey] = emailsTo(casey.user.id);
    expect(toCasey.textBody).not.toContain('Make picks for next week');
    expect(positions).toEqual(new Map([['e1', 1], ['e2', 2], ['e3', 3]]));

    outbox.rows.length = 0;
    const lastSettledAt = new Date('2026-09-29T04:00:00.000Z');
    world.sportEvents.set(week2.id, { ...week2, status: SportEventStatus.COMPLETED });
    world.sportEvents.set(week3.id, { ...week3, status: SportEventStatus.COMPLETED });
    await settle(contest.id, week2.id, 'e1', after(lastSettledAt, -60));
    await settle(contest.id, week3.id, 'e1', lastSettledAt);
    await standings().queueDue(after(lastSettledAt, 31));
    expect(outbox.rows).toHaveLength(0);
  });

  it('counts a week that finished with nothing to settle, as one no entry submitted, as played rather than still to come, so the last settled week sends nothing', async () => {
    const settledAt = new Date('2026-09-15T04:00:00.000Z');
    const { league, contest, week1, week2, week3 } = await liveWeeks(SelectionType.PICK_EM, settledAt);
    const ana = member(league.id, 'Ana');
    pickEmBoards.set(contest.id, pickEmBoard(contest.id, [week1.id, week2.id, week3.id], [
      { entryId: 'e1', squad: ana.squad, position: 1, total: 12, week1: { position: 1, points: 12 } },
    ]));
    world.sportEvents.set(week2.id, { ...week2, status: SportEventStatus.COMPLETED });
    world.sportEvents.set(week3.id, { ...week3, status: SportEventStatus.COMPLETED });
    const week3SettledAt = new Date('2026-09-29T04:00:00.000Z');
    await settle(contest.id, week3.id, 'e1', week3SettledAt);

    await standings().queueDue(after(week3SettledAt, 31));

    expect(outbox.rows).toHaveLength(0);
  });

  function survivorBoard(contestId: string, weekIds: string[], entries: Array<{ entryId: string; squad: { id: string; name: string }; position: number; displayPosition?: string; weeksSurvived: number; outInWeek1?: { team: string | null } }>): SurvivorLeaderboardModel {
    return {
      contestId,
      weeks: weekIds.map((sportEventId, index) => ({
        sportEventId,
        weekNumber: index + 1,
        roundNumber: 1,
        roundCount: 1,
        name: `Week ${String(index + 1)}`,
        startDate: new Date(0),
        status: index === 0 ? SportEventStatus.COMPLETED : SportEventStatus.SCHEDULED,
        started: index === 0,
        aliveCount: index === 0 ? entries.filter((entry) => !entry.outInWeek1).length : 0,
      })),
      entries: entries.map((entry) => ({
        entryId: entry.entryId,
        entryName: `Entry ${entry.entryId}`,
        entryNumber: 1,
        squadId: entry.squad.id,
        squadName: entry.squad.name,
        alive: !entry.outInWeek1,
        eliminatedInWeek: entry.outInWeek1 ? 1 : null,
        weeksSurvived: entry.weeksSurvived,
        position: entry.position,
        displayPosition: entry.displayPosition ?? String(entry.position),
        weeks: weekIds.map((sportEventId, index) => ({
          sportEventId,
          roundNumber: 1,
          outcome: index === 0 ? (entry.outInWeek1 ? SurvivorWeekOutcome.ELIMINATED : SurvivorWeekOutcome.SURVIVED) : null,
          team: index === 0 ? (entry.outInWeek1 ? entry.outInWeek1.team : 'Kansas City Chiefs') : null,
        })),
      })),
    };
  }

  it('sends a settled survivor week\'s results with how many are still in, telling each reader whose entry went out how, and a picks link only to readers with an entry still in', async () => {
    const settledAt = new Date('2026-09-15T04:00:00.000Z');
    const { league, contest, week1, week2, week3 } = await liveWeeks(SelectionType.SURVIVOR, settledAt);
    const ana = member(league.id, 'Ana');
    const ben = member(league.id, 'Ben');
    survivorBoards.set(contest.id, survivorBoard(contest.id, [week1.id, week2.id, week3.id], [
      { entryId: 'e1', squad: ana.squad, position: 1, weeksSurvived: 1 },
      { entryId: 'e2', squad: ben.squad, position: 2, displayPosition: 'T2', weeksSurvived: 0, outInWeek1: { team: 'Chicago Bears' } },
      { entryId: 'e3', squad: ben.squad, position: 2, displayPosition: 'T2', weeksSurvived: 0, outInWeek1: { team: null } },
    ]));

    await standings().queueDue(after(settledAt, 31));

    const [toBen] = emailsTo(ben.user.id);
    expect(toBen.subject).toBe('After Week 1: Last One Standing');
    expect(toBen.textBody).toContain('Week 1 is done. 1 of 3 entries is still in Last One Standing.');
    expect(toBen.textBody).toContain('Entry e2 is out: Chicago Bears didn\'t win in Week 1.');
    expect(toBen.textBody).toContain('Entry e3 is out: it had no pick in Week 1.');
    expect(toBen.textBody).toContain('Standings, by weeks survived:\n1. Entry e1 (Ana\'s Squad), 1\nT2. Entry e2 (Ben\'s Squad), yours, 0, out');
    expect(toBen.textBody).not.toContain('Make picks for next week');
    const [toAna] = emailsTo(ana.user.id);
    expect(toAna.textBody).not.toContain(' is out:');
    expect(toAna.textBody).toContain('Make picks for next week: ');
  });

  it('logs a contest whose standings fail and still sends the others', async () => {
    const { league, masters, contest } = liveMasters();
    const ana = member(league.id, 'Ana');
    boards.set(contest.id, [row('e1', ana.squad, 1, -6)]);
    const broken = world.addContest(league.id, { name: 'Broken Pool', status: ContestStatus.ACTIVE, sportEventIds: [masters.id] });
    failingContestId = broken.id;

    await standings().queueDue(after(ROUND_1_DONE, 31));

    expect(outbox.rows).toHaveLength(1);
    const [failure] = logger.error.mock.calls.map(([entry]) => entry as { action?: string; data?: { contestId?: string } });
    expect(failure.action).toBe('email.liveStandings.failed');
    expect(failure.data?.contestId).toBe(broken.id);
  });
});
