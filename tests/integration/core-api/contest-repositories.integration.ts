import { randomUUID } from 'node:crypto';
import { ContestFormat, ContestStatus, ContestTemplateEventType, CupWeight, LeaguePaymentKind, SelectionType, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import type { ContestCreate } from '@poolmaster/shared/db';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryEventStandingRepository,
  PrismaContestEntryRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
  PrismaEmailMessageRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaSportEventRepository,
  PrismaStandingsEmailPositionRepository,
} from '../../../packages/core-api/src/adapters';
import { recordStatements, statementShape } from '../statement-log';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { mockFn } from '../../support/mock-fn';
import { expectDefined } from '../../support/expect-defined';
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';
import { deliverQueuedEmail, emailServiceOver } from '../../support/email-service';
import { EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email';
import { createContestNotices, createEntryReminders } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { integrationPlanEntitlements } from '../plan-entitlements';
import { createContestRow } from '../../support/contest-rows';

// The contest-cluster ports (#247) against real Postgres: what each read returns and in what
// order, what each write leaves behind, and that deleting a contest takes everything under it.
// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

function repos() {
  return {
    contests: new PrismaContestRepository(getAppPrisma()),
    entries: new PrismaContestEntryRepository(getAppPrisma()),
    picks: new PrismaContestEntryPickRepository(getAppPrisma()),
    standings: new PrismaContestEntryStandingRepository(getAppPrisma()),
    eventStandings: new PrismaContestEntryEventStandingRepository(getAppPrisma()),
  };
}

/** A league with two squads, and a golf event with three golfers on its field. */
async function createLeagueAndEvent() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Contest Repo ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `CREPO${suffix.toUpperCase()}`, name: `Contest Repo League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const [alpha, bravo] = await Promise.all([
    prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Alpha ${suffix}` } }),
    prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Bravo ${suffix}` } }),
  ]);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `contest-repo-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Contest Repo Open ${suffix}`,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      endDate: new Date('2026-06-07T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const field = [];
  for (const [name, role] of [['Golfer One', 'GOLFER'], ['Golfer Two', null], ['Golfer Three', null]] as const) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL', status: 'ACTIVE', role },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: true },
    }));
  }
  return { owner, league, squads: [alpha, bravo] as const, event, field, suffix };
}

/** A second golf event with a two-golfer field, starting after the first. */
async function createLaterEvent(suffix: string, startDate = new Date('2026-07-16T12:00:00.000Z')) {
  const prisma = getPrisma();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `contest-repo-later-${suffix}-${randomUUID().slice(0, 4)}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Contest Repo Later Open ${suffix}`,
      startDate,
      status: 'SCHEDULED',
    },
  });
  const field = [];
  for (const name of ['Later One', 'Later Two']) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: true },
    }));
  }
  return { event, field };
}

async function createContest(
  leagueId: string,
  sportEventId: string | readonly string[],
  name: string,
  status: ContestStatus = ContestStatus.ACTIVE,
) {
  return createContestRow(repos().contests, {
    leagueId,
    seasonYear: 2026,
    sportEventIds: typeof sportEventId === 'string' ? [sportEventId] : [...sportEventId],
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
  });
}

/** A contest expansion to `entriesPerContest` with its $0 payment history line, as a root admin grant writes them (#980). */
async function addExpansion(leagueId: string, contestId: string, entriesPerContest: number) {
  const prisma = getPrisma();
  const payment = await prisma.leaguePayment.create({
    data: { leagueId, contestId, kind: LeaguePaymentKind.CONTEST_EXPANSION_GRANT, amountCents: 0, description: `Up to ${entriesPerContest} entries, given free` },
  });
  await prisma.contestExpansion.create({ data: { contestId, entriesPerContest, paymentId: payment.id } });
}

/** An entry made through the port, so it carries a DRAFT status row in each contest event, as production's do. */
async function createEntry(contestId: string, squadId: string, entryNumber: number, name: string) {
  const result = await repos().entries.create({ contestId, squadId, entryNumber, name, tiebreakerValue: null }, { entriesPerContest: () => null });
  if (result.status !== 'created') throw new Error(`seed: entry ${name} refused (${result.status})`);
  return result.entry;
}

/** Submits one event of an entry, as a submit writes it: SUBMITTED, stamped `at`. */
async function submitEntryEvent(entryId: string, sportEventId: string, at: Date) {
  await getPrisma().contestEntryEvent.upsert({
    where: { contestEntryId_sportEventId: { contestEntryId: entryId, sportEventId } },
    create: { contestEntryId: entryId, sportEventId, status: 'SUBMITTED', submittedAt: at },
    update: { status: 'SUBMITTED', submittedAt: at },
  });
}

/** An entry's event statuses as [event, status] pairs, by event id. */
function byEvent(events: ReadonlyArray<{ sportEventId: string; status: string }>) {
  return events.map((row) => [row.sportEventId, row.status]).sort(([left], [right]) => left.localeCompare(right));
}

describe('ContestRepository', () => {
  it('creates a contest and reads it back with its event\'s sport', async () => {
    const { league, event } = await createLeagueAndEvent();

    const created = await createContest(league.id, event.id, 'Created Contest', ContestStatus.DRAFT);

    expect(created).toEqual(expect.objectContaining({
      leagueId: league.id,
      sportEventIds: [event.id],
      name: 'Created Contest',
      status: ContestStatus.DRAFT,
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      sport: Sport.GOLF,
    }));
    await expect(repos().contests.findById(created.id)).resolves.toEqual(created);
  });

  it('finds an event\'s contests oldest first, leaving out the excluded statuses', async () => {
    const { league, event } = await createLeagueAndEvent();
    const active = await createContest(league.id, event.id, 'Active');
    const completed = await createContest(league.id, event.id, 'Completed', ContestStatus.COMPLETED);
    const draft = await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);

    const all = await repos().contests.findBySportEvent(event.id);
    const unsettled = await repos().contests.findBySportEvent(event.id, {
      excludeStatuses: [ContestStatus.DRAFT, ContestStatus.COMPLETED],
    });

    expect(all.map((contest) => contest.id)).toEqual([active.id, completed.id, draft.id, open.id]);
    expect(unsettled.map((contest) => contest.id)).toEqual([active.id, open.id]);
  });

  it('narrows an event\'s contests to some statuses', async () => {
    const { league, event } = await createLeagueAndEvent();
    await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);
    const live = await createContest(league.id, event.id, 'Live', ContestStatus.ACTIVE);

    const pending = await repos().contests.findBySportEvent(event.id, {
      statuses: [ContestStatus.OPEN, ContestStatus.ACTIVE],
    });

    expect(pending.map((contest) => contest.id)).toEqual([open.id, live.id]);
  });

  it('finds every league\'s contests in the given statuses, oldest first, with their events', async () => {
    const first = await createLeagueAndEvent();
    const second = await createLeagueAndEvent();
    const open = await createContest(first.league.id, first.event.id, 'Open', ContestStatus.OPEN);
    await createContest(first.league.id, first.event.id, 'Draft', ContestStatus.DRAFT);
    const live = await createContest(second.league.id, second.event.id, 'Live', ContestStatus.ACTIVE);
    await createContest(second.league.id, second.event.id, 'Completed', ContestStatus.COMPLETED);

    const found = await repos().contests.findByStatuses([ContestStatus.OPEN, ContestStatus.ACTIVE]);

    const ours = found.filter((contest) => [first.league.id, second.league.id].includes(contest.leagueId));
    expect(ours.map((contest) => [contest.id, contest.sportEventIds])).toEqual([
      [open.id, [first.event.id]],
      [live.id, [second.event.id]],
    ]);
  });

  describe('entry reminder checks (#1170)', () => {
    const nextReminderAtOf = async (contestId: string) =>
      (await getPrisma().contest.findUniqueOrThrow({ where: { id: contestId }, select: { nextReminderAt: true } })).nextReminderAt;

    it('sets the first check as a contest opens, and answers only the contests whose check has come, oldest check first, in any status', async () => {
      const { league, event } = await createLeagueAndEvent();
      const draft = await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
      const openedAt = new Date('2026-06-01T12:00:00.000Z');
      await repos().contests.transitionStatus(draft.id, { from: [ContestStatus.DRAFT], to: ContestStatus.OPEN, openedAt, nextReminderAt: openedAt });
      const finished = await createContest(league.id, event.id, 'Finished', ContestStatus.COMPLETED);
      const later = await createContest(league.id, event.id, 'Later', ContestStatus.OPEN);
      await getPrisma().contest.update({ where: { id: finished.id }, data: { nextReminderAt: new Date('2026-05-31T12:00:00.000Z') } });
      await getPrisma().contest.update({ where: { id: later.id }, data: { nextReminderAt: new Date('2026-06-02T12:00:00.000Z') } });

      const due = await repos().contests.findReminderChecksDue(new Date('2026-06-01T12:30:00.000Z'));

      expect(due.filter((contest) => contest.leagueId === league.id).map((contest) => [contest.id, contest.sportEventIds]))
        .toEqual([[finished.id, [event.id]], [draft.id, [event.id]]]);
      await expect(nextReminderAtOf(draft.id)).resolves.toEqual(openedAt);
    });

    it('sets each contest its own next check, or clears it, in one transaction however many contests share a time', async () => {
      const { league, event } = await createLeagueAndEvent();
      const contests = await Promise.all(['A', 'B', 'C'].map((name) => createContest(league.id, event.id, name, ContestStatus.OPEN)));
      const sweptAt = new Date('2026-06-01T12:00:00.000Z');
      await repos().contests.recheckReminders({ contestIds: contests.map((contest) => contest.id) }, sweptAt);
      const at = new Date('2026-06-02T12:00:00.000Z');
      const [a, b, c] = contests;
      await repos().contests.scheduleReminderChecks([{ contestId: a.id, at }, { contestId: b.id, at: null }, { contestId: c.id, at }], sweptAt);

      await expect(Promise.all(contests.map((contest) => nextReminderAtOf(contest.id)))).resolves.toEqual([at, null, at]);
    });

    it('keeps a recheck made while the sweep ran instead of the time the sweep worked out from the old schedule', async () => {
      const { league, event } = await createLeagueAndEvent();
      const contest = await createContest(league.id, event.id, 'Moved', ContestStatus.OPEN);
      const sweptAt = new Date('2026-06-01T12:00:00.000Z');
      await repos().contests.recheckReminders({ contestIds: [contest.id] }, sweptAt);
      // An admin moves the event's start after the sweep read the contest.
      const rechecked = new Date('2026-06-01T12:00:05.000Z');
      await repos().contests.recheckReminders({ sportEventId: event.id }, rechecked);

      await repos().contests.scheduleReminderChecks([{ contestId: contest.id, at: new Date('2026-06-03T12:00:00.000Z') }], sweptAt);

      await expect(nextReminderAtOf(contest.id)).resolves.toEqual(rechecked);
    });

    it('rechecks only the open and live contests named or on the event, leaving drafts, finished contests and other events alone', async () => {
      const { league, event, suffix } = await createLeagueAndEvent();
      const other = await createLaterEvent(suffix);
      const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);
      const live = await createContest(league.id, [event.id, other.event.id], 'Live', ContestStatus.ACTIVE);
      const draft = await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
      const done = await createContest(league.id, event.id, 'Done', ContestStatus.COMPLETED);
      const elsewhere = await createContest(league.id, other.event.id, 'Elsewhere', ContestStatus.OPEN);
      const at = new Date('2026-06-01T12:00:00.000Z');

      await repos().contests.recheckReminders({ sportEventId: event.id }, at);
      const byEvent = await Promise.all([open, live, draft, done, elsewhere].map((contest) => nextReminderAtOf(contest.id)));
      await repos().contests.recheckReminders({ contestIds: [elsewhere.id, draft.id] }, at);

      expect(byEvent).toEqual([at, at, null, null, null]);
      await expect(nextReminderAtOf(elsewhere.id)).resolves.toEqual(at);
      await expect(nextReminderAtOf(draft.id)).resolves.toBeNull();
    });
  });

  it('finds only the drafts past their first hours whose first event starts by the time asked and has not started or finished, never other drafts (#1170)', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const soon = await createContest(league.id, [event.id, later.event.id], 'Soon', ContestStatus.DRAFT);
    const laterFirst = await createContest(league.id, [later.event.id, event.id], 'Later first', ContestStatus.DRAFT);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);
    await getPrisma().contest.updateMany({
      where: { id: { in: [soon.id, laterFirst.id, open.id] } },
      data: { createdAt: new Date('2026-06-01T00:00:00.000Z') },
    });
    const young = await createContest(league.id, event.id, 'Young', ContestStatus.DRAFT);
    await getPrisma().contest.update({ where: { id: young.id }, data: { createdAt: new Date('2026-06-03T00:00:00.000Z') } });
    // Left unopened past an event that has since finished.
    const finishedEvent = await createLaterEvent(suffix, new Date('2026-05-01T12:00:00.000Z'));
    await getPrisma().sportEvent.update({ where: { id: finishedEvent.event.id }, data: { status: 'COMPLETED' } });
    const abandoned = await createContest(league.id, finishedEvent.event.id, 'Abandoned', ContestStatus.DRAFT);
    await getPrisma().contest.update({ where: { id: abandoned.id }, data: { createdAt: new Date('2026-04-01T00:00:00.000Z') } });

    const drafts = await repos().contests.findDraftsStartingBy({
      firstStartsBy: new Date('2026-06-05T00:00:00.000Z'),
      createdBy: new Date('2026-06-02T00:00:00.000Z'),
      firstStatuses: [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED],
    });

    expect(drafts.filter((contest) => contest.leagueId === league.id).map((contest) => contest.id)).toEqual([soon.id]);
  });

  it("finds only the league's own contests open for entries, oldest first, by id and name", async () => {
    const { league, event } = await createLeagueAndEvent();
    const other = await createLeagueAndEvent();
    const first = await createContest(league.id, event.id, 'First Open', ContestStatus.OPEN);
    await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    await createContest(league.id, event.id, 'Live', ContestStatus.ACTIVE);
    const second = await createContest(league.id, event.id, 'Second Open', ContestStatus.OPEN);
    await createContest(other.league.id, other.event.id, 'Elsewhere', ContestStatus.OPEN);

    await expect(repos().contests.findOpenByLeague(league.id)).resolves.toEqual([
      { id: first.id, name: 'First Open' },
      { id: second.id, name: 'Second Open' },
    ]);
  });

  it("lists a league's current contests newest first, leaving out finished ones and drafts with an event already started (#1161)", async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const other = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    // Between the first event's start (June 4) and the later one's (July 16).
    const now = new Date('2026-06-10T12:00:00.000Z');
    const live = await createContest(league.id, event.id, 'Live', ContestStatus.ACTIVE);
    await createContest(league.id, event.id, 'Finished', ContestStatus.COMPLETED);
    await createContest(league.id, event.id, 'Stale Draft', ContestStatus.DRAFT);
    // One event under way already: it can no longer open, and the started event cannot be removed.
    await createContest(league.id, [event.id, later.event.id], 'Partly Started Draft', ContestStatus.DRAFT);
    const upcomingDraft = await createContest(league.id, later.event.id, 'Draft On An Event To Come', ContestStatus.DRAFT);
    const emptyDraft = await createContest(league.id, [], 'Draft With No Event', ContestStatus.DRAFT);
    const open = await createContest(league.id, later.event.id, 'Open', ContestStatus.OPEN);
    await createContest(other.league.id, other.event.id, 'Elsewhere', ContestStatus.OPEN);

    const current = await repos().contests.findCurrentByLeague(league.id, now);

    expect(current.map((contest) => contest.id)).toEqual([open.id, emptyDraft.id, upcomingDraft.id, live.id]);
  });

  /** Four drafts on the event: brackets from round 1 and round 2, and squares with no game and with one. */
  async function createLateCutoffDrafts(leagueId: string, eventId: string) {
    const prisma = getPrisma();
    const bracket = async (name: string, startsAtRound: number) => {
      const contest = await createContestRow(repos().contests, {
        leagueId, seasonYear: 2026, sportEventIds: [eventId], name,
        status: ContestStatus.DRAFT, contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.BRACKET,
      });
      await prisma.contestConfiguration.create({
        data: { contestId: contest.id, selectionType: SelectionType.BRACKET, configJson: { selectionType: SelectionType.BRACKET, startsAtRound } },
      });
      return contest;
    };
    const squares = (name: string, gameMatchId?: string) => createContestRow(repos().contests, {
      leagueId, seasonYear: 2026, sportEventIds: [eventId], name,
      status: ContestStatus.DRAFT, contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.SQUARES,
      ...(gameMatchId !== undefined && { squaresGameMatchId: gameMatchId }),
    });
    const round = await prisma.sportEventRound.create({ data: { sportEventId: eventId, roundNumber: 1, scheduledDate: new Date('2026-06-04T12:00:00.000Z') } });
    const game = await prisma.sportEventMatch.create({
      data: { sportEventId: eventId, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: true },
    });
    return {
      roundOne: await bracket('Full Bracket', 1),
      secondChance: await bracket('Second Chance', 2),
      noGame: await squares('Squares With No Game'),
      withGame: await squares('Late Game Squares', game.id),
    };
  }

  it('keeps a draft closing after its event starts, a bracket from round 2 on or squares with its game, and leaves out a round-1 bracket and squares with no game once the event has started (#1217)', async () => {
    const { league, event } = await createLeagueAndEvent();
    // The event started June 4 and is still under way.
    const now = new Date('2026-06-05T12:00:00.000Z');
    await getPrisma().sportEvent.update({ where: { id: event.id }, data: { status: 'IN_PROGRESS' } });
    const drafts = await createLateCutoffDrafts(league.id, event.id);

    const current = await repos().contests.findCurrentByLeague(league.id, now);

    expect(current.map((contest) => contest.id)).toEqual([drafts.withGame.id, drafts.secondChance.id]);
  });

  it('counts an event under way before its start date as started, leaving out its round-1 bracket draft and keeping its round-2 one (#1217)', async () => {
    const { league, event } = await createLeagueAndEvent();
    // Before the June 4 start date, but the event is already IN_PROGRESS.
    const now = new Date('2026-06-01T12:00:00.000Z');
    await getPrisma().sportEvent.update({ where: { id: event.id }, data: { status: 'IN_PROGRESS' } });
    const drafts = await createLateCutoffDrafts(league.id, event.id);

    const current = await repos().contests.findCurrentByLeague(league.id, now);

    expect(current.map((contest) => contest.id)).toEqual([drafts.withGame.id, drafts.secondChance.id]);
  });

  it('leaves out every draft with an event finished or cancelled, even a later-round bracket, squares with its game, or a draft whose event has not started (#1217)', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const prisma = getPrisma();
    const now = new Date('2026-06-10T12:00:00.000Z');
    await prisma.sportEvent.update({ where: { id: event.id }, data: { status: 'COMPLETED' } });
    await createLateCutoffDrafts(league.id, event.id);
    const called = await createLaterEvent(suffix);
    await prisma.sportEvent.update({ where: { id: called.event.id }, data: { status: 'CANCELLED' } });
    await createContest(league.id, called.event.id, 'Draft On A Cancelled Event', ContestStatus.DRAFT);
    const upcoming = await createLaterEvent(suffix);
    const kept = await createContest(league.id, upcoming.event.id, 'Draft On An Event To Come', ContestStatus.DRAFT);

    const current = await repos().contests.findCurrentByLeague(league.id, now);

    expect(current.map((contest) => contest.id)).toEqual([kept.id]);
  });

  it("lists only a league's contests in the given statuses", async () => {
    const { league, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);
    await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    await createContest(league.id, event.id, 'Live', ContestStatus.ACTIVE);

    const found = await repos().contests.findByLeague(league.id, [ContestStatus.OPEN]);

    expect(found.map((contest) => contest.id)).toEqual([open.id]);
  });

  it("lists a league's contests that finished in a time range, latest finish first, and the US Eastern years they finished in (#1161)", async () => {
    const { league, event } = await createLeagueAndEvent();
    const other = await createLeagueAndEvent();
    const finishAt = async (name: string, endsAt: Date, status: ContestStatus = ContestStatus.COMPLETED) => {
      const contest = await createContest(league.id, event.id, name, status);
      await getPrisma().contest.update({ where: { id: contest.id }, data: { endsAt } });
      return contest;
    };
    const spring = await finishAt('Spring', new Date('2025-04-14T00:00:00.000Z'));
    // 10 p.m. New Year's Eve in New York: still 2025 there.
    const newYearsEve = await finishAt('New Years Eve', new Date('2026-01-01T03:00:00.000Z'));
    await finishAt('Summer', new Date('2026-07-01T00:00:00.000Z'));
    await finishAt('Live, ends later', new Date('2025-06-01T00:00:00.000Z'), ContestStatus.ACTIVE);
    const elsewhere = await createContest(other.league.id, other.event.id, 'Elsewhere', ContestStatus.COMPLETED);
    await getPrisma().contest.update({ where: { id: elsewhere.id }, data: { endsAt: new Date('2024-05-01T00:00:00.000Z') } });

    const in2025 = await repos().contests.findFinishedByLeague(
      league.id, new Date('2025-01-01T05:00:00.000Z'), new Date('2026-01-01T05:00:00.000Z'));

    expect(in2025.map((contest) => contest.id)).toEqual([newYearsEve.id, spring.id]);
    await expect(repos().contests.findFinishedYearsByLeague(league.id)).resolves.toEqual([2026, 2025]);
  });

  it('transitions a contest only from the given statuses: the second run changes nothing and says so', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'To Start', ContestStatus.OPEN);
    const startsAt = new Date('2026-06-04T12:00:00.000Z');
    const start = { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE, startsAt };

    await expect(repos().contests.transitionStatus(contest.id, start)).resolves.toBe(true);
    await expect(repos().contests.transitionStatus(contest.id, start)).resolves.toBe(false);
    const started = await repos().contests.findById(contest.id);
    expect(started).toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt, endsAt: undefined }));

    const endsAt = new Date('2026-06-07T22:00:00.000Z');
    await expect(repos().contests.transitionStatus(contest.id, {
      from: [ContestStatus.ACTIVE], to: ContestStatus.COMPLETED, endsAt,
    })).resolves.toBe(true);
    const completed = await repos().contests.findById(contest.id);
    expect(completed).toEqual(expect.objectContaining({ status: ContestStatus.COMPLETED, startsAt, endsAt }));
  });

  it('transitions several contests in one write, only those still in the given statuses, and answers the ids it moved', async () => {
    const { league, event } = await createLeagueAndEvent();
    const first = await createContest(league.id, event.id, 'First to start', ContestStatus.OPEN);
    const second = await createContest(league.id, event.id, 'Second to start', ContestStatus.OPEN);
    const live = await createContest(league.id, event.id, 'Already live', ContestStatus.ACTIVE);
    const startsAt = new Date('2026-06-04T12:00:00.000Z');
    const start = { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE, startsAt };

    const moved = await repos().contests.transitionStatuses([first.id, second.id, live.id], start);

    expect([...moved].sort()).toEqual([first.id, second.id].sort());
    await expect(repos().contests.transitionStatuses([first.id, second.id], start)).resolves.toEqual([]);
    await expect(repos().contests.transitionStatuses([], start)).resolves.toEqual([]);
    for (const id of [first.id, second.id]) {
      await expect(repos().contests.findById(id)).resolves.toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt }));
    }
    await expect(repos().contests.findById(live.id)).resolves.toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt: undefined }));
  });

  it('sets a cup weight only while the contest is in the given statuses, and says when it changed nothing', async () => {
    const { league, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Weighted', ContestStatus.OPEN);
    const settled = await createContest(league.id, event.id, 'Settled', ContestStatus.COMPLETED);
    const unsettled = [ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.ACTIVE];

    await expect(repos().contests.setCupWeight(open.id, CupWeight.DOUBLE, unsettled)).resolves.toBe(true);
    await expect(repos().contests.setCupWeight(settled.id, CupWeight.NOT_COUNTED, unsettled)).resolves.toBe(false);
    expect((await repos().contests.findById(open.id))?.cupWeight).toBe(CupWeight.DOUBLE);
    expect((await repos().contests.findById(settled.id))?.cupWeight).toBe(CupWeight.NORMAL);
  });

  it('deletes a DRAFT contest whose configuration carries a scoring rule and a prize definition, with everything under it', async () => {
    // Before #247 the delete left the configuration's rules and prizes in place, so the
    // configuration's own delete failed on their foreign keys. #246's backfill gave every golf
    // configuration a rule, which made that every DRAFT golf contest.
    const prisma = getPrisma();
    const { league, squads, event, field } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Draft With Rules', ContestStatus.DRAFT);
    const configuration = await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'TIERED',
        participantScoringRules: {
          create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 },
        },
        prizeDefinitions: {
          create: { prizeDefinitionId: 'WINNER', displayName: 'Winner', sortOrder: 1 },
        },
      },
    });
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Entry' },
    });
    await prisma.contestEntryPick.create({
      data: { entryId: entry.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1 },
    });
    await repos().standings.upsertMany(contest.id, [{
      contestId: contest.id,
      contestEntryId: entry.id,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 1,
      scoredPickCount: 1,
      asOf: null,
      settledAt: new Date(),
      totalScore: -3,
    }]);

    await repos().contests.delete(contest.id);

    await expect(repos().contests.findById(contest.id)).resolves.toBeNull();
    const remaining = await Promise.all([
      prisma.contestConfiguration.count({ where: { id: configuration.id } }),
      prisma.participantContestScoringRule.count({ where: { contestConfigurationId: configuration.id } }),
      prisma.contestPrizeDefinition.count({ where: { contestConfigurationId: configuration.id } }),
      prisma.contestEntry.count({ where: { contestId: contest.id } }),
      prisma.contestEntryPick.count({ where: { entryId: entry.id } }),
      prisma.contestEntryStanding.count({ where: { contestId: contest.id } }),
    ]);
    expect(remaining).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('updates only the contest fields given and returns the contest with its event\'s sport, as every read does', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Before', ContestStatus.DRAFT);
    const startsAt = new Date('2026-06-04T12:00:00.000Z');

    const renamed = await repos().contests.update(contest.id, { name: 'After', startsAt });

    expect(renamed).toEqual(expect.objectContaining({
      name: 'After',
      startsAt,
      status: ContestStatus.DRAFT,
      sportEventIds: [event.id],
      sport: Sport.GOLF,
    }));
    await expect(repos().contests.findById(contest.id)).resolves.toEqual(renamed);
  });

  it('creates a contest on several events, reads them back in the given sequence, and finds it from each of its events', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);

    const created = await createContest(league.id, [event.id, later.event.id], 'Two Majors');

    expect(created.sportEventIds).toEqual([event.id, later.event.id]);
    await expect(getPrisma().contestSportEvent.findMany({
      where: { contestId: created.id },
      orderBy: { sequence: 'asc' },
      select: { sportEventId: true, sequence: true },
    })).resolves.toEqual([{ sportEventId: event.id, sequence: 1 }, { sportEventId: later.event.id, sequence: 2 }]);
    expect((await repos().contests.findBySportEvent(event.id)).map((contest) => contest.id)).toEqual([created.id]);
    expect((await repos().contests.findBySportEvent(later.event.id)).map((contest) => contest.id)).toEqual([created.id]);
  });

  it('adds an event to a contest with a DRAFT status for it on every entry, renumbering the sequence by the order given', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, event.id, 'Growing', ContestStatus.OPEN);
    const entry = await createEntry(contest.id, squads[0].id, 1, 'Grower');
    await submitEntryEvent(entry.id, event.id, new Date('2026-06-01T12:00:00.000Z'));

    await repos().contests.replaceSportEvents(contest.id, [later.event.id, event.id]);

    expect((await repos().contests.findById(contest.id))?.sportEventIds).toEqual([later.event.id, event.id]);
    const reread = expectDefined(await repos().entries.findByIdWithSquad(entry.id));
    expect(byEvent(reread.events)).toEqual([
      [event.id, 'SUBMITTED'],
      [later.event.id, 'DRAFT'],
    ].sort(([left], [right]) => left.localeCompare(right)));
  });

  it('removes an event from a contest with each entry\'s status and picks in it, keeping the other event\'s', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Shrinking', ContestStatus.OPEN);
    const entry = await createEntry(contest.id, squads[0].id, 1, 'Shrinker');
    await prisma.contestEntryPick.createMany({
      data: [
        { entryId: entry.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: entry.id, sportEventParticipantId: later.field[0].id, contestFormat: 'ROSTER', slot: 1 },
      ],
    });

    await repos().contests.replaceSportEvents(contest.id, [later.event.id]);

    expect((await repos().contests.findById(contest.id))?.sportEventIds).toEqual([later.event.id]);
    const reread = expectDefined(await repos().entries.findByIdWithSquad(entry.id));
    expect(byEvent(reread.events)).toEqual([[later.event.id, 'DRAFT']]);
    const picks = await repos().picks.findByEntriesWithParticipant([entry.id]);
    expect(picks.map((pick) => [pick.sportEventParticipantId, pick.sportEventId])).toEqual([[later.field[0].id, later.event.id]]);
  });
});

/**
 * A 2026 event in a second sports league: a real one from the reference data, with a series of
 * this test's own. `remove` deletes it with every contest on it.
 */
async function createSecondTourEvent(fixtureEventSeriesId: string, suffix: string) {
  const prisma = getPrisma();
  const fixtureTourId = (await prisma.eventSeries.findUniqueOrThrow({ where: { id: fixtureEventSeriesId } })).sportLeagueId;
  const secondTour = await prisma.sportLeague.findFirstOrThrow({ where: { id: { not: fixtureTourId } } });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: secondTour.id, name: `Plan Cap Series ${suffix}` } });
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id,
      eventYear: 2026,
      externalId: `plan-cap-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Plan Cap Classic ${suffix}`,
      startDate: new Date('2026-08-04T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const remove = async () => {
    await prisma.contest.deleteMany({ where: { sportEvents: { some: { sportEventId: event.id } } } });
    await prisma.sportEvent.delete({ where: { id: event.id } });
    await prisma.eventSeries.delete({ where: { id: series.id } });
  };
  return { fixtureTourId, secondTourId: secondTour.id, event, remove };
}

/** A new 2026 draft contest on `sportEventId`, as Create contest asks the port for one. */
function draftOn(leagueId: string, sportEventId: string, name: string, seasonYear = 2026): ContestCreate {
  return {
    leagueId, seasonYear, sportEventIds: [sportEventId], name,
    status: ContestStatus.DRAFT, contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED,
  };
}

describe('ContestRepository.findSportLeagueIdsBySeason (#947)', () => {
  it('lists the different sports leagues of the league\'s contests of one season, drafts included, and nothing from other seasons or leagues', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const other = await createLeagueAndEvent();
    const second = await createSecondTourEvent(event.eventSeriesId, suffix);
    try {
      await createContest(league.id, event.id, 'Fixture One');
      await createContest(league.id, event.id, 'Fixture Draft', ContestStatus.DRAFT);
      await createContest(league.id, second.event.id, 'Second Tour');
      await createContestRow(repos().contests, {
        leagueId: league.id, seasonYear: 2025, sportEventIds: [event.id], name: 'Last Year',
        status: ContestStatus.COMPLETED, contestFormat: 'ROSTER', selectionType: 'TIERED',
      });
      await createContest(other.league.id, second.event.id, 'Another League');

      expect((await repos().contests.findSportLeagueIdsBySeason(league.id, 2026)).sort())
        .toEqual([second.fixtureTourId, second.secondTourId].sort());
      expect(await repos().contests.findSportLeagueIdsBySeason(league.id, 2025)).toEqual([second.fixtureTourId]);
      expect(await repos().contests.findSportLeagueIdsBySeason(other.league.id, 2025)).toEqual([]);
    } finally {
      await second.remove();
    }
  });
});

describe('ContestRepository sports leagues a year (#947)', () => {
  it('creates a season\'s contests in its one allowed sports league, and refuses one in another with sportsLeagueLimitReached, storing nothing', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const second = await createSecondTourEvent(event.eventSeriesId, suffix);
    const fixtureLimit = { sportLeaguesPerYear: 1, sportLeagueId: second.fixtureTourId };
    try {
      const first = await repos().contests.create(draftOn(league.id, event.id, 'First'), fixtureLimit);
      expect(first.status).toBe('created');

      const refused = await repos().contests.create(
        draftOn(league.id, second.event.id, 'Over the cap'),
        { sportLeaguesPerYear: 1, sportLeagueId: second.secondTourId },
      );
      expect(refused).toEqual({ status: 'sportsLeagueLimitReached', sportLeaguesPerYear: 1, sportLeagueCount: 1 });
      expect(await getPrisma().contest.count({ where: { leagueId: league.id, name: 'Over the cap' } })).toBe(0);

      // The sports league the season already uses still takes contests.
      expect((await repos().contests.create(draftOn(league.id, event.id, 'Second'), fixtureLimit)).status).toBe('created');
    } finally {
      await second.remove();
    }
  });

  it('lets only one of two contests racing for a season\'s last sports league in, the other refused sportsLeagueLimitReached', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const second = await createSecondTourEvent(event.eventSeriesId, suffix);
    try {
      const results = await Promise.all([
        repos().contests.create(draftOn(league.id, event.id, 'Racer One'), { sportLeaguesPerYear: 1, sportLeagueId: second.fixtureTourId }),
        repos().contests.create(draftOn(league.id, second.event.id, 'Racer Two'), { sportLeaguesPerYear: 1, sportLeagueId: second.secondTourId }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['created', 'sportsLeagueLimitReached']);
      expect(await repos().contests.findSportLeagueIdsBySeason(league.id, 2026)).toHaveLength(1);
    } finally {
      await second.remove();
    }
  });

  it('refuses moving a contest into a season whose contests use the plan\'s sports leagues, keeping its season, and moves it with no limit', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const second = await createSecondTourEvent(event.eventSeriesId, suffix);
    try {
      await createContestRow(repos().contests, draftOn(league.id, second.event.id, 'Second Tour 2026'));
      const nextYear = await createContestRow(repos().contests, draftOn(league.id, event.id, 'Fixture 2027', 2027));

      const refused = await repos().contests.moveToSeason(nextYear.id, 2026, { sportLeaguesPerYear: 1, sportLeagueId: second.fixtureTourId });
      expect(refused).toEqual({ status: 'sportsLeagueLimitReached', sportLeaguesPerYear: 1, sportLeagueCount: 1 });
      expect((await repos().contests.findById(nextYear.id))?.seasonYear).toBe(2027);

      expect(await repos().contests.moveToSeason(nextYear.id, 2026, { sportLeaguesPerYear: null })).toEqual({ status: 'moved' });
      expect((await repos().contests.findById(nextYear.id))?.seasonYear).toBe(2026);
    } finally {
      await second.remove();
    }
  });
});

describe('ContestConfigurationRepository', () => {
  it('reads stored rules back typed by selection type, dropping keys the rules do not define', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Budget rules', ContestStatus.DRAFT);
    await getPrisma().contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'BUDGET_PICK',
        configJson: {
          selectionType: SelectionType.BUDGET_PICK,
          rosterSize: 6,
          countedScores: 4,
          salaryCap: 50_000,
          budget: 8_000,
          pickCount: 6,
        },
      },
    });

    const configuration = await new PrismaContestConfigurationRepository(getAppPrisma()).findByContest(contest.id);

    expect(configuration?.configJson).toEqual({
      selectionType: SelectionType.BUDGET_PICK,
      rosterSize: 6,
      countedScores: 4,
      salaryCap: 50_000,
    });
  });

  it('reads several contests\' rules in one read, leaving out a contest with none and contests not asked for', async () => {
    const { league, event } = await createLeagueAndEvent();
    const tiered = await createContest(league.id, event.id, 'Tiered rules', ContestStatus.OPEN);
    const pickEm = await createContest(league.id, event.id, 'Pick\'em rules', ContestStatus.OPEN);
    const noRules = await createContest(league.id, event.id, 'No rules', ContestStatus.OPEN);
    const notAsked = await createContest(league.id, event.id, 'Not asked', ContestStatus.OPEN);
    for (const [contest, configJson] of [
      [tiered, { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }],
      [pickEm, { selectionType: SelectionType.PICK_EM, mode: 'STRAIGHT_UP', againstTheSpread: false }],
      [notAsked, { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }],
    ] as const) {
      await getPrisma().contestConfiguration.create({
        data: { contestId: contest.id, selectionType: configJson.selectionType, configJson },
      });
    }
    const repository = new PrismaContestConfigurationRepository(getPrisma());

    const found = await repository.findByContests([tiered.id, pickEm.id, noRules.id]);

    expect(new Map(found.map((configuration) => [configuration.contestId, configuration.configJson?.selectionType])))
      .toEqual(new Map([[pickEm.id, SelectionType.PICK_EM], [tiered.id, SelectionType.TIERED]]));
    await expect(repository.findByContests([])).resolves.toEqual([]);
  });
});

describe('ParticipantContestScoringRuleRepository', () => {
  async function configurationFor(name: string) {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, name, ContestStatus.DRAFT);
    return getPrisma().contestConfiguration.create({ data: { contestId: contest.id, selectionType: 'TIERED' } });
  }

  it('writes a rule\'s typed settings into its config column and reads them back as the definition\'s settings', async () => {
    const configuration = await configurationFor('Typed settings');
    const repo = new PrismaParticipantContestScoringRuleRepository(getAppPrisma());

    await repo.create({
      contestConfigurationId: configuration.id,
      sortOrder: 1,
      scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} },
      active: true,
    });

    const stored = await getPrisma().participantContestScoringRule.findFirstOrThrow({ where: { contestConfigurationId: configuration.id } });
    expect(stored).toMatchObject({ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} });
    await expect(repo.findByContestConfiguration(configuration.id)).resolves.toEqual([
      expect.objectContaining({
        sortOrder: 1,
        active: true,
        scoring: { success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
      }),
    ]);
  });

  it('deletes every rule of one configuration in one call, leaving another configuration\'s rules', async () => {
    const replaced = await configurationFor('Replaced scoring');
    const kept = await configurationFor('Kept scoring');
    await getPrisma().participantContestScoringRule.createMany({
      data: [
        { contestConfigurationId: replaced.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, config: {} },
        { contestConfigurationId: replaced.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 2, config: {} },
        { contestConfigurationId: kept.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, config: {} },
      ],
    });
    const repo = new PrismaParticipantContestScoringRuleRepository(getAppPrisma());

    await repo.deleteByContestConfiguration(replaced.id);

    await expect(repo.findByContestConfiguration(replaced.id)).resolves.toEqual([]);
    await expect(repo.findByContestConfiguration(kept.id)).resolves.toHaveLength(1);
  });

  it('reads retired keys out of a stored config, and a retired definition or a non-object config as a failed parse, in sort order', async () => {
    const configuration = await configurationFor('Stored settings');
    await getPrisma().participantContestScoringRule.createMany({
      data: [
        { contestConfigurationId: configuration.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, config: { cutRule: { type: 'FIXED_SCORE', fixedScore: 80 } } },
        { contestConfigurationId: configuration.id, participantScoringDefinitionId: 'STABLEFORD_POINTS', sortOrder: 2, config: {} },
        { contestConfigurationId: configuration.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 3, config: [] },
      ],
    });

    const rules = await new PrismaParticipantContestScoringRuleRepository(getAppPrisma()).findByContestConfiguration(configuration.id);

    expect(rules.map((rule) => rule.scoring)).toEqual([
      { success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
      { success: false, reason: 'DEFINITION_UNKNOWN', participantScoringDefinitionId: 'STABLEFORD_POINTS' },
      { success: false, reason: 'SETTINGS_INVALID', participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL' },
    ]);
  });
});

describe('ContestConfigTemplateRepository', () => {
  // Golf's reference templates share the sport, so these carry a key prefix of their own: the
  // cleanup removes only them, and each assertion reads only them.
  const prefix = `itest-${randomUUID().slice(0, 8)}-`;
  const ours = <T extends { templateKey: string }>(templates: T[]) =>
    templates.filter((template) => template.templateKey.startsWith(prefix));
  afterEach(async () => {
    await getPrisma().contestConfigTemplate.deleteMany({ where: { templateKey: { startsWith: prefix } } });
  });

  async function createTemplate(key: string, eventType: ContestTemplateEventType | null, sortOrder: number, sportLeagueId: string | null = null) {
    return getPrisma().contestConfigTemplate.create({
      data: {
        sport: Sport.GOLF,
        sportLeagueId,
        eventType,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateKey: `${prefix}${key}`,
        name: `Template ${key}`,
        description: 'Integration template',
        sortOrder,
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
      },
    });
  }

  it("lists an event type's templates with the ones for any event type, in sort order", async () => {
    await createTemplate('any', null, 2);
    await createTemplate('knockout', ContestTemplateEventType.KNOCKOUT, 1);
    await createTemplate('week', ContestTemplateEventType.WEEK, 0);

    const templates = await new PrismaContestConfigTemplateRepository(getAppPrisma())
      .list({ sport: Sport.GOLF, eventType: ContestTemplateEventType.KNOCKOUT });

    expect(ours(templates).map((template) => template.templateKey)).toEqual([`${prefix}knockout`, `${prefix}any`]);
  });

  /** Two golf sport leagues, a PGA-style and an LPGA-style tour, for league-scoped templates (#624). */
  async function createGolfLeagues() {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const suffix = randomUUID().slice(0, 8);
    const [pga, lpga] = await Promise.all([
      prisma.sportLeague.create({ data: { sportId: sport.id, name: `PGA-style ${suffix}` } }),
      prisma.sportLeague.create({ data: { sportId: sport.id, name: `LPGA-style ${suffix}` } }),
    ]);
    return { pga, lpga };
  }

  it("lists a sport league's own templates with the sport-wide ones and never another league's", async () => {
    const { pga, lpga } = await createGolfLeagues();
    await createTemplate('sport-wide', null, 0);
    await createTemplate('lpga', null, 1, lpga.id);
    await createTemplate('pga', null, 2, pga.id);
    const repo = new PrismaContestConfigTemplateRepository(getAppPrisma());

    const forLpga = await repo.list({ sport: Sport.GOLF, sportLeagueId: lpga.id });
    const unfiltered = await repo.list({ sport: Sport.GOLF });

    expect(ours(forLpga).map((template) => [template.templateKey, template.sportLeagueId])).toEqual([
      [`${prefix}sport-wide`, null],
      [`${prefix}lpga`, lpga.id],
    ]);
    expect(ours(unfiltered).map((template) => template.templateKey)).toEqual([
      `${prefix}sport-wide`, `${prefix}lpga`, `${prefix}pga`,
    ]);
  });

  it('narrows by sport league and event type together: both must match or be unscoped', async () => {
    const { lpga } = await createGolfLeagues();
    await createTemplate('lpga-knockout', ContestTemplateEventType.KNOCKOUT, 0, lpga.id);
    await createTemplate('lpga-week', ContestTemplateEventType.WEEK, 1, lpga.id);
    await createTemplate('any', null, 2);

    const templates = await new PrismaContestConfigTemplateRepository(getAppPrisma())
      .list({ sport: Sport.GOLF, sportLeagueId: lpga.id, eventType: ContestTemplateEventType.KNOCKOUT });

    expect(ours(templates).map((template) => template.templateKey)).toEqual([`${prefix}lpga-knockout`, `${prefix}any`]);
  });

  it('refuses to delete a sport league that still has a template of its own', async () => {
    const { lpga } = await createGolfLeagues();
    await createTemplate('lpga', null, 0, lpga.id);

    await expect(getPrisma().sportLeague.delete({ where: { id: lpga.id } })).rejects.toThrow();
  });

  it('updates only the fields given, and a retired template leaves the active list', async () => {
    const kept = await createTemplate('kept', null, 0);
    const retired = await createTemplate('retired', null, 1);
    const repo = new PrismaContestConfigTemplateRepository(getAppPrisma());

    const updated = await repo.update(retired.id, { name: 'Retired Template', active: false });

    expect(updated).toEqual(expect.objectContaining({
      name: 'Retired Template',
      active: false,
      description: 'Integration template',
      sortOrder: 1,
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
    }));
    const active = await repo.list({ sport: Sport.GOLF, active: true });
    expect(ours(active).map((template) => template.id)).toEqual([kept.id]);
  });
});

describe('ContestRepository.findJoinableByReleasedEdition (#714, #1179)', () => {
  const prefix = `itest-series-${randomUUID().slice(0, 8)}-`;
  afterEach(async () => {
    await cleanupTestData();
    await getPrisma().contestConfigTemplate.deleteMany({ where: { templateKey: { startsWith: prefix } } });
    await getPrisma().sportLeague.deleteMany({ where: { name: { startsWith: prefix } } });
  });

  async function createSeriesTemplate(key: string, sportLeagueId: string, eventSeriesNames: string[]) {
    return getPrisma().contestConfigTemplate.create({
      data: {
        sport: Sport.GOLF,
        sportLeagueId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateKey: `${prefix}${key}`,
        name: `Series template ${key}`,
        description: 'Integration template',
        sortOrder: 0,
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
        eventSeriesNames,
      },
    });
  }

  async function contestFromTemplate(
    leagueId: string,
    sportEventIds: string | readonly string[],
    name: string,
    templateId: string,
    status: ContestStatus = ContestStatus.OPEN,
  ) {
    const contest = await createContest(leagueId, sportEventIds, name, status);
    await getPrisma().contestConfiguration.create({
      data: {
        contestId: contest.id,
        templateId,
        selectionType: 'TIERED',
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
      },
    });
    return contest;
  }

  /** A league and event, a template covering the event's series, and the next edition of that series not yet in any contest. */
  async function seriesWithTemplate() {
    const prisma = getPrisma();
    const fixture = await createLeagueAndEvent();
    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: fixture.event.eventSeriesId } });
    const covering = await createSeriesTemplate('covering', series.sportLeagueId, ['Some Other Major', series.name]);
    const edition = { id: randomUUID(), eventSeriesId: series.id, eventYear: fixture.event.eventYear };
    return { ...fixture, series, covering, edition };
  }

  it('finds the contests made from a template naming the series in the series\' own sport league, and no others', async () => {
    const prisma = getPrisma();
    const { league, event, series, covering, edition } = await seriesWithTemplate();
    const otherTour = await prisma.sportLeague.create({
      data: { sportId: (await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } })).id, name: `${prefix}other tour` },
    });
    const otherLeague = await createSeriesTemplate('other-league', otherTour.id, [series.name]);
    const otherSeries = await createSeriesTemplate('other-series', series.sportLeagueId, ['Some Other Major']);
    const expected = await contestFromTemplate(league.id, event.id, 'Covered Pool', covering.id);
    await contestFromTemplate(league.id, event.id, 'Other League Pool', otherLeague.id);
    await contestFromTemplate(league.id, event.id, 'Other Series Pool', otherSeries.id);

    const found = await repos().contests.findJoinableByReleasedEdition(edition);

    expect(found.map((contest) => contest.id)).toEqual([expected.id]);
    expect(found[0]?.sportEventIds).toEqual([event.id]);
    await expect(repos().contests.findJoinableByReleasedEdition({ ...edition, eventSeriesId: randomUUID() })).resolves.toEqual([]);
  });

  it('leaves out a COMPLETED pool, a drawn pool, a squares-drawn pool, a pool that already has the edition and a pool of another year\'s events, keeping the rest (one with no events yet among them) oldest first', async () => {
    const prisma = getPrisma();
    const { league, event, suffix, covering, edition } = await seriesWithTemplate();
    const first = await contestFromTemplate(league.id, event.id, 'Live Pool', covering.id, ContestStatus.ACTIVE);
    const second = await contestFromTemplate(league.id, event.id, 'Draft Pool', covering.id, ContestStatus.DRAFT);
    await contestFromTemplate(league.id, event.id, 'Finished Pool', covering.id, ContestStatus.COMPLETED);
    const drawn = await contestFromTemplate(league.id, event.id, 'Drawn Pool', covering.id);
    await prisma.contestDraw.create({ data: { contestId: drawn.id, seed: 'seed', fieldOrder: [], entryOrder: [] } });
    const squaresDrawn = await contestFromTemplate(league.id, event.id, 'Squares Drawn Pool', covering.id);
    await prisma.contestSquaresDraw.create({
      data: { contestId: squaresDrawn.id, seed: 'seed', rowDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], columnDigits: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
    });
    const noEvents = await contestFromTemplate(league.id, [], 'No Events Yet Pool', covering.id);
    const { event: released } = await createLaterEvent(suffix);
    await contestFromTemplate(league.id, [event.id, released.id], 'Already Has It', covering.id);
    const { event: lastYear } = await createLaterEvent(suffix, new Date('2025-07-16T12:00:00.000Z'));
    await prisma.sportEvent.update({ where: { id: lastYear.id }, data: { eventYear: edition.eventYear - 1 } });
    await contestFromTemplate(league.id, [event.id, lastYear.id], 'Mixed Years Pool', covering.id);

    const found = await repos().contests.findJoinableByReleasedEdition({ ...edition, id: released.id });

    expect(found.map((contest) => contest.name)).toEqual([first.name, second.name, noEvents.name]);
  });
});

describe('ContestEntryRepository', () => {
  it('refuses an entry with contestFull once the contest holds its plan\'s entries per contest, counting drafts, and stores nothing (#947)', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Full House', ContestStatus.OPEN);
    await createEntry(contest.id, squads[0].id, 1, 'Only Draft');

    const result = await repos().entries.create(
      { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'One Too Many', tiebreakerValue: null },
      { entriesPerContest: () => 1 },
    );

    expect(result).toEqual({ status: 'contestFull', entriesPerContest: 1 });
    expect(await getPrisma().contestEntry.count({ where: { contestId: contest.id } })).toBe(1);
  });

  it('lets only one of two entries racing for a contest\'s last place in, the other refused contestFull (#947)', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Last Place', ContestStatus.OPEN);

    const results = await Promise.all(squads.map((squad, index) => repos().entries.create(
      { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Racer ${index + 1}`, tiebreakerValue: null },
      { entriesPerContest: () => 1 },
    )));

    expect(results.map((result) => result.status).sort()).toEqual(['contestFull', 'created']);
    expect(await getPrisma().contestEntry.count({ where: { contestId: contest.id } })).toBe(1);
  });

  it('hands the cap the contest\'s highest expansion read under its lock, so a contest expanded from 1 to 2 entries takes a second (#980)', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Expanded House', ContestStatus.OPEN);
    await addExpansion(league.id, contest.id, 1);
    await addExpansion(league.id, contest.id, 2);
    await createEntry(contest.id, squads[0].id, 1, 'First In');
    const seen: Array<number | null> = [];
    const cap = (expandedTo: number | null) => {
      seen.push(expandedTo);
      return Math.max(1, expandedTo ?? 0);
    };

    const second = await repos().entries.create(
      { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Second In', tiebreakerValue: null },
      { entriesPerContest: cap },
    );
    const third = await repos().entries.create(
      { contestId: contest.id, squadId: squads[0].id, entryNumber: 2, name: 'One Too Many', tiebreakerValue: null },
      { entriesPerContest: cap },
    );

    expect([second.status, third]).toEqual(['created', { status: 'contestFull', entriesPerContest: 2 }]);
    expect(seen).toEqual([2, 2]);
  });

  it('hands the cap no expansion for a contest that has none (#980)', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Plain House', ContestStatus.OPEN);
    const seen: Array<number | null> = [];

    await repos().entries.create(
      { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Plain', tiebreakerValue: null },
      { entriesPerContest: (expandedTo) => { seen.push(expandedTo); return null; } },
    );

    expect(seen).toEqual([null]);
  });

  it('creates an entry a DRAFT in each of its contest\'s events, with no submit time', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Born Drafts', ContestStatus.OPEN);

    const entry = await createEntry(contest.id, squads[0].id, 1, 'Newcomer');

    expect(byEvent(entry.events)).toEqual([[event.id, 'DRAFT'], [later.event.id, 'DRAFT']].sort(([left], [right]) => left.localeCompare(right)));
    expect(entry.events.every((row) => row.submittedAt === undefined)).toBe(true);
  });

  it('lists a contest\'s entries by entry number with squad names, optionally only the ones that submitted one event', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Entries');
    // Created out of order, so the order below is the adapter's, not insertion order.
    const second = await createEntry(contest.id, squads[1].id, 2, 'Second');
    const first = await createEntry(contest.id, squads[0].id, 1, 'First');
    const draft = await createEntry(contest.id, squads[1].id, 3, 'Draft');
    await submitEntryEvent(second.id, event.id, new Date());
    await submitEntryEvent(first.id, event.id, new Date());
    await submitEntryEvent(draft.id, later.event.id, new Date());

    const all = await repos().entries.findByContestWithSquad(contest.id);
    const submittedFirstEvent = await repos().entries.findByContestWithSquad(contest.id, { submittedFor: event.id });
    const submittedLaterEvent = await repos().entries.findByContestWithSquad(contest.id, { submittedFor: later.event.id });
    const one = await repos().entries.findByIdWithSquad(second.id);

    expect(all.map((entry) => [entry.id, entry.squadName])).toEqual([
      [first.id, `Alpha ${suffix}`],
      [second.id, `Bravo ${suffix}`],
      [draft.id, `Bravo ${suffix}`],
    ]);
    expect(submittedFirstEvent.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(submittedLaterEvent.map((entry) => entry.id)).toEqual([draft.id]);
    expect(one).toEqual(expect.objectContaining({ id: second.id, entryNumber: 2, squadName: `Bravo ${suffix}` }));
    await expect(repos().entries.findByIdWithSquad(randomUUID())).resolves.toBeNull();
  });

  it('counts each contest\'s entries that submitted at least one event in one read, with zero for a contest with none (#1161)', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Counted');
    const empty = await createContest(league.id, event.id, 'Nobody Submitted');
    const both = await createEntry(contest.id, squads[0].id, 1, 'Both Events');
    const one = await createEntry(contest.id, squads[1].id, 1, 'Later Event');
    await createEntry(contest.id, squads[1].id, 2, 'Draft');
    await createEntry(empty.id, squads[0].id, 1, 'Draft Elsewhere');
    await submitEntryEvent(both.id, event.id, new Date());
    await submitEntryEvent(both.id, later.event.id, new Date());
    await submitEntryEvent(one.id, later.event.id, new Date());

    await expect(repos().entries.countSubmittedByContests([contest.id, empty.id])).resolves.toEqual(new Map([
      [contest.id, 2],
      [empty.id, 0],
    ]));
    await expect(repos().entries.countSubmittedByContests([])).resolves.toEqual(new Map());
  });

  it("finds a squad's entries in one contest only, drafts included, by entry number, leaving out its entries in other contests and other squads' (#1167)", async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Squad Entries');
    const otherContest = await createContest(league.id, event.id, 'Other Contest');
    // Created out of order, so the order below is the adapter's, not insertion order.
    const third = await createEntry(contest.id, squads[0].id, 3, 'Third');
    const first = await createEntry(contest.id, squads[0].id, 1, 'First');
    await createEntry(otherContest.id, squads[0].id, 2, 'Elsewhere');
    await createEntry(contest.id, squads[1].id, 2, 'Other Squad');

    const found = await repos().entries.findByContestAndSquad(contest.id, squads[0].id);

    expect(found.map((entry) => [entry.id, entry.entryNumber])).toEqual([[first.id, 1], [third.id, 3]]);
    expect(found[0].events).toEqual([expect.objectContaining({ sportEventId: event.id, status: 'DRAFT' })]);
    await expect(repos().entries.findByContestAndSquad(otherContest.id, squads[1].id)).resolves.toEqual([]);
    // The ids-alone read a contest page uses for the viewer's entries finds the same, in the same order (#1197).
    await expect(repos().entries.findIdsByContestAndSquad(contest.id, squads[0].id)).resolves.toEqual([first.id, third.id]);
    await expect(repos().entries.findIdsByContestAndSquad(otherContest.id, squads[1].id)).resolves.toEqual([]);
  });

  it("counts one contest's submitted entries, the squads that submitted one, and every entry with drafts (#1197)", async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Totals');
    const other = await createContest(league.id, event.id, 'Other Totals');
    const first = await createEntry(contest.id, squads[0].id, 1, 'First');
    const second = await createEntry(contest.id, squads[0].id, 2, 'Second');
    await createEntry(contest.id, squads[1].id, 1, 'Draft');
    await createEntry(other.id, squads[1].id, 1, 'Elsewhere');
    await submitEntryEvent(first.id, event.id, new Date());
    await submitEntryEvent(first.id, later.event.id, new Date());
    await submitEntryEvent(second.id, later.event.id, new Date());

    await expect(repos().entries.countForContest(contest.id)).resolves.toEqual({
      submittedEntryCount: 2,
      enteredSquadCount: 1,
      allEntryCount: 3,
    });
    await expect(repos().entries.countForContest(randomUUID())).resolves.toEqual({
      submittedEntryCount: 0,
      enteredSquadCount: 0,
      allEntryCount: 0,
    });
  });

  it("finds a squad's entries, drafts included and with its name, in the contests asked for only (#1197)", async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Asked For');
    const otherAsked = await createContest(league.id, event.id, 'Also Asked For');
    const notAsked = await createContest(league.id, event.id, 'Not Asked For');
    const second = await createEntry(contest.id, squads[0].id, 2, 'Second');
    const first = await createEntry(contest.id, squads[0].id, 1, 'First');
    const elsewhere = await createEntry(otherAsked.id, squads[0].id, 1, 'Elsewhere');
    await createEntry(notAsked.id, squads[0].id, 1, 'Not Asked');
    await createEntry(contest.id, squads[1].id, 1, 'Other Squad');

    const found = await repos().entries.findBySquadAndContests(squads[0].id, [contest.id, otherAsked.id]);

    expect(found.map((entry) => entry.id).sort()).toEqual([first.id, second.id, elsewhere.id].sort());
    // Within a contest, in entry-number order.
    expect(found.filter((entry) => entry.contestId === contest.id).map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(found.every((entry) => entry.squadName === `Alpha ${suffix}`)).toBe(true);
    expect(found[0].events).toEqual([expect.objectContaining({ sportEventId: event.id, status: 'DRAFT' })]);
    await expect(repos().entries.findBySquadAndContests(squads[0].id, [])).resolves.toEqual([]);
  });

  it('updates only the entry fields given, leaving the others and its event statuses as stored', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Entry Update');
    const created = await repos().entries.create({
      contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Original', tiebreakerValue: 270,
    }, { entriesPerContest: () => null });
    const entry = created.status === 'created' ? created.entry : null;
    const stored = expectDefined(entry);
    await submitEntryEvent(stored.id, event.id, new Date());

    const updated = await repos().entries.update(stored.id, { name: 'Renamed' });

    expect(updated).toEqual(expect.objectContaining({ id: stored.id, name: 'Renamed', tiebreakerValue: 270 }));
    expect(byEvent(updated.events)).toEqual([[event.id, 'SUBMITTED']]);
  });

  it('deletes one entry of an undrawn contest and leaves the contest\'s other entries', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Entry Delete');
    const leaving = await createEntry(contest.id, squads[0].id, 1, 'Leaving');
    const staying = await createEntry(contest.id, squads[1].id, 1, 'Staying');

    await expect(repos().entries.delete(leaving.id)).resolves.toEqual({ status: 'deleted' });

    expect((await repos().entries.findByContest(contest.id)).map((entry) => entry.id)).toEqual([staying.id]);
    await expect(getPrisma().contestEntryEvent.count({ where: { contestEntryId: leaving.id } })).resolves.toBe(0);
  });
});

describe('StandingsEmailPositionRepository (#877)', () => {
  it('records each entry\'s place in a standings email and reads back only the contest\'s placed entries, the next record replacing the last, without touching the entry\'s update time', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Standings');
    const other = await createContest(league.id, event.id, 'Other Standings');
    const leader = await createEntry(contest.id, squads[0].id, 1, 'Leader');
    const unscored = await createEntry(contest.id, squads[1].id, 1, 'Unscored');
    const elsewhere = await createEntry(other.id, squads[0].id, 1, 'Elsewhere');
    const positions = new PrismaStandingsEmailPositionRepository(getAppPrisma());

    await expect(positions.findByContest(contest.id)).resolves.toEqual(new Map());
    await positions.record([
      { contestEntryId: leader.id, position: 1 },
      { contestEntryId: unscored.id, position: null },
      { contestEntryId: elsewhere.id, position: 4 },
    ]);
    await expect(positions.findByContest(contest.id)).resolves.toEqual(new Map([[leader.id, 1]]));

    await positions.record([{ contestEntryId: leader.id, position: 2 }, { contestEntryId: unscored.id, position: 1 }]);
    await expect(positions.findByContest(contest.id)).resolves.toEqual(new Map([[leader.id, 2], [unscored.id, 1]]));
    await expect(positions.findByContest(other.id)).resolves.toEqual(new Map([[elsewhere.id, 4]]));
    await positions.record([]);
    // Entry receipts read the entry's update time; a standings email is not an update to it.
    const stored = await getPrisma().contestEntry.findUniqueOrThrow({ where: { id: leader.id } });
    expect(stored.updatedAt).toEqual(leader.updatedAt);
  });
});

describe('EmailMessageRepository.existsForContest (#877)', () => {
  it('finds a contest\'s email of the template by its exact notice subject, for anyone and in any state, and nothing for another contest, template or subject (#1169)', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Outbox');
    const other = await createContest(league.id, event.id, 'Other Outbox');
    const outbox = new PrismaEmailMessageRepository(getAppPrisma());
    const about = `${contest.id}:${event.id}:round-1`;
    await outbox.record({
      templateKey: 'CONTEST_STANDINGS',
      contestId: contest.id,
      recipientEmail: `standings-${suffix}@integration.test`,
      idempotencyKey: `CONTEST_STANDINGS:${about}:user-${suffix}`,
      noticeAbout: about,
      fromName: 'Contest Repo League',
      fromAddress: 'league@integration.test',
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
    });
    const exists = (contestId: string, templateKey: 'CONTEST_STANDINGS' | 'CONTEST_OPENED', noticeAbout: string) =>
      outbox.existsForContest({ contestId, templateKey, noticeAbout });

    await expect(exists(contest.id, 'CONTEST_STANDINGS', about)).resolves.toBe(true);
    await expect(exists(contest.id, 'CONTEST_STANDINGS', `${contest.id}:${event.id}:round-2`)).resolves.toBe(false);
    await expect(exists(contest.id, 'CONTEST_STANDINGS', `${contest.id}:${event.id}:round-10`)).resolves.toBe(false);
    // A subject is matched whole, never as the start of a longer one.
    await expect(exists(contest.id, 'CONTEST_STANDINGS', `${contest.id}:${event.id}`)).resolves.toBe(false);
    await expect(exists(contest.id, 'CONTEST_OPENED', about)).resolves.toBe(false);
    await expect(exists(other.id, 'CONTEST_STANDINGS', about)).resolves.toBe(false);
  });
});

describe('EmailMessageRepository.findLeagueIdsByNotice (#893, #1169)', () => {
  it('lists, by notice subject, each league with an email of the template about it once, in any state, and no league for another template or subject', async () => {
    const first = await createLeagueAndEvent();
    const second = await createLeagueAndEvent();
    const third = await createLeagueAndEvent();
    const outbox = new PrismaEmailMessageRepository(getAppPrisma());
    const record = (templateKey: 'EVENT_COMING_UP' | 'EVENT_READY_FOR_CONTESTS', leagueId: string, eventId: string, user: string) => outbox.record({
      templateKey,
      leagueId,
      recipientEmail: `${user}-${first.suffix}@integration.test`,
      idempotencyKey: `${templateKey}:${eventId}:${leagueId}:${user}-${first.suffix}`,
      noticeAbout: eventId,
      fromName: 'Contest Repo League',
      fromAddress: 'league@integration.test',
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
    });
    const eventId = first.event.id;
    await record('EVENT_COMING_UP', first.league.id, eventId, 'casey');
    await record('EVENT_COMING_UP', first.league.id, eventId, 'jordan');
    await record('EVENT_COMING_UP', second.league.id, eventId, 'casey');
    await record('EVENT_COMING_UP', third.league.id, second.event.id, 'casey');
    await record('EVENT_READY_FOR_CONTESTS', third.league.id, eventId, 'casey');

    await expect(outbox.findLeagueIdsByNotice({ templateKey: 'EVENT_COMING_UP', noticeAbouts: [eventId, third.event.id] })).resolves.toEqual(new Map([
      [eventId, new Set([first.league.id, second.league.id])],
      [third.event.id, new Set()],
    ]));
    await expect(outbox.findLeagueIdsByNotice({ templateKey: 'EVENT_READY_FOR_CONTESTS', noticeAbouts: [second.event.id] }))
      .resolves.toEqual(new Map([[second.event.id, new Set()]]));
    await expect(outbox.findLeagueIdsByNotice({ templateKey: 'EVENT_COMING_UP', noticeAbouts: [] })).resolves.toEqual(new Map());
  });
});

describe('SportEventRepository.findAll start bounds (#893)', () => {
  it('finds the events starting from the first moment and before the second, leaving out one starting exactly at the second', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const create = async (day: string) => prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `start-bounds-${day}-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Start Bounds ${day} ${suffix}`,
        startDate: new Date(`2026-06-${day}T12:00:00.000Z`),
        status: 'SCHEDULED',
      },
    });
    await create('01');
    const from = await create('04');
    const middle = await create('07');
    await create('10');

    const found = await new PrismaSportEventRepository(getAppPrisma()).findAll({
      q: suffix,
      startsFrom: from.startDate,
      startsBefore: new Date('2026-06-10T12:00:00.000Z'),
    });

    expect(found.map((event) => event.id)).toEqual([from.id, middle.id]);
  });
});

describe('ContestEntryPickRepository — read-only', () => {
  it('reads picks in pick order, with their golfer and their event, only in the events asked for, and counts them per entry', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Picks');
    const [picked, empty] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Picked' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Empty' } }),
    ]);
    await prisma.sportEventParticipant.update({
      where: { id: field[1].id },
      data: { isActive: false, inactiveReason: 'WITHDRAWN' },
    });
    const later = await prisma.contestEntryPick.create({
      data: {
        entryId: picked.id, sportEventParticipantId: field[1].id, contestFormat: 'ROSTER', slot: 2,
        pickedAt: new Date('2026-06-01T12:05:00.000Z'),
      },
    });
    const earlier = await prisma.contestEntryPick.create({
      data: {
        entryId: picked.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1,
        pickedAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });

    const picks = await repos().picks.findByEntriesAndEvents([picked.id, empty.id], [event.id]);
    const withParticipant = await repos().picks.findByEntriesWithParticipant([picked.id]);
    const counts = await repos().picks.countByEntries([picked.id, empty.id]);

    expect(picks.map((pick) => [pick.id, pick.slot, pick.contestFormat, pick.sportEventId])).toEqual([
      [earlier.id, 1, 'ROSTER', event.id],
      [later.id, 2, 'ROSTER', event.id],
    ]);
    // Only the events asked for (#1162): the entry's picks are all in `event`, so another reads none.
    await expect(repos().picks.findByEntriesAndEvents([picked.id], [randomUUID()])).resolves.toEqual([]);
    expect(withParticipant.map((pick) => pick.participant)).toEqual([
      {
        participantId: field[0].participantId,
        participantName: `Golfer One ${suffix}`,
        isActive: true,
        inactiveReason: null,
        role: 'GOLFER',
        teamAffiliation: null,
      },
      {
        participantId: field[1].participantId,
        participantName: `Golfer Two ${suffix}`,
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        role: null,
        teamAffiliation: null,
      },
    ]);
    // Each pick names the event its field row belongs to (#713).
    expect(withParticipant.map((pick) => pick.sportEventId)).toEqual([event.id, event.id]);
    // An entry with no picks is absent from the map, not zero.
    expect(counts).toEqual(new Map([[picked.id, 2]]));
    await expect(repos().picks.findByEntriesAndEvents([], [event.id])).resolves.toEqual([]);
    await expect(repos().picks.countByEntries([])).resolves.toEqual(new Map());
  });

  it('reads only the named event\'s picks when given one, and every event\'s without (#1196)', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Season Picks');
    const entry = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Season' } });
    const first = await prisma.contestEntryPick.create({
      data: { entryId: entry.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', pickedAt: new Date('2026-06-01T12:00:00.000Z') },
    });
    const second = await prisma.contestEntryPick.create({
      data: { entryId: entry.id, sportEventParticipantId: later.field[0].id, contestFormat: 'ROSTER', pickedAt: new Date('2026-07-01T12:00:00.000Z') },
    });

    const inFirst = await repos().picks.findByEntriesWithParticipant([entry.id], { sportEventId: event.id });
    const inLater = await repos().picks.findByEntriesWithParticipant([entry.id], { sportEventId: later.event.id });
    const all = await repos().picks.findByEntriesWithParticipant([entry.id]);

    expect(inFirst.map((pick) => [pick.id, pick.sportEventId])).toEqual([[first.id, event.id]]);
    expect(inLater.map((pick) => [pick.id, pick.sportEventId])).toEqual([[second.id, later.event.id]]);
    expect(all.map((pick) => pick.id)).toEqual([first.id, second.id]);
  });

  it('has no write method, so ContestEntryPickService stays the only way a pick is inserted or deleted (plans/117 §7.1)', () => {
    const port = repos().picks as unknown as Record<string, unknown>;
    for (const write of ['create', 'createMany', 'upsert', 'update', 'delete']) {
      expect(port[write]).toBeUndefined();
    }
  });
});

describe('ContestEntryStandingRepository', () => {
  async function twoEntries(name = 'Standings') {
    const prisma = getPrisma();
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, name);
    const [ranked, unranked] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Ranked' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Unranked' } }),
    ]);
    const settledAt = new Date('2026-06-07T22:00:00.000Z');
    const base = {
      contestId: contest.id,
      countingPickLimit: 2,
      asOf: new Date('2026-06-07T21:00:00.000Z'),
      settledAt,
    };
    return { contest, event, ranked, unranked, settledAt, base };
  }

  it('writes each entry\'s standing with its settled total, overwrites it in place on a re-settle, and reads unranked entries last', async () => {
    const prisma = getPrisma();
    const { contest, ranked, unranked, settledAt, base } = await twoEntries();
    await repos().standings.upsertMany(contest.id, [
      { ...base, contestEntryId: unranked.id, position: null, displayPosition: null, scoredPickCount: 0, totalScore: null },
      { ...base, contestEntryId: ranked.id, position: 2, displayPosition: '2', scoredPickCount: 2, totalScore: -1 },
    ]);
    const firstIds = await repos().standings.findByContest(contest.id);

    // A re-settle overwrites the entry's row, keeping its id, rather than adding a second one.
    await repos().standings.upsertMany(contest.id, [
      { ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2, totalScore: -4 },
    ]);

    const standings = await repos().standings.findByContest(contest.id);
    expect(standings.map((standing) => [standing.contestEntryId, standing.position, standing.displayPosition, standing.totalScore]))
      .toEqual([
        [ranked.id, 1, '1', -4],
        [unranked.id, null, null, null],
      ]);
    expect(standings[0]).toEqual(expect.objectContaining({ countingPickLimit: 2, scoredPickCount: 2, settledAt }));
    expect(new Map(standings.map((standing) => [standing.contestEntryId, standing.id])))
      .toEqual(new Map(firstIds.map((standing) => [standing.contestEntryId, standing.id])));
    await expect(prisma.contestEntryStanding.count({ where: { contestId: contest.id } })).resolves.toBe(2);
  });

  it('leaves a standing that a re-settle does not change unwritten, so its row is not touched', async () => {
    const prisma = getPrisma();
    const { contest, ranked, unranked, base } = await twoEntries('Unchanged');
    const writes = [
      { ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2, totalScore: -4 },
      { ...base, contestEntryId: unranked.id, position: 2, displayPosition: '2', scoredPickCount: 1, totalScore: 3 },
    ];
    await repos().standings.upsertMany(contest.id, writes);
    const before = await prisma.contestEntryStanding.findMany({ where: { contestId: contest.id } });

    await repos().standings.upsertMany(contest.id, [
      { ...writes[0], asOf: new Date(writes[0].asOf.getTime()), settledAt: new Date(writes[0].settledAt.getTime()) },
      { ...writes[1], totalScore: 5 },
    ]);

    const after = new Map((await prisma.contestEntryStanding.findMany({ where: { contestId: contest.id } })).map((row) => [row.contestEntryId, row]));
    const updatedAt = (entryId: string, rows: Map<string, { updatedAt: Date }>) => rows.get(entryId)?.updatedAt.getTime();
    const beforeById = new Map(before.map((row) => [row.contestEntryId, row]));
    expect(updatedAt(ranked.id, after)).toBe(updatedAt(ranked.id, beforeById));
    expect(after.get(unranked.id)?.totalScore).toBe(5);
    expect(updatedAt(unranked.id, after)).toBeGreaterThan(updatedAt(unranked.id, beforeById) ?? 0);
  });

  it('writes none of a contest\'s standings when one of them cannot be written', async () => {
    const prisma = getPrisma();
    const { contest, ranked, unranked, base } = await twoEntries('All or none');
    await repos().standings.upsertMany(contest.id, [
      { ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2, totalScore: -4 },
    ]);

    await expect(repos().standings.upsertMany(contest.id, [
      { ...base, contestEntryId: ranked.id, position: 2, displayPosition: '2', scoredPickCount: 2, totalScore: -1 },
      { ...base, contestEntryId: unranked.id, position: 1, displayPosition: '1', scoredPickCount: 2, totalScore: -6 },
      { ...base, contestEntryId: randomUUID(), position: 3, displayPosition: '3', scoredPickCount: 0, totalScore: null },
    ])).rejects.toThrow();

    const rows = await prisma.contestEntryStanding.findMany({ where: { contestId: contest.id } });
    expect(rows.map((row) => [row.contestEntryId, row.position, row.totalScore])).toEqual([[ranked.id, 1, -4]]);
  });

  it('costs the same statements to settle 2 entries as 5, and only the one read to re-settle them unchanged', async () => {
    const prisma = getPrisma();
    const { league, squads, event } = await createLeagueAndEvent();
    const settle = async (entries: number) => {
      const contest = await createContest(league.id, event.id, `Statements ${String(entries)}`);
      const rows = await Promise.all(Array.from({ length: entries }, (_, index) => prisma.contestEntry.create({
        data: { contestId: contest.id, squadId: squads[0].id, entryNumber: index + 1, name: `Entry ${String(index + 1)}` },
      })));
      const writes = rows.map((entry, index) => ({
        contestId: contest.id,
        contestEntryId: entry.id,
        position: index + 1,
        displayPosition: String(index + 1),
        countingPickLimit: 2,
        scoredPickCount: 2,
        asOf: new Date('2026-06-07T21:00:00.000Z'),
        settledAt: new Date('2026-06-07T22:00:00.000Z'),
        totalScore: index,
      }));
      const first = await recordStatements(() => repos().standings.upsertMany(contest.id, writes));
      const again = await recordStatements(() => repos().standings.upsertMany(contest.id, writes));
      // An insert's VALUES list grows with its rows, so a statement is compared by its kind and table.
      const kinds = (statements: readonly { sql: string }[]) => statements.map(({ sql }) => statementShape(sql).split(' (')[0].split(' WHERE')[0]
        .replace(/^SELECT .* FROM /, 'SELECT FROM '));
      return { first: kinds(first.statements), again: kinds(again.statements) };
    };

    const two = await settle(2);
    const five = await settle(5);

    const read = 'SELECT FROM "public"."contest_entry_standings"';
    expect(two.first).toEqual([read, 'BEGIN', 'INSERT INTO "public"."contest_entry_standings"', 'COMMIT']);
    expect(five.first).toEqual(two.first);
    expect(two.again).toEqual([read]);
    expect(five.again).toEqual([read]);
  });

  it('lets two settlements of the same contest at once both finish, the second finding the first one\'s standings', async () => {
    const { contest, ranked, unranked, base } = await twoEntries('At once');
    const writes = [
      { ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2, totalScore: -4 },
      { ...base, contestEntryId: unranked.id, position: 2, displayPosition: '2', scoredPickCount: 2, totalScore: 1 },
    ];

    // Both settlements read the stored standings before either writes: each waits for the other's read.
    const prisma = getAppPrisma();
    let arrived = 0;
    let bothRead: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { bothRead = resolve; });
    const racing = new Proxy(prisma, {
      get: (target, key, receiver) => key !== 'contestEntryStanding' ? Reflect.get(target, key, receiver) as unknown : {
        ...target.contestEntryStanding,
        findMany: async (args: Parameters<typeof target.contestEntryStanding.findMany>[0]) => {
          const rows = await target.contestEntryStanding.findMany(args);
          arrived += 1;
          if (arrived === 2) bothRead();
          await barrier;
          return rows;
        },
        update: target.contestEntryStanding.update.bind(target.contestEntryStanding),
        createMany: target.contestEntryStanding.createMany.bind(target.contestEntryStanding),
      },
    });
    const settlement = new PrismaContestEntryStandingRepository(racing);

    await Promise.all([settlement.upsertMany(contest.id, writes), settlement.upsertMany(contest.id, writes)]);

    const standings = await repos().standings.findByContest(contest.id);
    expect(standings.map((standing) => [standing.contestEntryId, standing.position])).toEqual([[ranked.id, 1], [unranked.id, 2]]);
  });

  it('refuses a standing of another contest, writing nothing', async () => {
    const { contest, ranked, base } = await twoEntries('Wrong contest');

    await expect(repos().standings.upsertMany(randomUUID(), [
      { ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2, totalScore: -4 },
    ])).rejects.toThrow(/written with contest/);
    await expect(repos().standings.findByContest(contest.id)).resolves.toEqual([]);
  });
});

describe('ContestEntryEventStandingRepository', () => {
  it('writes each entry\'s event standing, overwrites it in place on a re-settle, and keeps another event\'s standing apart', async () => {
    const prisma = getPrisma();
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Event standings');
    const entry = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Weekly' } });
    const { event: second } = await createLaterEvent(suffix);
    const write = {
      contestId: contest.id,
      contestEntryId: entry.id,
      position: 2,
      displayPosition: '2',
      countingPickLimit: 16,
      scoredPickCount: 16,
      asOf: new Date('2026-06-07T21:00:00.000Z'),
      settledAt: new Date('2026-06-07T22:00:00.000Z'),
      totalScore: 9,
    };
    await repos().eventStandings.upsertMany(contest.id, [{ ...write, sportEventId: event.id }, { ...write, sportEventId: second.id, totalScore: 11 }]);
    const [first] = await prisma.contestEntryEventStanding.findMany({ where: { contestId: contest.id, sportEventId: event.id } });

    await repos().eventStandings.upsertMany(contest.id, [{ ...write, sportEventId: event.id, position: 1, displayPosition: '1', totalScore: 12 }]);

    const rows = await repos().eventStandings.findByContest(contest.id);
    expect(rows.map((row) => [row.sportEventId, row.position, row.totalScore]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))))
      .toEqual([[event.id, 1, 12], [second.id, 2, 11]].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
    expect(rows.find((row) => row.sportEventId === event.id)?.id).toBe(first.id);
  });

  it('names the contests holding standings for the event, once each however many entries, leaving out other events and contests not asked about', async () => {
    const prisma = getPrisma();
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const { event: other } = await createLaterEvent(suffix);
    const settledHere = await createContest(league.id, event.id, 'Settled here');
    const settledElsewhere = await createContest(league.id, [event.id, other.id], 'Settled elsewhere');
    const notAsked = await createContest(league.id, event.id, 'Not asked');
    const write = {
      position: 1,
      displayPosition: '1',
      countingPickLimit: 2,
      scoredPickCount: 2,
      asOf: new Date('2026-06-07T21:00:00.000Z'),
      settledAt: new Date('2026-06-07T22:00:00.000Z'),
      totalScore: 3,
    };
    const settleOn = async (contestId: string, sportEventId: string, entries: number) => {
      const rows = await Promise.all(Array.from({ length: entries }, (_, index) => prisma.contestEntry.create({
        data: { contestId, squadId: squads[index % 2].id, entryNumber: index + 1, name: `Entry ${String(index + 1)}` },
      })));
      await repos().eventStandings.upsertMany(contestId, rows.map((entry) => ({ ...write, contestId, contestEntryId: entry.id, sportEventId })));
    };
    await settleOn(settledHere.id, event.id, 3);
    await settleOn(settledElsewhere.id, other.id, 1);
    await settleOn(notAsked.id, event.id, 1);

    const settled = await repos().eventStandings.findContestsSettledFor(event.id, [settledHere.id, settledElsewhere.id]);

    expect([...settled]).toEqual([settledHere.id]);
    await expect(repos().eventStandings.findContestsSettledFor(event.id, [])).resolves.toEqual(new Set());
  });
});

describe('EventLifecycleService — starting an event\'s contests on the ports (#247)', () => {
  it('activates the event\'s OPEN contest once and wishes every active league member good luck, entrant or not (#845)', async () => {
    const prisma = getPrisma();
    const { owner, league, squads, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Starts With The Event', ContestStatus.OPEN);
    await prisma.contestConfiguration.create({
      data: {
        contestId: open.id,
        selectionType: 'TIERED',
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      },
    });
    const draft = await createContest(league.id, event.id, 'Never Opened', ContestStatus.DRAFT);
    const [member, lapsed, onlooker] = await Promise.all([
      createTestUser({ displayName: 'Squad Member' }),
      createTestUser({ displayName: 'Lapsed Member' }),
      createTestUser({ displayName: 'No Entry' }),
    ]);
    await prisma.user.update({ where: { id: lapsed.user.id }, data: { isActive: false } });
    for (const user of [member, lapsed, onlooker]) {
      await prisma.leagueMembership.create({
        data: { leagueId: league.id, userId: user.user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    for (const user of [member, lapsed]) {
      await prisma.squadMembership.create({
        data: { squadId: squads[0].id, leagueId: league.id, userId: user.user.id, status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    const alphaEntry = await createEntry(open.id, squads[0].id, 1, 'Alpha Entry');
    await submitEntryEvent(alphaEntry.id, event.id, new Date());
    const send = mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail' }));
    const lifecycle = createEventLifecycleService(getAppPrisma(), {
      contestStarted: createContestNotices(getAppPrisma(), {
        email: emailServiceOver({ providerName: 'smtp', send }),
        appBaseUrl: 'https://app.example.test',
        logger: fakeLogger(),
        planEntitlements: integrationPlanEntitlements(),
      }),
    });

    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'IN_PROGRESS', actor: { type: 'ROOT_ADMIN' },
    });

    const [started, untouched] = await Promise.all([
      repos().contests.findById(open.id),
      repos().contests.findById(draft.id),
    ]);
    expect(started).toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt: event.startDate }));
    expect(untouched?.status).toBe(ContestStatus.DRAFT);
    await deliverQueuedEmail();
    expect(send.mock.calls.map(([message]) => message.to).sort())
      .toEqual([owner.user.email, member.user.email, onlooker.user.email].sort());
    const textTo = (to: string) => send.mock.calls.find(([message]) => message.to === to)?.[0].text ?? '';
    expect(textTo(member.user.email)).toContain('Good luck, everyone.');
    expect(textTo(member.user.email)).toContain('Entries: 1');
    expect(textTo(member.user.email)).toContain(`Watch the leaderboard: https://app.example.test/league/${league.leagueCode}/contests/${open.id}/leaderboard`);
    expect(textTo(member.user.email)).not.toContain('You didn\'t enter this one');
    expect(textTo(onlooker.user.email)).toContain('You didn\'t enter this one');

    // The provider re-sending IN_PROGRESS finds nothing left to start, so nobody is told twice.
    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'IN_PROGRESS', actor: { type: 'SYSTEM' },
    });
    await deliverQueuedEmail();
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('EventLifecycleService — an event cancelled under a contest (#845 C7)', () => {
  it('tells the commissioner and the member with a submitted entry of a season contest, and nobody else, that the cancelled event counts for nothing, and says nothing about a one-event or draft contest on it', async () => {
    const prisma = getPrisma();
    const { owner, league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const open = await createContest(league.id, [event.id, later.event.id], 'Season Pool', ContestStatus.OPEN);
    await createContest(league.id, event.id, 'Called Off Pool', ContestStatus.OPEN);
    await createContest(league.id, [event.id, later.event.id], 'Draft Pool', ContestStatus.DRAFT);
    const [member, onlooker] = await Promise.all([
      createTestUser({ displayName: 'Entered Member' }),
      createTestUser({ displayName: 'No Entry' }),
    ]);
    for (const user of [member, onlooker]) {
      await prisma.leagueMembership.create({
        data: { leagueId: league.id, userId: user.user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    await prisma.squadMembership.create({
      data: { squadId: squads[0].id, leagueId: league.id, userId: member.user.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    const entry = await createEntry(open.id, squads[0].id, 1, 'Alpha Entry');
    await submitEntryEvent(entry.id, event.id, new Date());
    const send = mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail' }));
    const lifecycle = createEventLifecycleService(getAppPrisma(), {
      sportEventChanged: createContestNotices(getAppPrisma(), {
        email: emailServiceOver({ providerName: 'smtp', send }),
        appBaseUrl: 'https://app.example.test',
        logger: fakeLogger(),
        planEntitlements: integrationPlanEntitlements(),
      }),
    });

    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'CANCELLED', actor: { type: 'ROOT_ADMIN' },
    });

    await deliverQueuedEmail();
    expect(send.mock.calls.map(([message]) => message.to).sort()).toEqual([owner.user.email, member.user.email].sort());
    const toMember = send.mock.calls.find(([message]) => message.to === member.user.email)?.[0];
    expect(toMember?.subject).toBe(`Cancelled: ${event.name}`);
    expect(toMember?.text).toContain(`${event.name} has been cancelled. It counts for nothing in Season Pool.`);
  });
});

describe('Entry reminders on the Prisma adapters (#845)', () => {
  it('reminds the league members with nothing submitted for the event, each once, and skips the one who submitted', async () => {
    const prisma = getPrisma();
    const { owner, league, squads, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Reminded Pool', ContestStatus.OPEN);
    await prisma.contestConfiguration.create({
      data: {
        contestId: open.id,
        selectionType: 'TIERED',
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      },
    });
    const [drafting, submitted, removed] = await Promise.all([
      createTestUser({ displayName: 'Drafting Member' }),
      createTestUser({ displayName: 'Submitted Member' }),
      createTestUser({ displayName: 'Removed Member' }),
    ]);
    for (const [user, squad, status] of [[drafting, squads[0], 'ACTIVE'], [submitted, squads[1], 'ACTIVE'], [removed, squads[0], 'INACTIVE']] as const) {
      await prisma.leagueMembership.create({
        data: { leagueId: league.id, userId: user.user.id, role: 'MEMBER', status, joinedAt: new Date() },
      });
      await prisma.squadMembership.create({
        data: { squadId: squad.id, leagueId: league.id, userId: user.user.id, status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    await createEntry(open.id, squads[0].id, 1, 'Alpha Entry');
    const bravoEntry = await createEntry(open.id, squads[1].id, 1, 'Bravo Entry');
    await submitEntryEvent(bravoEntry.id, event.id, new Date());
    const send = mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail' }));
    const reminders = createEntryReminders(getAppPrisma(), {
      email: emailServiceOver({ providerName: 'smtp', send }),
      readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
      appBaseUrl: 'https://app.example.test',
    });
    const dayBefore = new Date(event.startDate.getTime() - 24 * 60 * 60_000 + 60_000);
    // Made OPEN directly, so the sweep is told to look at it, as opening it would (#1170).
    await repos().contests.recheckReminders({ contestIds: [open.id] }, dayBefore);

    await reminders.queueDue(dayBefore);
    await reminders.queueDue(dayBefore);
    await deliverQueuedEmail();

    // The sweep moved the check on to the 3-hour reminder.
    await expect(getPrisma().contest.findUniqueOrThrow({ where: { id: open.id }, select: { nextReminderAt: true } }))
      .resolves.toEqual({ nextReminderAt: new Date(event.startDate.getTime() - 3 * 60 * 60_000) });

    // Other suites' contests may be due too; only this league's emails are this test's.
    const ours = send.mock.calls.map(([message]) => message).filter((message) => message.from.name === league.name);
    expect(ours.map((message) => message.to).sort()).toEqual([owner.user.email, drafting.user.email].sort());
    expect(ours.every((message) => message.subject === 'Picks close soon: Reminded Pool')).toBe(true);
    expect(ours.find((message) => message.to === drafting.user.email)?.text).toMatch(/Your .+ entry is (a draft with \d+ of \d+ picked|saved as a draft)\./);
  });
});
