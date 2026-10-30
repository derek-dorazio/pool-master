/**
 * #1303 — the event lifecycle sweep, every clock-driven email in it, through the app's client
 * against real Postgres, so the missing-index check plans what each pass sends. The unit tests
 * cover what each email says and when; this file runs a whole sweep, wired as index.ts wires it.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContestStatus, PickEmMode, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { PostgresJobLock } from '../../../packages/core-api/src/core/job-lock';
import { createContestManagementService } from '../../../packages/core-api/src/modules/contest-management/wiring';
import { createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import { createEmailOutbox, EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email';
import { EventLifecycleScheduler } from '../../../packages/core-api/src/modules/events/event-lifecycle-scheduler';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import { createContestNotices, createDueNotifications, createMemberJoinedNotices } from '../../../packages/core-api/src/modules/notifications';
import { createDrawReceipts } from '../../../packages/core-api/src/modules/selections/wiring';
import { fakeLogger } from '../../support/fake-logger';
import { cleanupTestData, createTestUser, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, HOUR, seedEventWithField, seedFootballWeek, seedLeagueWithTeams } from '../list-route-seeds';
import { integrationPlanEntitlements } from '../plan-entitlements';

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
  const contestNotices = createContestNotices(prisma, { email, appBaseUrl, logger, planEntitlements });
  const scheduler = new EventLifecycleScheduler({
    sportEvents: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    eventLifecycleService: createEventLifecycleService(prisma, {
      logger,
      contestStarted: contestNotices,
      sportEventChanged: contestNotices,
      contestSettlement: createContestSettlementService(prisma, logger, { contestSettled: contestNotices }),
      releasedEditionContests: createContestManagementService(prisma, logger, planEntitlements),
    }),
    notificationsDue: [
      ...createDueNotifications(prisma, {
        email,
        readConfig,
        appBaseUrl,
        logger,
        planEntitlements,
        memberJoined: createMemberJoinedNotices(prisma, { email, readConfig, appBaseUrl, logger }),
      }),
      createDrawReceipts(prisma, logger, { email, appBaseUrl, planEntitlements }),
    ],
    jobLock,
    logger,
    now: () => now,
  });
  return { scheduler, logger };
}

async function contestOn(leagueId: string, sportEventIds: readonly string[], status: ContestStatus) {
  return getPrisma().contest.create({
    data: {
      leagueId,
      seasonYear: 2026,
      sportEvents: { create: sportEventIds.map((sportEventId, index) => ({ sportEventId, sequence: index + 1 })) },
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
      data: [season, reminded].map((contest) => ({
        contestId: contest.id,
        selectionType: SelectionType.PICK_EM,
        configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
      })),
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
    const { scheduler, logger } = lifecycleSweep(monday);

    await scheduler.runSweep();

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

  it('runs a sweep with nothing due as a no-op, sending no email and logging no failure', async () => {
    const { league } = await seedLeagueWithTeams(1);
    const { scheduler, logger } = lifecycleSweep(new Date());

    await scheduler.runSweep();

    expect(logger.error).not.toHaveBeenCalled();
    await expect(getPrisma().emailMessage.count({ where: { leagueId: league.id } })).resolves.toBe(0);
  });
});
