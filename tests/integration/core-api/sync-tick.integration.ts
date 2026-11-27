/**
 * The sync tick's reads and writes against real Postgres (#2009): the slots each synced league
 * plays next, the linked events whose Games are due or in play, each subject's latest job, and the
 * tick's one write, at a fixed few statements however many leagues and events there are. The
 * migration retiring the old event sync jobs is run from its file. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SyncedLeagueRef } from '@poolmaster/shared/db';
import { BackgroundJobType, fieldWindowEventIds, JobTrigger, MatchStatus, Sport } from '@poolmaster/shared/domain';
import { PrismaBackgroundJobRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { PrismaSyncDueWorkReader } from '../../../packages/core-api/src/adapters/prisma-sync-due-work-reader';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { SyncTick } from '../../../packages/core-api/src/modules/ingestion/sync-tick';
import { INGESTION_SCHEDULE_SETTINGS } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { expectSameStatementCount } from '../query-scaling';
import { linkedProviderEvent } from '../../support/event-edition';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { heldHere } from '../../support/job-locks';
import { testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { uncachedStatement } from '../../support/put-back-sql';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2027-05-01T18:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

/** An active golf league synced from BALLDONTLIE's PGA TOUR, as the tick names it. */
async function syncedLeague(): Promise<SyncedLeagueRef> {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({ where: { sport: Sport.GOLF }, create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) }, update: {} });
  const league = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Tick Tour ${randomUUID().slice(0, 8)}`, isActive: true },
  });
  const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'pga');
  return { sportLeagueId: league.id, sportLeagueProviderMappingId };
}

/** An event of the league linked to the provider, its one synced slot starting at `startsAt`. */
async function linkedEventStarting(league: SyncedLeagueRef, startsAt: Date) {
  const prisma = getPrisma();
  const event = await linkedProviderEvent(prisma, {
    providerId: 'balldontlie', externalId: `tick-${randomUUID()}`, name: 'Tick Open', startDate: startsAt, sportLeagueId: league.sportLeagueId,
  });
  const slot = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id }, select: { id: true, sportLeagueSeasonCompetitionSlotId: true } });
  await prisma.sportLeagueSeasonCompetitionSlot.update({ where: { id: slot.sportLeagueSeasonCompetitionSlotId }, data: { startsAt } });
  return { ...event, sportEventSlotId: slot.id };
}

/** A Game of the event's first round, in the status and at the start given. */
async function gameOf(event: { id: string; sportEventSlotId: string }, game: { status: MatchStatus; scheduledDate: Date | null; lastProviderNotificationAt?: Date }) {
  const prisma = getPrisma();
  const round = await prisma.sportEventRound.findFirstOrThrow({ where: { sportEventId: event.id, roundNumber: 1 }, select: { id: true } });
  const match = await prisma.sportEventRoundMatch.create({ data: { sportEventId: event.id, sportEventRoundId: round.id, matchNumber: await prisma.sportEventRoundMatch.count({ where: { sportEventId: event.id } }) + 1 } });
  return prisma.sportEventRoundMatchGame.create({
    data: { sportEventId: event.id, sportEventRoundMatchId: match.id, sportEventSlotId: event.sportEventSlotId, gameNumber: 1, ...game },
  });
}

describe('the slots each synced league plays next', () => {
  it("names the events of the league's earliest unstarted synced slot, judged by its start: not a started slot, a later one, a test slot or an unlinked event's", async () => {
    const league = await syncedLeague();
    const prisma = getPrisma();
    const started = await linkedEventStarting(league, at(-HOUR));
    const next = await linkedEventStarting(league, at(24 * HOUR));
    const alongside = await linkedEventStarting(league, at(24 * HOUR));
    const later = await linkedEventStarting(league, at(7 * 24 * HOUR));
    // A test slot starting sooner, and a synced slot of an event the provider has no id for.
    const testSlotEvent = await linkedEventStarting(league, at(2 * HOUR));
    await prisma.sportLeagueSeasonCompetitionSlot.updateMany({ where: { eventSlot: { sportEventId: testSlotEvent.id } }, data: { isTestData: true, label: 'a test slot' } });
    const unlinked = await linkedEventStarting(league, at(3 * HOUR));
    await prisma.sportEventProviderMapping.deleteMany({ where: { sportEventId: unlinked.id } });

    const slots = await new PrismaSyncDueWorkReader(getAppPrisma()).findNextSlots({ leagues: [league], now: NOW });

    expect(new Set(fieldWindowEventIds(slots, NOW))).toEqual(new Set([next.id, alongside.id]));
    expect(slots.map((slot) => slot.sportEventId)).toEqual(expect.not.arrayContaining([started.id, later.id]));
  });

  it('reads no slot of a league the tick did not name', async () => {
    const league = await syncedLeague();
    const other = await syncedLeague();
    await linkedEventStarting(other, at(HOUR));

    await expect(new PrismaSyncDueWorkReader(getAppPrisma()).findNextSlots({ leagues: [league], now: NOW })).resolves.toEqual([]);
  });
});

describe('the linked events whose Games are due or in play', () => {
  it('reads an event with a Game in play or one whose start has come, with each such Game, and none with only Games yet to start, finished, or long overdue', async () => {
    const league = await syncedLeague();
    const live = await linkedEventStarting(league, at(-2 * HOUR));
    await gameOf(live, { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-2 * HOUR) });
    await gameOf(live, { status: MatchStatus.SCHEDULED, scheduledDate: at(-10 * 60_000) });
    await gameOf(live, { status: MatchStatus.SCHEDULED, scheduledDate: at(HOUR) });
    const finished = await linkedEventStarting(league, at(-5 * HOUR));
    await gameOf(finished, { status: MatchStatus.COMPLETED, scheduledDate: at(-5 * HOUR) });
    const overdue = await linkedEventStarting(league, at(-30 * 24 * HOUR));
    await gameOf(overdue, { status: MatchStatus.SCHEDULED, scheduledDate: at(-30 * 24 * HOUR) });

    const events = await new PrismaSyncDueWorkReader(getAppPrisma()).findLiveEvents({ leagues: [league], now: NOW });

    expect(events).toEqual([{
      sportEventId: live.id,
      sportLeagueId: league.sportLeagueId,
      games: expect.arrayContaining([
        { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-2 * HOUR), playedAsField: expect.any(Boolean) },
        { status: MatchStatus.SCHEDULED, scheduledDate: at(-10 * 60_000), playedAsField: expect.any(Boolean) },
      ]),
      lastHeardAt: null,
    }]);
    expect(events[0]?.games).toHaveLength(2);
  });

  it("hears an event last when the provider last notified about it or any of its due Games, whichever is later", async () => {
    const league = await syncedLeague();
    const live = await linkedEventStarting(league, at(-HOUR));
    await getPrisma().sportEvent.update({ where: { id: live.id }, data: { lastProviderNotificationAt: at(-40 * 60_000) } });
    await gameOf(live, { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-HOUR), lastProviderNotificationAt: at(-5 * 60_000) });

    const events = await new PrismaSyncDueWorkReader(getAppPrisma()).findLiveEvents({ leagues: [league], now: NOW });

    expect(events.at(0)?.lastHeardAt).toEqual(at(-5 * 60_000));
  });

  it("hears an event last at its own notification when that is later than its Games', and at a Game's when the event itself was never notified", async () => {
    const league = await syncedLeague();
    const eventLater = await linkedEventStarting(league, at(-HOUR));
    await getPrisma().sportEvent.update({ where: { id: eventLater.id }, data: { lastProviderNotificationAt: at(-2 * 60_000) } });
    await gameOf(eventLater, { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-HOUR), lastProviderNotificationAt: at(-30 * 60_000) });
    const gameOnly = await linkedEventStarting(league, at(-HOUR));
    await gameOf(gameOnly, { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-HOUR), lastProviderNotificationAt: at(-7 * 60_000) });

    const events = await new PrismaSyncDueWorkReader(getAppPrisma()).findLiveEvents({ leagues: [league], now: NOW });

    const heard = new Map(events.map((event) => [event.sportEventId, event.lastHeardAt]));
    expect(heard.get(eventLater.id)).toEqual(at(-2 * 60_000));
    expect(heard.get(gameOnly.id)).toEqual(at(-7 * 60_000));
  });

  it('reads nothing, sending no statement, when the tick names no league', async () => {
    const reader = new PrismaSyncDueWorkReader(getAppPrisma());

    await expect(reader.findLiveEvents({ leagues: [], now: NOW })).resolves.toEqual([]);
    await expect(reader.findNextSlots({ leagues: [], now: NOW })).resolves.toEqual([]);
  });
});

describe("each subject's latest job", () => {
  it("answers each event's latest run time due by now for one job type, leaving out a job due later, another type's jobs and an event with none", async () => {
    const prisma = getPrisma();
    const [first, second, none] = [randomUUID(), randomUUID(), randomUUID()];
    const job = (type: BackgroundJobType, sportEventId: string, runAt: Date) => ({ type, sportEventId, runAt, trigger: JobTrigger.SCHEDULE, payload: { sportEventId } });
    await prisma.backgroundJob.createMany({
      data: [
        job(BackgroundJobType.SYNC_EVENT_SCORES, first, at(-10 * 60_000)),
        job(BackgroundJobType.SYNC_EVENT_SCORES, first, at(-2 * 60_000)),
        job(BackgroundJobType.SYNC_EVENT_SCORES, first, at(10 * 60_000)),
        job(BackgroundJobType.SYNC_EVENT_SCORES, second, at(-HOUR)),
        job(BackgroundJobType.SYNC_EVENT_FIELD, second, at(-60_000)),
      ],
    });

    const latest = await new PrismaBackgroundJobRepository(getAppPrisma()).findLatestRunAt({
      type: BackgroundJobType.SYNC_EVENT_SCORES, by: 'sportEventId', ids: [first, second, none], dueBy: at(0),
    });

    expect(latest).toEqual(new Map([[first, at(-2 * 60_000)], [second, at(-HOUR)]]));
  });
});

describe('one sync tick', () => {
  function tick() {
    const jobs = new PrismaBackgroundJobRepository(getAppPrisma());
    return new SyncTick({
      sportLeagues: new PrismaSportLeagueRepository(getAppPrisma()),
      dueWork: new PrismaSyncDueWorkReader(getAppPrisma()),
      jobHistory: jobs,
      jobs: new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart }),
      registry: registryWith(fakeSportDataProvider()),
      schedule: { getConfig: () => Promise.resolve(INGESTION_SCHEDULE_SETTINGS.defaults({})) },
      notifiedProviderCadence: () => undefined,
      jobLock: heldHere(),
      now: () => NOW,
    });
  }

  it("queues each synced league's events sync, its next slot's field and its live event's scores, and nothing again a tick later", async () => {
    const league = await syncedLeague();
    const next = await linkedEventStarting(league, at(24 * HOUR));
    const live = await linkedEventStarting(league, at(-HOUR));
    await gameOf(live, { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-HOUR) });

    await expect(tick().tick()).resolves.toBe(3);

    const queued = await getPrisma().backgroundJob.findMany({ select: { type: true, sportLeagueId: true, sportEventId: true, trigger: true } });
    expect(queued).toEqual(expect.arrayContaining([
      { type: BackgroundJobType.SYNC_LEAGUE_EVENTS, sportLeagueId: league.sportLeagueId, sportEventId: null, trigger: JobTrigger.SCHEDULE },
      { type: BackgroundJobType.SYNC_EVENT_FIELD, sportLeagueId: null, sportEventId: next.id, trigger: JobTrigger.SCHEDULE },
      { type: BackgroundJobType.SYNC_EVENT_SCORES, sportLeagueId: null, sportEventId: live.id, trigger: JobTrigger.SCHEDULE },
    ]));
    expect(queued).toHaveLength(3);
    // The jobs just queued pace the next tick: none is due again yet.
    await expect(tick().tick()).resolves.toBe(0);
  });

  it('reads and writes in the same statements however many synced leagues and events are due', async () => {
    await expectSameStatementCount({
      seed: async (leagues) => {
        for (let index = 0; index < leagues; index += 1) {
          // poolmaster-allow-query-in-loop: test setup, one synced league with its next and live events per row
          const league = await syncedLeague();
          await linkedEventStarting(league, at(24 * HOUR));
          const live = await linkedEventStarting(league, at(-HOUR));
          await gameOf(live, { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-HOUR) });
        }
        return tick();
      },
      call: (syncTick) => syncTick.tick(),
      rowsShown: (queued) => queued,
    });
  });
});

describe('the migration retiring the old event sync jobs', () => {
  const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218029600_event_sync_jobs/migration.sql');
  const OLD_TYPES = [
    'MANUAL_EVENT_SYNC', 'PROVIDER_EVENT_SYNC', 'CONTEST_STARTED_EMAILS', 'CONTEST_SETTLED_EMAILS', 'CONTEST_EVENT_CHANGED_EMAILS',
    'SETTLE_SPORT_EVENT_CONTESTS', 'SETTLE_GAME_CONTESTS', 'REBUILD_LEADERBOARDS', 'CONTEST_REOPENED_EMAILS', 'SYNC_LEAGUE_EVENTS',
    'RELEASE_SPORT_EVENT', 'SYNC_EVENT_GAMES_AND_TIERS', 'ACTIVATE_EVENT_CONTESTS', 'FOLLOW_POSTPONED_EVENT_CONTESTS',
    'RESOLVE_MAPPED_PARTICIPANT_FINDINGS', 'REFRESH_SLOT_TIEBREAKERS',
  ];
  class Rollback extends Error {}

  function migrationStatements(): string[] {
    return readFileSync(MIGRATION, 'utf8')
      .split(/;\s*\n/)
      .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
      .filter((statement) => statement.length > 0);
  }

  it("deletes the retired types' jobs, queued or finished, and keeps every other job", async () => {
    let kept: string[] = [];
    await expect(getPrisma().$transaction(async (tx) => {
      // The job type as it was before the migration.
      await tx.$executeRawUnsafe('ALTER TYPE "PrismaBackgroundJobType" RENAME TO "PrismaBackgroundJobType_current"');
      await tx.$executeRawUnsafe(`CREATE TYPE "PrismaBackgroundJobType" AS ENUM (${OLD_TYPES.map((type) => `'${type}'`).join(', ')})`);
      await tx.$executeRawUnsafe('ALTER TABLE "background_jobs" ALTER COLUMN "type" TYPE "PrismaBackgroundJobType" USING ("type"::text::"PrismaBackgroundJobType")');
      await tx.$executeRawUnsafe('DROP TYPE "PrismaBackgroundJobType_current"');
      for (const [type, status] of [['MANUAL_EVENT_SYNC', 'QUEUED'], ['PROVIDER_EVENT_SYNC', 'SUCCEEDED'], ['SYNC_LEAGUE_EVENTS', 'QUEUED']] as const) {
        // poolmaster-allow-query-in-loop: three fixture jobs, one of each kind the migration tells apart
        await tx.$executeRaw`${uncachedStatement()} INSERT INTO "background_jobs" ("type", "payload", "status", "trigger", "completed_at") VALUES (${type}::"PrismaBackgroundJobType", '{}'::jsonb, ${status}::"PrismaBackgroundJobStatus", 'SYSTEM'::"PrismaJobTrigger", ${status === 'SUCCEEDED' ? NOW : null})`;
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      kept = (await tx.$queryRaw<Array<{ type: string }>>`${uncachedStatement()} SELECT "type"::text AS "type" FROM "background_jobs"`).map((row) => row.type);
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    expect(kept).toEqual(['SYNC_LEAGUE_EVENTS']);
  });
});
