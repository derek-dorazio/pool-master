/**
 * Entry reminders (#845, catalog row D2): which reminder is due, who is told, and that a second
 * sweep never sends one twice. The contest world is in memory; the email service is the real one
 * over an in-memory outbox, so the tests assert on the emails recorded.
 */
import type { ContestEntrySeasonPrediction } from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  ContestStatus,
  LeagueMembershipStatus,
  MatchSide,
  MatchStatus,
  PredictedResult,
  SelectionType,
  SportEventStatus,
  type ContestEntrySquare,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { EntryReminders, dueReminderHours } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE, TEST_PLAN_ENTITLEMENTS } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

const HOUR = 60 * 60_000;
const CLOSES_AT = new Date('2026-04-09T11:40:00.000Z');
const HOURS = [48, 24, 3];

function before(closesAt: Date, hours: number, plusMinutes = 0): Date {
  return new Date(closesAt.getTime() - hours * HOUR + plusMinutes * 60_000);
}

describe('dueReminderHours', () => {
  it('is the 48-hour reminder once its time has come, and nothing before it', () => {
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 48, -1))).toBeNull();
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 48))).toBe(48);
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 48, 5))).toBe(48);
  });

  it('is only the latest reminder whose time has passed, so a late sweep never sends an older one', () => {
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 24, 5))).toBe(24);
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 3, 5))).toBe(3);
  });

  it('skips a reminder more than an hour late, such as one whose time passed before the contest opened', () => {
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 48, 61))).toBeNull();
    expect(dueReminderHours(CLOSES_AT, HOURS, before(CLOSES_AT, 30))).toBeNull();
  });

  it('is nothing once the picks have closed', () => {
    expect(dueReminderHours(CLOSES_AT, [48, 24, 3, 1], CLOSES_AT)).toBeNull();
  });

  it('reads the offsets in any order', () => {
    expect(dueReminderHours(CLOSES_AT, [3, 48, 24], before(CLOSES_AT, 24, 1))).toBe(24);
  });
});

describe('EntryReminders.queueDue', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let matches: SportEventMatch[];
  let predictions: ContestEntrySeasonPrediction[];
  let boxes: ContestEntrySquare[];
  let logger: ReturnType<typeof fakeLogger>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    matches = [];
    predictions = [];
    boxes = [];
    logger = fakeLogger();
  });

  function reminders(config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' })): EntryReminders {
    const email = new EmailService({
      messages: outbox,
      providerName: 'smtp',
      readConfig: () => config,
      planEntitlements: TEST_PLAN_ENTITLEMENTS,
      senderAddress: 'noreply@poolmaster.test',
      suppressions: inMemoryEmailSuppressions(),
      optOuts: inMemoryEmailOptOuts(),
      unsubscribe: TEST_UNSUBSCRIBE,
      logger,
    });
    return new EntryReminders({
      contests: world.contestRepo(),
      sportEvents: world.sportEventRepo(),
      configurations: world.configurationRepo(),
      matches: {
        findBySportEvent: async (sportEventId) => matches.filter((match) => match.sportEventId === sportEventId),
        findBySportEvents: async (sportEventIds) => matches.filter((match) => sportEventIds.includes(match.sportEventId)),
      },
      entries: world.entryRepo(),
      picks: world.pickRepo(),
      predictions: {
        findByEntriesAndEvent: async (entryIds, sportEventId) =>
          predictions.filter((pick) => entryIds.includes(pick.contestEntryId) && pick.sportEventId === sportEventId),
        findByEntriesAndEvents: async (entryIds, sportEventIds) =>
          predictions.filter((pick) => entryIds.includes(pick.contestEntryId) && sportEventIds.includes(pick.sportEventId)),
      },
      tiers: {
        getEffectiveTiersForSportEvent: async (sportEventId) =>
          (world.eventTiers.get(sportEventId) ?? []).map((tier) => ({ ...tier, participants: [] })),
      },
      squares: { findSquares: async (contestId) => boxes.filter((box) => box.contestId === contestId) },
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
  function member(leagueId: string, firstName: string, options: { membership?: LeagueMembershipStatus; isActive?: boolean } = {}) {
    const user = world.addUser({ firstName, lastName: 'Member', isActive: options.isActive ?? true });
    world.addMember(leagueId, user.id, { status: options.membership ?? LeagueMembershipStatus.ACTIVE });
    const squad = world.addSquad(leagueId, `${firstName}'s Squad`);
    world.addSquadMember(squad.id, user.id);
    return { user, squad };
  }

  async function enter(contestId: string, squadId: string, submittedFor?: string) {
    const created = await world.entryRepo().create({ contestId, squadId, entryNumber: 1, name: 'Entry 1', tiebreakerValue: null });
    if (created.status !== 'created') throw new Error('entry not created');
    if (submittedFor) {
      await world.entryRepo().setEventStatus(created.entry.id, submittedFor, ContestEntryStatus.SUBMITTED, new Date());
    }
    return created.entry;
  }

  function remindedUserIds(): string[] {
    return outbox.rows.map((row) => row.recipientUserId ?? '').sort();
  }

  it('reminds every active member of an open contest with nothing submitted, entered or not, and nobody who submitted', async () => {
    const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
    const masters = world.addSportEvent({ name: 'The Masters', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, { name: 'Masters Pick 6', sportEventIds: [masters.id] });
    const notEntered = member(league.id, 'Nora');
    const drafting = member(league.id, 'Dana');
    const submitted = member(league.id, 'Sam');
    member(league.id, 'Gone', { membership: LeagueMembershipStatus.INACTIVE });
    member(league.id, 'Closed', { isActive: false });
    await enter(contest.id, drafting.squad.id);
    await enter(contest.id, submitted.squad.id, masters.id);

    await reminders().queueDue(before(CLOSES_AT, 48, 3));

    expect(remindedUserIds()).toEqual([drafting.user.id, notEntered.user.id].sort());
    const byUser = new Map(outbox.rows.map((row) => [row.recipientUserId, row]));
    expect(byUser.get(notEntered.user.id)?.textBody).toContain('You haven\'t entered Masters Pick 6 for The Masters yet.');
    expect(byUser.get(drafting.user.id)?.textBody).toContain('Your The Masters entry is saved as a draft.');
    expect(byUser.get(drafting.user.id)?.textBody).toContain(`Make your picks: https://app.example.test/league/OFFICE24/contests/${contest.id}`);
    expect(outbox.rows.every((row) => row.templateKey === 'CONTEST_ENTRY_REMINDER' && row.fromName === 'Office League')).toBe(true);
  });

  it('queues each reminder once however many sweeps run in its hour, then the next one at its own time', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    world.addContest(league.id, { sportEventIds: [event.id] });
    const nora = member(league.id, 'Nora');
    const service = reminders();

    await service.queueDue(before(CLOSES_AT, 48, 1));
    await service.queueDue(before(CLOSES_AT, 48, 6));
    await service.queueDue(before(CLOSES_AT, 48, 55));
    expect(outbox.rows).toHaveLength(1);

    await service.queueDue(before(CLOSES_AT, 24, 1));
    await service.queueDue(before(CLOSES_AT, 3, 1));
    expect(outbox.rows.map((row) => row.idempotencyKey)).toEqual(
      [48, 24, 3].map((hours) => `CONTEST_ENTRY_REMINDER:${[...world.contests.keys()][0]}:${event.id}:${String(hours)}h:${nora.user.id}`),
    );
  });

  it('logs at info only the sweep that queues a reminder, not the later sweeps in its grace hour', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    world.addContest(league.id, { sportEventIds: [event.id] });
    member(league.id, 'Nora');
    member(league.id, 'Dana');
    const service = reminders();

    await service.queueDue(before(CLOSES_AT, 48, 1));
    expect(logger.info).toHaveBeenCalledTimes(2);
    logger.info.mockClear();
    await service.queueDue(before(CLOSES_AT, 48, 6));

    expect(logger.info).not.toHaveBeenCalled();
    expect(outbox.rows).toHaveLength(2);
  });

  it('sends one email to a person who owns two squads, and none when either squad submitted', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    const golf = world.addContest(league.id, { name: 'Golf', sportEventIds: [event.id] });
    const both = member(league.id, 'Bo');
    const secondSquad = world.addSquad(league.id, 'Bo\'s Second Squad');
    world.addSquadMember(secondSquad.id, both.user.id);
    const coOwner = world.addUser({ firstName: 'Cory' });
    world.addMember(league.id, coOwner.id);
    world.addSquadMember(secondSquad.id, coOwner.id);
    await enter(golf.id, both.squad.id);
    await enter(golf.id, secondSquad.id, event.id);

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(outbox.rows).toHaveLength(0);
  });

  it('reminds only the entry owners whose week is still a draft once a pick\'em season is live, since nobody can join it', async () => {
    const league = world.addLeague();
    const week6 = world.addSportEvent({ name: 'Week 6', status: SportEventStatus.COMPLETED, startDate: new Date('2026-10-15T00:15:00.000Z') });
    const week7 = world.addSportEvent({ name: 'Week 7', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, {
      status: ContestStatus.ACTIVE,
      selectionType: SelectionType.PICK_EM,
      sportEventIds: [week6.id, week7.id],
    });
    member(league.id, 'Nora');
    const drafting = member(league.id, 'Dana');
    const submitted = member(league.id, 'Sam');
    await enter(contest.id, drafting.squad.id, week6.id);
    await enter(contest.id, submitted.squad.id, week7.id);

    await reminders().queueDue(before(CLOSES_AT, 3, 2));

    expect(remindedUserIds()).toEqual([drafting.user.id]);
    expect(outbox.rows[0]?.textBody).toContain('Your Week 7 entry is saved as a draft.');
  });

  it('reminds members of a second-chance bracket before its starting round, after the event itself has started', async () => {
    const league = world.addLeague();
    const tournament = world.addSportEvent({
      name: 'March Madness',
      status: SportEventStatus.IN_PROGRESS,
      startDate: new Date('2026-03-19T16:00:00.000Z'),
    });
    const contest = world.addContest(league.id, { selectionType: SelectionType.BRACKET, sportEventIds: [tournament.id] });
    world.addConfiguration(contest.id, {
      selectionType: SelectionType.BRACKET,
      configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 3 },
    });
    matches = [2, 3].map((roundNumber) => ({
      id: `game-${String(roundNumber)}`,
      sportEventId: tournament.id,
      roundNumber,
      status: roundNumber === 2 ? MatchStatus.COMPLETED : MatchStatus.SCHEDULED,
      scheduledDate: roundNumber === 2 ? new Date('2026-03-21T16:00:00.000Z') : CLOSES_AT,
    }) as SportEventMatch);
    const nora = member(league.id, 'Nora');

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(remindedUserIds()).toEqual([nora.user.id]);
    expect(outbox.rows[0]?.textBody).toContain('You haven\'t entered');
  });

  it('sends no reminder within 6 hours of the contest opening, when the new contest email has just gone out', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    const now = before(CLOSES_AT, 24, 1);
    world.addContest(league.id, { sportEventIds: [event.id], openedAt: new Date(now.getTime() - 5 * HOUR) });
    const settled = world.addContest(league.id, { sportEventIds: [event.id], openedAt: new Date(now.getTime() - 6 * HOUR) });
    const nora = member(league.id, 'Nora');

    await reminders().queueDue(now);

    expect(remindedUserIds()).toEqual([nora.user.id]);
    expect(outbox.rows[0]?.idempotencyKey).toContain(settled.id);
  });

  it('leaves out drawn contests and contests not yet open', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    world.addContest(league.id, { drawnAt: new Date('2026-04-01T00:00:00.000Z'), sportEventIds: [event.id] });
    world.addContest(league.id, { status: ContestStatus.DRAFT, sportEventIds: [event.id] });
    member(league.id, 'Nora');

    await reminders().queueDue(before(CLOSES_AT, 48, 1));

    expect(outbox.rows).toHaveLength(0);
  });

  function pick(entryId: string, sportEventId: string, sportEventMatchId: string, participantId: string): ContestEntrySeasonPrediction {
    return {
      id: `prediction-${String(predictions.length + 1)}`,
      contestEntryId: entryId,
      sportEventId,
      sportEventMatchId,
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: `field-${participantId}`,
      participantId,
      confidence: null,
      pickedAt: new Date('2026-03-01T00:00:00.000Z'),
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    };
  }

  it('says how far along a member\'s only draft is: a tiered roster\'s picks of its size', async () => {
    const league = world.addLeague();
    const masters = world.addSportEvent({ name: 'The Masters', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, { sportEventIds: [masters.id] });
    world.addConfiguration(contest.id);
    world.addEventTiers(masters.id, 6);
    const dana = member(league.id, 'Dana');
    const entry = await enter(contest.id, dana.squad.id);
    for (const golfer of ['a', 'b', 'c', 'd']) world.addPick(entry.id, `golfer-${golfer}`, masters.id);

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(outbox.rows[0]?.textBody).toContain('Your The Masters entry is a draft with 4 of 6 picked.');
  });

  it('says how far along a pick\'em week\'s draft is, counting games not cancelled', async () => {
    const league = world.addLeague();
    const week = world.addSportEvent({ name: 'Week 7', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, { selectionType: SelectionType.PICK_EM, sportEventIds: [week.id] });
    world.addConfiguration(contest.id, {
      selectionType: SelectionType.PICK_EM,
      configJson: { selectionType: SelectionType.PICK_EM, mode: 'STRAIGHT_UP', againstTheSpread: false },
    });
    matches = [1, 2, 3].map((matchNumber) => ({
      id: `game-${String(matchNumber)}`,
      sportEventId: week.id,
      roundNumber: 1,
      matchNumber,
      status: matchNumber === 3 ? MatchStatus.CANCELLED : MatchStatus.SCHEDULED,
    }) as SportEventMatch);
    const dana = member(league.id, 'Dana');
    const entry = await enter(contest.id, dana.squad.id);
    predictions = [pick(entry.id, week.id, 'game-1', 'bears')];

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(outbox.rows[0]?.textBody).toContain('Your Week 7 entry is a draft with 1 of 2 picked.');
  });

  it('counts a member\'s drafts instead of showing one draft\'s progress when they have two', async () => {
    const league = world.addLeague();
    const masters = world.addSportEvent({ name: 'The Masters', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, { sportEventIds: [masters.id] });
    world.addConfiguration(contest.id);
    world.addEventTiers(masters.id, 6);
    const bo = member(league.id, 'Bo');
    const second = world.addSquad(league.id, 'Bo\'s Second Squad');
    world.addSquadMember(second.id, bo.user.id);
    await enter(contest.id, bo.squad.id);
    await enter(contest.id, second.id);

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(remindedUserIds()).toEqual([bo.user.id]);
    expect(outbox.rows[0]?.textBody).toContain('You have 2 draft entries for The Masters.');
  });

  it('reminds survivor entries still standing whose week is a draft, and nobody whose entries are out', async () => {
    const league = world.addLeague();
    const week1 = world.addSportEvent({ name: 'Week 1', status: SportEventStatus.COMPLETED, startDate: new Date('2026-04-02T17:00:00.000Z') });
    const week2 = world.addSportEvent({ name: 'Week 2', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, {
      status: ContestStatus.ACTIVE,
      selectionType: SelectionType.SURVIVOR,
      sportEventIds: [week1.id, week2.id],
    });
    matches = [{
      id: 'week1-game',
      sportEventId: week1.id,
      roundNumber: 1,
      status: MatchStatus.COMPLETED,
      winnerSide: MatchSide.HOME,
      homeSportEventParticipantId: 'field-bears',
      awaySportEventParticipantId: 'field-lions',
      scheduledDate: week1.startDate,
    } as SportEventMatch, {
      id: 'week2-game',
      sportEventId: week2.id,
      roundNumber: 1,
      status: MatchStatus.SCHEDULED,
      scheduledDate: CLOSES_AT,
    } as SportEventMatch];
    const standing = member(league.id, 'Sam');
    const beaten = member(league.id, 'Lou');
    const missed = member(league.id, 'Mo');
    const survivor = await enter(contest.id, standing.squad.id, week1.id);
    const loser = await enter(contest.id, beaten.squad.id, week1.id);
    await enter(contest.id, missed.squad.id);
    predictions = [pick(survivor.id, week1.id, 'week1-game', 'bears'), pick(loser.id, week1.id, 'week1-game', 'lions')];

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(remindedUserIds()).toEqual([standing.user.id]);
    expect(outbox.rows[0]?.textBody).toContain('Your Week 2 entry is saved as a draft.');
  });

  it('asks only members not yet in a random draw to join it, while it takes entries', async () => {
    const league = world.addLeague();
    const masters = world.addSportEvent({ name: 'The Masters', startDate: CLOSES_AT });
    const contest = world.addContest(league.id, { name: 'Sweepstake', selectionType: SelectionType.RANDOM_DRAW, sportEventIds: [masters.id] });
    const joined = member(league.id, 'Sam');
    const nora = member(league.id, 'Nora');
    await enter(contest.id, joined.squad.id);

    await reminders().queueDue(before(CLOSES_AT, 48, 1));

    expect(remindedUserIds()).toEqual([nora.user.id]);
    expect(outbox.rows[0]?.textBody).toContain('Just join Sweepstake before entries close.');
    expect(outbox.rows[0]?.textBody).toContain('Join the contest: ');
  });

  it('sends no squares reminder once every box on the grid is claimed, since there is nothing left to claim', async () => {
    const league = world.addLeague();
    const week = world.addSportEvent({ name: 'Super Bowl', startDate: new Date('2026-04-09T10:00:00.000Z') });
    const contest = world.addContest(league.id, {
      selectionType: SelectionType.SQUARES,
      sportEventIds: [week.id],
      squaresGameMatchId: 'big-game',
    });
    world.addConfiguration(contest.id, {
      selectionType: SelectionType.SQUARES,
      configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 100 },
    });
    matches = [{ id: 'big-game', sportEventId: week.id, roundNumber: 1, status: MatchStatus.SCHEDULED, scheduledDate: CLOSES_AT } as SportEventMatch];
    const holder = member(league.id, 'Sam');
    member(league.id, 'Nora');
    const holding = await enter(contest.id, holder.squad.id);
    boxes = Array.from({ length: 100 }, (_, index) => ({
      contestId: contest.id,
      contestEntryId: holding.id,
      rowIndex: Math.floor(index / 10),
      columnIndex: index % 10,
      claimedByUserId: holder.user.id,
      claimedAt: new Date(),
    }));

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(outbox.rows).toHaveLength(0);
  });

  it('asks squares members without a box to claim one before the game\'s kickoff, and nobody once the numbers are drawn', async () => {
    const league = world.addLeague();
    const week = world.addSportEvent({ name: 'Super Bowl', startDate: new Date('2026-04-09T10:00:00.000Z') });
    const contest = world.addContest(league.id, {
      name: 'Super Bowl Squares',
      selectionType: SelectionType.SQUARES,
      sportEventIds: [week.id],
      squaresGameMatchId: 'big-game',
    });
    world.addConfiguration(contest.id, {
      selectionType: SelectionType.SQUARES,
      configJson: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 },
    });
    matches = [{ id: 'big-game', sportEventId: week.id, roundNumber: 1, status: MatchStatus.SCHEDULED, scheduledDate: CLOSES_AT } as SportEventMatch];
    const holder = member(league.id, 'Sam');
    const nora = member(league.id, 'Nora');
    const holding = await enter(contest.id, holder.squad.id);
    boxes = [{ contestId: contest.id, contestEntryId: holding.id, rowIndex: 0, columnIndex: 0, claimedByUserId: holder.user.id, claimedAt: new Date() }];

    await reminders().queueDue(before(CLOSES_AT, 24, 1));

    expect(remindedUserIds()).toEqual([nora.user.id]);
    expect(outbox.rows[0]?.textBody).toContain('You haven\'t claimed a box on the Super Bowl Squares grid yet.');
    expect(outbox.rows[0]?.textBody).toContain('Game starts: Apr 9, 2026');

    world.contests.set(contest.id, { ...contest, drawnAt: new Date() });
    await reminders().queueDue(before(CLOSES_AT, 3, 1));
    expect(outbox.rows).toHaveLength(1);
  });

  it('sends nothing for an event whose picks have closed early because it has started', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ status: SportEventStatus.IN_PROGRESS, startDate: CLOSES_AT });
    world.addContest(league.id, { sportEventIds: [event.id] });
    member(league.id, 'Nora');

    await reminders().queueDue(before(CLOSES_AT, 3, 1));

    expect(outbox.rows).toHaveLength(0);
  });

  it('follows the offsets a root admin saved in EMAIL_CONFIG', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    world.addContest(league.id, { sportEventIds: [event.id] });
    member(league.id, 'Nora');
    const config = { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), entryReminderHours: [72] };

    await reminders(config).queueDue(before(CLOSES_AT, 48, 1));
    expect(outbox.rows).toHaveLength(0);

    await reminders(config).queueDue(before(CLOSES_AT, 72, 1));
    expect(outbox.rows.map((row) => row.idempotencyKey)).toEqual([expect.stringContaining(':72h:')]);
  });
});
