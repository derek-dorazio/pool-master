/**
 * #1303 — the event lifecycle sweep and every clock-driven email's own sweep, through the app's client
 * against real Postgres, so the missing-index check plans what each pass sends. The unit tests
 * cover what each email says and when; this file runs a whole sweep, wired as index.ts wires it.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContestStatus, PickEmMode, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { PostgresJobLock } from '../../../packages/core-api/src/core/job-lock';
import { createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import { createEmailOutbox, EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email';
import { EventLifecycleScheduler } from '../../../packages/core-api/src/modules/events/event-lifecycle-scheduler';
import { createEventLifecycleService, createSportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import { DomainEvents } from '../../../packages/core-api/src/modules/domain-events';
import {
  createContestEmailJobs,
  createContestNotices,
  createDueNotifications,
  createMemberJoinedNotices,
  DueNotificationKind,
  DueNotificationsScheduler,
} from '../../../packages/core-api/src/modules/notifications';
import { createDrawReceipts } from '../../../packages/core-api/src/modules/selections/wiring';
import { fakeLogger } from '../../support/fake-logger';
import { cleanupTestData, createTestUser, getAppPrisma, getPrisma, integrationBackgroundJobs, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, HOUR, seedEventWithField, seedFootballWeek, seedLeagueWithTeams } from '../list-route-seeds';
import { integrationPlanEntitlements } from '../plan-entitlements';
import { contestOnEvents, contestTemplateId } from '../../support/contest-rows';

let jobLock: PostgresJobLock;

beforeAll(async () => {
  await setupIntegrationTests();
  jobLock = new PostgresJobLock(process.env.DATABASE_URL, fakeLogger());
});
afterAll(async () => {
  await jobLock.close();
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** The coming Monday at 09:00 UTC: past the 3am Eastern digest hour, winter or summer. */
function nextMonday(): Date {
  const monday = new Date(Date.now() + 7 * DAY);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  monday.setUTCHours(9, 0, 0, 0);
  return monday;
}

function daysFromNow(instant: Date): number {
  return (instant.getTime() - Date.now()) / DAY;
}

/** The sweep index.ts runs every five minutes, over the app's client, at `now`. */
function lifecycleSweep(now: Date) {
  const prisma = getAppPrisma();
  const logger = fakeLogger();
  const planEntitlements = integrationPlanEntitlements(prisma);
  const readConfig = () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
  const appBaseUrl = 'https://app.example.test';
  const { email } = createEmailOutbox({ prisma, readConfig, planEntitlements, env: process.env, logger });
  const jobs = integrationBackgroundJobs(prisma);
  const contestNotices = createContestNotices(prisma, { email, jobs: jobs.queue, appBaseUrl, logger });
  const contestEmailJobs = createContestEmailJobs(prisma, { notices: contestNotices, logger });
  jobs.runWith({
    CONTEST_STARTED_EMAILS: (payload) => contestEmailJobs.contestStarted(payload),
    CONTEST_SETTLED_EMAILS: (payload) => contestEmailJobs.contestSettled(payload),
    CONTEST_EVENT_CHANGED_EMAILS: (payload) => contestEmailJobs.contestEventChanged(payload),
    CONTEST_REOPENED_EMAILS: (payload) => contestEmailJobs.contestReopened(payload),
  });
  // What follows each change (#1946), as index.ts wires it.
  const domainEvents = new DomainEvents({
    queue: jobs.queue,
    sportEventChanged: contestNotices,
  });
  const eventLifecycleService = createEventLifecycleService(prisma, {
    domainEvents,
    logger,
    contestSettlement: createContestSettlementService(prisma, logger, { domainEvents }),
  });
  const scheduler = new EventLifecycleScheduler({
    sportEvents: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    eventLifecycleService,
    jobLock,
    logger,
    now: () => now,
  });
  // Each clock-driven email on its own sweep and lock, as index.ts wires them.
  const dueSchedulers = [
    ...createDueNotifications(prisma, {
      email,
      readConfig,
      appBaseUrl,
      logger,
      planEntitlements,
      memberJoined: createMemberJoinedNotices(prisma, { email, readConfig, appBaseUrl, logger }),
      releaseReadiness: createSportEventServices(prisma, logger, eventLifecycleService, domainEvents).sportEvents,
    }),
    { kind: DueNotificationKind.DRAW_RECEIPTS, notifications: createDrawReceipts(prisma, logger, { email, appBaseUrl, planEntitlements }) },
  ].map((due) => new DueNotificationsScheduler({ ...due, jobLock, logger, now: () => now }));
  /** The lifecycle sweep, then every kind's sweep, as their timers would run them. */
  const sweep = async (): Promise<void> => {
    await scheduler.runSweep();
    await Promise.all(dueSchedulers.map((due) => due.runSweep()));
  };
  return { sweep, logger };
}

async function contestOn(leagueId: string, sportEventIds: readonly string[], status: ContestStatus) {
  return getPrisma().contest.create({
    data: {
      leagueId,
      ...(await contestOnEvents(getPrisma(), sportEventIds)),
      name: `Sweep ${randomUUID().slice(0, 8)}`,
      status,
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.PICK_EM,
      // Opened long ago, and due a look from the entry reminder sweep, as opening it leaves it (#1170).
      ...(status === ContestStatus.DRAFT ? {} : { openedAt: new Date(0), nextReminderAt: new Date(0) }),
    },
  });
}

describe('event lifecycle sweep through the app client (#1303)', () => {
  it('starts an event whose start has passed, queues each of the six kinds of clock-driven email that is due, moves an ended preview to Free, and logs no failure from any step', async () => {
    const monday = nextMonday();
    const { commissioner, league, squads } = await seedLeagueWithTeams(2);
    const digest = await seedLeagueWithTeams(0);
    // The first league's preview period ends in a week, so it is reminded; the second's ended yesterday, so it moves to Free.
    await getPrisma().league.update({ where: { id: league.id }, data: { plan: 'PREMIUM', planRenewsAt: new Date(monday.getTime() + 7 * DAY) } });
    await getPrisma().league.update({
      where: { id: digest.league.id },
      data: { eventEmailDelivery: 'WEEKLY_DIGEST', plan: 'PREMIUM', planRenewsAt: new Date(monday.getTime() - DAY) },
    });
    // One at a time: each seed upserts the sport and its sports league.
    const underWay = await seedFootballWeek({ games: 2, startDate: new Date(monday.getTime() - 2 * DAY), status: SportEventStatus.IN_PROGRESS, played: 1 });
    const started = await seedFootballWeek({ games: 2, startDate: new Date(monday.getTime() - HOUR), status: SportEventStatus.SCHEDULED });
    // A pick'em season's first week settled 45 minutes ago, past the 30-minute standings buffer, and its second is to come.
    const weekOne = await seedFootballWeek({ games: 1, startDate: new Date(monday.getTime() - 6 * DAY), status: SportEventStatus.COMPLETED, played: 1 });
    const weekTwo = await seedFootballWeek({ games: 1, startDate: new Date(monday.getTime() + 4 * DAY), status: SportEventStatus.SCHEDULED });
    // Golf, as only the first week of a football season is told of.
    const ready = await seedEventWithField(2, { startsInDays: daysFromNow(monday) + 3 });
    const comingUp = await seedEventWithField(2, { startsInDays: daysFromNow(monday) + 8.5 });
    // Its first kickoff is in two hours, so the three-hour entry reminder is due.
    const closing = await seedFootballWeek({ games: 1, startDate: new Date(monday.getTime() + 2 * HOUR), status: SportEventStatus.SCHEDULED });
    // Starts in three days and is still a draft, so every active root admin is told.
    const stillDraft = await seedEventWithField(2, { startsInDays: daysFromNow(monday) + 3, status: SportEventStatus.DRAFT });
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const open = await contestOn(league.id, [started.event.id], ContestStatus.OPEN);
    const live = await contestOn(league.id, [underWay.event.id], ContestStatus.ACTIVE);
    const season = await contestOn(league.id, [weekOne.event.id, weekTwo.event.id], ContestStatus.ACTIVE);
    const reminded = await contestOn(league.id, [closing.event.id], ContestStatus.OPEN);
    for (const contest of [open, live, season]) {
      await getPrisma().contestEntry.createMany({
        data: squads.map((squad, index) => ({ contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Entry ${index}` })),
      });
    }
    // Standings and reminders read the contest's rules.
    await getPrisma().contestConfiguration.createMany({
      data: await Promise.all([season, reminded].map(async (contest) => ({
        contestId: contest.id,
        templateId: await contestTemplateId(getPrisma(), contest.id),
        selectionType: SelectionType.PICK_EM,
        configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
      }))),
    });
    const seasonEntries = await getPrisma().contestEntry.findMany({ where: { contestId: season.id }, orderBy: { name: 'asc' } });
    await getPrisma().contestEntryEventStanding.createMany({
      data: seasonEntries.map((entry, index) => ({
        contestId: season.id,
        contestEntryId: entry.id,
        sportEventId: weekOne.event.id,
        position: index + 1,
        countingPickLimit: 1,
        scoredPickCount: 1,
        totalScore: 1 - index,
        settledAt: new Date(monday.getTime() - 45 * 60_000),
      })),
    });
    // Joined yesterday, so the overnight member-joined digest has someone to tell the commissioner about.
    await getPrisma().leagueMembership.updateMany({
      where: { leagueId: league.id, role: 'MEMBER' },
      data: { joinedAt: new Date(monday.getTime() - 12 * HOUR) },
    });
    const { sweep, logger } = lifecycleSweep(monday);

    await sweep();

    expect(logger.error).not.toHaveBeenCalled();
    await expect(getPrisma().sportEvent.findUniqueOrThrow({ where: { id: started.event.id } })).resolves.toMatchObject({ status: SportEventStatus.IN_PROGRESS });
    const told = async (leagueId: string | null, userId: string) => (await getPrisma().emailMessage.findMany({ where: { leagueId, recipientUserId: userId } }))
      .map((message) => message.idempotencyKey.split(':').slice(0, 2).join(':'))
      .sort();
    await expect(told(league.id, commissioner.user.id)).resolves.toEqual([
      `CONTEST_ENTRY_REMINDER:${reminded.id}`,
      `CONTEST_STANDINGS:${season.id}`,
      `EVENT_COMING_UP:${comingUp.event.id}`,
      `EVENT_READY_FOR_CONTESTS:${ready.event.id}`,
      expect.stringMatching(/^LEAGUE_MEMBER_JOINED:/),
      expect.stringMatching(/^LEAGUE_PLAN_PREVIEW_ENDING:/),
    ]);
    // The standings go to the commissioner alone, as no member has an entry placed on the week's
    // board; the reminder goes to every member too, as no squad has an entry in that contest yet.
    for (const squad of squads) {
      const owner = await getPrisma().squadMembership.findFirstOrThrow({ where: { squadId: squad.id } });
      await expect(told(league.id, owner.userId)).resolves.toEqual([`CONTEST_ENTRY_REMINDER:${reminded.id}`]);
    }
    await expect(told(digest.league.id, digest.commissioner.user.id)).resolves.toEqual([expect.stringMatching(/^EVENT_WEEKLY_DIGEST:/)]);
    await expect(told(null, rootAdmin.user.id)).resolves.toEqual([`EVENT_STILL_DRAFT:${stillDraft.event.id}`]);
    await expect(getPrisma().league.findUniqueOrThrow({ where: { id: digest.league.id } })).resolves.toMatchObject({ plan: 'FREE' });
  });

  it('takes a live contest on a postponed week back to open until the week\'s new start, then starts it again at that start', async () => {
    const { league } = await seedLeagueWithTeams(1);
    const newStart = new Date(Date.now() + 3 * DAY);
    const week = await seedFootballWeek({ games: 2, startDate: newStart, status: SportEventStatus.POSTPONED });
    const contest = await contestOn(league.id, [week.event.id], ContestStatus.ACTIVE);
    await getPrisma().contest.update({ where: { id: contest.id }, data: { startsAt: new Date(Date.now() - DAY) } });

    const before = lifecycleSweep(new Date());
    await before.sweep();

    expect(before.logger.error).not.toHaveBeenCalled();
    await expect(getPrisma().contest.findUniqueOrThrow({ where: { id: contest.id } })).resolves.toMatchObject({ status: ContestStatus.OPEN, startsAt: newStart });

    await lifecycleSweep(new Date(newStart.getTime() + HOUR)).sweep();

    await expect(getPrisma().contest.findUniqueOrThrow({ where: { id: contest.id } })).resolves.toMatchObject({ status: ContestStatus.ACTIVE, startsAt: newStart });
  });

  it('completes an in-progress event covering no slot once its end date has passed, and leaves one covering a slot, one not yet ended and one with no end date in progress', async () => {
    const yesterday = new Date(Date.now() - DAY);
    const covering = await seedFootballWeek({ games: 1, startDate: new Date(Date.now() - 3 * DAY), status: SportEventStatus.IN_PROGRESS });
    await getPrisma().sportEvent.update({ where: { id: covering.event.id }, data: { endDate: yesterday } });
    const { sportLeagueId, sportLeagueSeasonId } = await getPrisma().sportEvent.findUniqueOrThrow({ where: { id: covering.event.id }, select: { sportLeagueId: true, sportLeagueSeasonId: true } });
    const slotless = (name: string, endDate: Date | null) => getPrisma().sportEvent.create({
      data: { sportLeagueId, sportLeagueSeasonId, name, startDate: new Date(Date.now() - 3 * DAY), endDate, status: SportEventStatus.IN_PROGRESS, autoLifecycleEnabled: true },
    });
    const ended = await slotless('Ended, no slot', yesterday);
    const notYet = await slotless('Not yet ended, no slot', new Date(Date.now() + DAY));
    const noEnd = await slotless('No end date, no slot', null);

    const { sweep, logger } = lifecycleSweep(new Date());
    await sweep();

    expect(logger.error).not.toHaveBeenCalled();
    const statusOf = async (id: string) => (await getPrisma().sportEvent.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    expect(await statusOf(ended.id)).toBe(SportEventStatus.COMPLETED);
    for (const id of [covering.event.id, notYet.id, noEnd.id]) expect(await statusOf(id)).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('keeps a contest open on an event under way until the slot it covers starts, then takes it live at that slot\'s first game, or once the slot is under way (#2013)', async () => {
    const { league } = await seedLeagueWithTeams(1);
    const slotStart = new Date(Date.now() + 3 * HOUR);
    const weeks = await Promise.all([1, 2].map(() => seedFootballWeek({ games: 1, startDate: new Date(Date.now() - 2 * HOUR), status: SportEventStatus.IN_PROGRESS })));
    const contests = [];
    for (const week of weeks) {
      // poolmaster-allow-query-in-loop: two events' fixtures
      const { sportLeagueSeasonCompetitionSlotId } = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: week.event.id }, select: { sportLeagueSeasonCompetitionSlotId: true } });
      await getPrisma().sportLeagueSeasonCompetitionSlot.update({ where: { id: sportLeagueSeasonCompetitionSlotId }, data: { startsAt: slotStart, status: 'SCHEDULED' } });
      contests.push({ slotId: sportLeagueSeasonCompetitionSlotId, contest: await contestOn(league.id, [week.event.id], ContestStatus.OPEN) });
    }
    const [byClock, byStatus] = contests;
    const statusOf = async (id: string) => getPrisma().contest.findUniqueOrThrow({ where: { id }, select: { status: true, startsAt: true } });

    await lifecycleSweep(new Date()).sweep();
    for (const { contest } of contests) expect((await statusOf(contest.id)).status).toBe(ContestStatus.OPEN);

    await getPrisma().sportLeagueSeasonCompetitionSlot.update({ where: { id: byStatus.slotId }, data: { status: 'IN_PROGRESS' } });
    await lifecycleSweep(new Date()).sweep();
    expect(await statusOf(byStatus.contest.id)).toEqual({ status: ContestStatus.ACTIVE, startsAt: slotStart });
    expect((await statusOf(byClock.contest.id)).status).toBe(ContestStatus.OPEN);

    await lifecycleSweep(new Date(slotStart.getTime() + HOUR)).sweep();
    expect(await statusOf(byClock.contest.id)).toEqual({ status: ContestStatus.ACTIVE, startsAt: slotStart });
  });

  it('runs a sweep with nothing due as a no-op, sending no email and logging no failure', async () => {
    const { league } = await seedLeagueWithTeams(1);
    const { sweep, logger } = lifecycleSweep(new Date());

    await sweep();

    expect(logger.error).not.toHaveBeenCalled();
    await expect(getPrisma().emailMessage.count({ where: { leagueId: league.id } })).resolves.toBe(0);
  });
});
