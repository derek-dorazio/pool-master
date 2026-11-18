import { expect, jest } from '@jest/globals';
import {
  AutoReleaseCheckOutcome,
  BackgroundJobType,
  ReleaseAttemptOutcome,
  ReleaseAttemptSkipReason,
  ReleaseCheckKey,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import { releaseAttemptResultToJson } from '../../../packages/core-api/src/modules/events/release-sport-event-job';
import { SportEventService } from '../../../packages/core-api/src/modules/events/service';
import { SportEventAutoReleaseScheduler } from '../../../packages/core-api/src/modules/events/sport-event-auto-release-scheduler';
import { SportEventBracketService } from '../../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { standardEventPricing } from '../../support/budget-pricing';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';
import { InMemorySportEvents, NO_PICKS_ON_EVENT } from '../../support/in-memory-sport-events';
import { fakeContestConfigurationRepo, fakeContestRepo } from '../../support/repo-fakes';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER = 'balldontlie';

function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const sportLeague = store.addSportLeague(sport.id);
  sportLeague.eventSyncProviderId = PROVIDER;
  const sportEvents = store.sportEventRepo();
  const lifecycle = new EventLifecycleService(
    { contests: fakeContestRepo(), configurations: fakeContestConfigurationRepo(), matches: store.matchRepo() },
    sportEvents,
  );
  const service = new SportEventService({
    sportEvents,
    eventSeries: store.eventSeriesRepo(),
    sportLeagues: store.sportLeagueRepo(),
    sports: store.sportRepo(),
    rounds: new SportEventRoundService({ rounds: store.roundRepo() }),
    tiers: new SportEventTierService({ sportEvents, tiers: store.tierRepo(), valuations: store.valuationRepo(), field: store.fieldRepo(), participants: store.participantRepo() }),
    bracket: new SportEventBracketService({
      sportEvents,
      sportLeagues: store.sportLeagueRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      affiliations: store.affiliationRepo(),
      matches: store.matchRepo(),
      tiers: store.tierRepo(),
      valuations: store.valuationRepo(),
      ...NO_PICKS_ON_EVENT,
      contests: { recheckReminders: async () => undefined },
    }),
    lifecycle,
    contests: { recheckReminders: async () => undefined },
    needsLinking: store.needsLinkingRepo(),
    now: () => NOW,
  });
  const jobRows = inMemoryBackgroundJobs(() => NOW);
  const scheduler = new SportEventAutoReleaseScheduler({
    sportEvents,
    jobs: new BackgroundJobQueue({ jobs: jobRows }),
    jobLock: { runExclusive: async (_key, work) => { await work(); return true; } },
    now: () => NOW,
  });
  return { store, service, sportLeague, scheduler, jobRows };
}

/**
 * A synced DRAFT golf event starting `daysAhead` days from now with a round, a field of three
 * golfers each linked to the provider, in a tier and priced: every ready check passes.
 */
async function readySyncedDraft(store: InMemorySportEvents, sportLeagueId: string, daysAhead: number, overrides: Partial<SportEvent> = {}) {
  const event = store.addEvent({
    status: SportEventStatus.DRAFT,
    sportLeagueId,
    providerId: PROVIDER,
    syncScope: SportEventSyncScope.SCORES_ONLY,
    eventSyncProviderId: PROVIDER,
    startDate: new Date(NOW.getTime() + daysAhead * DAY_MS),
    ...overrides,
  });
  await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: event.startDate }]);
  await store.addTiers(event.id, [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 }]);
  const tierId = store.tierRows.find((tier) => tier.sportEventId === event.id)?.id ?? '';
  const entries = ['a', 'b', 'c'].map((name) => {
    const participantId = `participant-${event.id}-${name}`;
    store.mappings.push({ id: `mapping-${participantId}`, participantId, providerId: PROVIDER, externalId: participantId, confidence: 'EXACT', mappedAt: NOW, createdAt: NOW, updatedAt: NOW });
    return store.addToField(event.id, participantId);
  });
  await store.valuationRepo().assignTiers(entries.map((entry, index) => ({ sportEventParticipantId: entry.id, sportEventTierId: tierId, tierOrderIndex: index + 1, source: 'MANUAL' })));
  await store.valuationRepo().assignEventPrices({
    sportEventId: event.id,
    pricingConfig: standardEventPricing(),
    assignments: entries.map((entry) => ({ sportEventParticipantId: entry.id, price: 6000, source: 'AUTO_RANKING' })),
  });
  return event;
}

function statusOf(store: InMemorySportEvents, sportEventId: string) {
  return store.events.find((event) => event.id === sportEventId)?.status;
}

describe('SportEventService.autoReleaseEvent: one automatic release attempt (#1823)', () => {
  it('releases a synced draft in its window whose every ready check passes, reporting every check with its value', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);

    const result = await service.autoReleaseEvent(event.id);

    expect(result).toEqual({
      outcome: ReleaseAttemptOutcome.RELEASED,
      checks: [
        { key: ReleaseCheckKey.NOT_STARTED, passed: true, value: event.startDate },
        { key: ReleaseCheckKey.ROUNDS_SCHEDULED, passed: true, value: 1 },
        { key: ReleaseCheckKey.FIELD_LOADED, passed: true, value: 3 },
        { key: ReleaseCheckKey.FIELD_LINKED, passed: true, value: { unlinkedParticipants: 0, needsLinking: 0 } },
        { key: ReleaseCheckKey.TIERS_ASSIGNED, passed: true, value: 0 },
        { key: ReleaseCheckKey.TIERS_FILLED, passed: true, value: [] },
        { key: ReleaseCheckKey.PRICES_ASSIGNED, passed: true, value: 0 },
        { key: ReleaseCheckKey.CONTEST_SETUPS_ON, passed: true, value: 1 },
      ],
    });
    expect(statusOf(store, event.id)).toBe(SportEventStatus.SCHEDULED);
  });

  it('holds a draft with one golfer the provider does not know, logging the failing link check and its count, and leaves it a draft', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.mappings.splice(0, 1);

    const result = await service.autoReleaseEvent(event.id);

    expect(result.outcome).toBe(ReleaseAttemptOutcome.HELD);
    expect(result).toMatchObject({ checks: expect.arrayContaining([{ key: ReleaseCheckKey.FIELD_LINKED, passed: false, value: { unlinkedParticipants: 1, needsLinking: 0 } }]) });
    expect(statusOf(store, event.id)).toBe(SportEventStatus.DRAFT);
  });

  it('holds a draft whose every golfer is linked while a name its field sent still waits in Needs linking, and leaves it a draft', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.needsLinkingCounts.set(event.id, 2);

    const result = await service.autoReleaseEvent(event.id);

    expect(result.outcome).toBe(ReleaseAttemptOutcome.HELD);
    expect(result).toMatchObject({ checks: expect.arrayContaining([{ key: ReleaseCheckKey.FIELD_LINKED, passed: false, value: { unlinkedParticipants: 0, needsLinking: 2 } }]) });
    expect(statusOf(store, event.id)).toBe(SportEventStatus.DRAFT);
  });

  it('holds a draft whose sport league offers no active contest setup, and one with no rounds scheduled', async () => {
    const { store, service, sportLeague } = setup();
    const noSetups = await readySyncedDraft(store, sportLeague.id, 3);
    store.contestSetupCounts.set(sportLeague.id, 0);

    await expect(service.autoReleaseEvent(noSetups.id)).resolves.toMatchObject({
      outcome: ReleaseAttemptOutcome.HELD,
      checks: expect.arrayContaining([{ key: ReleaseCheckKey.CONTEST_SETUPS_ON, passed: false, value: 0 }]),
    });
    store.contestSetupCounts.delete(sportLeague.id);
    const noRounds = await readySyncedDraft(store, sportLeague.id, 3);
    store.roundRows = store.roundRows.filter((round) => round.sportEventId !== noRounds.id);

    await expect(service.autoReleaseEvent(noRounds.id)).resolves.toMatchObject({
      outcome: ReleaseAttemptOutcome.HELD,
      checks: expect.arrayContaining([{ key: ReleaseCheckKey.ROUNDS_SCHEDULED, passed: false, value: 0 }]),
    });
    expect(statusOf(store, noSetups.id)).toBe(SportEventStatus.DRAFT);
    expect(statusOf(store, noRounds.id)).toBe(SportEventStatus.DRAFT);
  });

  it('skips an event outside its league\'s window, one whose league turned automatic release off, an unsynced one and one already released, changing none', async () => {
    const { store, service, sportLeague } = setup();
    const outside = await readySyncedDraft(store, sportLeague.id, 8);
    const unsynced = await readySyncedDraft(store, sportLeague.id, 3, { providerId: 'manual-admin', syncScope: SportEventSyncScope.NONE });
    const released = await readySyncedDraft(store, sportLeague.id, 3, { status: SportEventStatus.SCHEDULED });

    await expect(service.autoReleaseEvent(outside.id)).resolves.toEqual({ outcome: ReleaseAttemptOutcome.SKIPPED, reason: ReleaseAttemptSkipReason.OUTSIDE_WINDOW });
    await expect(service.autoReleaseEvent(unsynced.id)).resolves.toEqual({ outcome: ReleaseAttemptOutcome.SKIPPED, reason: ReleaseAttemptSkipReason.NOT_SYNCED });
    await expect(service.autoReleaseEvent(released.id)).resolves.toEqual({ outcome: ReleaseAttemptOutcome.SKIPPED, reason: ReleaseAttemptSkipReason.NOT_DRAFT });
    sportLeague.autoReleaseDaysBeforeStart = null;
    const inWindow = await readySyncedDraft(store, sportLeague.id, 3);
    await expect(service.autoReleaseEvent(inWindow.id)).resolves.toEqual({ outcome: ReleaseAttemptOutcome.SKIPPED, reason: ReleaseAttemptSkipReason.AUTO_RELEASE_OFF });
    expect(statusOf(store, outside.id)).toBe(SportEventStatus.DRAFT);
    expect(statusOf(store, inWindow.id)).toBe(SportEventStatus.DRAFT);
  });

  it('reports a skipped attempt as stored JSON with its reason alone', () => {
    expect(releaseAttemptResultToJson({ outcome: ReleaseAttemptOutcome.SKIPPED, reason: ReleaseAttemptSkipReason.NOT_DRAFT }))
      .toEqual({ outcome: 'SKIPPED', reason: 'NOT_DRAFT' });
  });

  it('reports the attempt as stored JSON: the start as an ISO string, every other value as it is', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);

    const json = releaseAttemptResultToJson(await service.autoReleaseEvent(event.id));

    expect(json).toMatchObject({ outcome: 'RELEASED', checks: expect.arrayContaining([{ key: 'NOT_STARTED', passed: true, value: event.startDate.toISOString() }]) });
  });
});

describe('SportEventService ready checks on a root admin\'s read (#1823)', () => {
  it('carries a draft\'s checks on a root admin\'s read of it, none on a member\'s read or once it is released', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);

    expect((await service.requireSummary(event.id, { adminCounts: true })).releaseChecks).toHaveLength(8);
    expect((await service.requireSummary(event.id, { adminCounts: false })).releaseChecks).toBeUndefined();
    await service.releaseEvent(event.id);
    expect((await service.requireSummary(event.id, { adminCounts: true })).releaseChecks).toBeUndefined();
  });

  it('leaves the provider link check off an event no provider syncs', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3, { providerId: 'manual-admin', syncScope: SportEventSyncScope.NONE });

    const keys = (await service.requireSummary(event.id, { adminCounts: true })).releaseChecks?.map((check) => check.key);

    expect(keys).not.toContain(ReleaseCheckKey.FIELD_LINKED);
  });

  it('lets a root admin release a draft the automatic release would hold for its rounds, provider links or league setups', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.contestSetupCounts.set(sportLeague.id, 0);
    store.mappings.splice(0, 1);
    store.roundRows = store.roundRows.filter((round) => round.sportEventId !== event.id);

    await expect(service.autoReleaseEvent(event.id)).resolves.toMatchObject({ outcome: ReleaseAttemptOutcome.HELD });
    await expect(service.releaseEvent(event.id)).resolves.toMatchObject({ event: { status: SportEventStatus.SCHEDULED } });
  });

  it('still refuses a manual release of a draft with an untiered golfer, as before', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.addToField(event.id, 'participant-untiered');

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_READY', statusCode: 422, message: expect.stringContaining('have no tier') });
  });

  it('refuses a manual release of a started draft with 409 SPORT_EVENT_ALREADY_STARTED, as before', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, -1);

    await expect(service.releaseEvent(event.id)).rejects.toMatchObject({ code: 'SPORT_EVENT_ALREADY_STARTED', statusCode: 409 });
  });
});

describe('SportEventService stores each automatic release check on the event (#1847)', () => {
  it('stores a held check with its time and the keys of the checks that failed, so the Sports page can count it', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.mappings.splice(0, 1);
    store.contestSetupCounts.set(sportLeague.id, 0);

    await service.autoReleaseEvent(event.id);

    expect(store.autoReleaseChecks.get(event.id)).toEqual({
      checkedAt: NOW,
      outcome: AutoReleaseCheckOutcome.HELD,
      failedChecks: [ReleaseCheckKey.FIELD_LINKED, ReleaseCheckKey.CONTEST_SETUPS_ON],
    });
  });

  it('overwrites a held check with RELEASED and no failed checks once a later check releases the event', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.contestSetupCounts.set(sportLeague.id, 0);
    await service.autoReleaseEvent(event.id);
    store.contestSetupCounts.delete(sportLeague.id);

    await service.autoReleaseEvent(event.id);

    expect(store.autoReleaseChecks.get(event.id)).toEqual({ checkedAt: NOW, outcome: AutoReleaseCheckOutcome.RELEASED, failedChecks: [] });
  });

  it('clears a held check when a root admin releases the event by hand', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.contestSetupCounts.set(sportLeague.id, 0);
    await service.autoReleaseEvent(event.id);

    await service.releaseEvent(event.id);

    expect(store.autoReleaseChecks.has(event.id)).toBe(false);
  });

  it('leaves the stored check as it was when an attempt is skipped', async () => {
    const { store, service, sportLeague } = setup();
    const event = await readySyncedDraft(store, sportLeague.id, 3);
    store.contestSetupCounts.set(sportLeague.id, 0);
    await service.autoReleaseEvent(event.id);
    const held = store.autoReleaseChecks.get(event.id);
    sportLeague.autoReleaseDaysBeforeStart = null;

    await expect(service.autoReleaseEvent(event.id)).resolves.toMatchObject({ outcome: ReleaseAttemptOutcome.SKIPPED });
    expect(store.autoReleaseChecks.get(event.id)).toBe(held);
  });
});

describe('SportEventAutoReleaseScheduler: the hourly sweep (#1823)', () => {
  it('queues one release job for each synced draft inside its league\'s window, and none for one outside it or in an off league', async () => {
    const { store, sportLeague, scheduler, jobRows } = setup();
    const inWindow = await readySyncedDraft(store, sportLeague.id, 6);
    await readySyncedDraft(store, sportLeague.id, 8);
    const offLeague = store.addSportLeague(sportLeague.sportId, 'Korn Ferry Tour');
    offLeague.eventSyncProviderId = PROVIDER;
    offLeague.autoReleaseDaysBeforeStart = null;
    await readySyncedDraft(store, offLeague.id, 2);

    await scheduler.runSweep();

    expect(jobRows.rows.map((row) => [row.type, row.payload])).toEqual([
      [BackgroundJobType.RELEASE_SPORT_EVENT, { sportEventId: inWindow.id, trigger: 'SCHEDULE' }],
    ]);
  });

  it('follows each league\'s own window: a 2-day league leaves an event 3 days out alone', async () => {
    const { store, sportLeague, scheduler, jobRows } = setup();
    sportLeague.autoReleaseDaysBeforeStart = 2;
    await readySyncedDraft(store, sportLeague.id, 3);
    const close = await readySyncedDraft(store, sportLeague.id, 1);

    await scheduler.runSweep();

    expect(jobRows.rows.map((row) => row.payload)).toEqual([{ sportEventId: close.id, trigger: 'SCHEDULE' }]);
  });

  it('queues no second job for an event whose job has not run yet, however often it sweeps', async () => {
    const { store, sportLeague, scheduler, jobRows } = setup();
    await readySyncedDraft(store, sportLeague.id, 3);

    await scheduler.runSweep();
    await scheduler.runSweep();

    expect(jobRows.rows).toHaveLength(1);
  });

  it('sweeps on its timer once started, and no more once stopped', async () => {
    jest.useFakeTimers();
    try {
      const { store, sportLeague, scheduler, jobRows } = setup();
      await readySyncedDraft(store, sportLeague.id, 3);

      scheduler.start();
      await jest.advanceTimersByTimeAsync(60 * 1000);
      scheduler.stop();

      expect(jobRows.rows).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves alone a draft not linked to its league\'s sync provider', async () => {
    const { store, sportLeague, scheduler, jobRows } = setup();
    await readySyncedDraft(store, sportLeague.id, 3, { providerId: 'manual-admin', syncScope: SportEventSyncScope.NONE });

    await scheduler.runSweep();

    expect(jobRows.rows).toEqual([]);
  });
});
