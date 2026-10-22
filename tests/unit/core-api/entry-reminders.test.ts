/**
 * Entry reminders (#845, catalog row D2): which reminder is due, who is told, and that a second
 * sweep never sends one twice. The contest world is in memory; the email service is the real one
 * over an in-memory outbox, so the tests assert on the emails recorded.
 */
import {
  ContestEntryStatus,
  ContestStatus,
  LeagueMembershipStatus,
  MatchStatus,
  SelectionType,
  SportEventStatus,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { EntryReminders, dueReminderHours } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
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
  let logger: ReturnType<typeof fakeLogger>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    matches = [];
    logger = fakeLogger();
  });

  function reminders(config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' })): EntryReminders {
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
    return new EntryReminders({
      contests: world.contestRepo(),
      sportEvents: world.sportEventRepo(),
      configurations: world.configurationRepo(),
      matches: { findBySportEvent: async (sportEventId) => matches.filter((match) => match.sportEventId === sportEventId) },
      entries: world.entryRepo(),
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

  it('leaves out survivor, random draw and squares contests, drawn contests and drafts not yet open', async () => {
    const league = world.addLeague();
    const event = world.addSportEvent({ startDate: CLOSES_AT });
    for (const selectionType of [SelectionType.SURVIVOR, SelectionType.RANDOM_DRAW, SelectionType.SQUARES]) {
      world.addContest(league.id, { selectionType, sportEventIds: [event.id] });
    }
    world.addContest(league.id, { drawnAt: new Date('2026-04-01T00:00:00.000Z'), sportEventIds: [event.id] });
    world.addContest(league.id, { status: ContestStatus.DRAFT, sportEventIds: [event.id] });
    member(league.id, 'Nora');

    await reminders().queueDue(before(CLOSES_AT, 48, 1));

    expect(outbox.rows).toHaveLength(0);
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
