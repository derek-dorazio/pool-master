import {
  adminAutoAssignGolfPrices,
  adminAutoAssignGolfTiers,
  adminCreateGolfLeague,
  adminCreateGolfSeason,
  adminCreateGolfTournament,
  adminGetGolfTournament,
  adminGetGolfTournamentField,
  adminGetGolfTournamentTiers,
  adminLinkGolfTournamentScoreSource,
  adminListProviderCatalogEvents,
  adminRefreshGolfTournamentField,
  adminReplaceGolfTournamentTiers,
  adminSyncProviderEventData,
  adminTransitionGolfTournament,
  adminUnlinkGolfTournamentScoreSource,
} from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { randomUUID } from 'node:crypto';
import { buildRegisteredUser } from './builders';
import {
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';

// plans/124 §8 — pool-master-cs8. The provider-linked half of the golf-admin
// epic, which the flagship scenario (golf-admin-tournament.functional.ts)
// deliberately did not cover — it drives only the manual-admin authoring +
// clone + authz path. This scenario proves the whole provider-linked chain
// works end to end through the real API surface, driven through the generated
// SDK, with one real interaction with the mock contest-feed provider that the
// FAPI daemon now runs (tests/functional/server.ts):
//
//   1. adminListProviderCatalogEvents — browse the mock provider's live catalog.
//   2. adminLinkGolfTournamentScoreSource — bind a manual-admin tournament's
//      score source to a provider event (syncScope NONE -> SCORES_ONLY);
//      409 EXTERNAL_EVENT_ALREADY_LINKED when the event is already held.
//   3. adminRefreshGolfTournamentField + a manual EVENTLIVESCORES sync tick —
//      R1 scores land in SportEventParticipantGolfStanding via the sync path,
//      never adminApplyGolfRoundScores.
//   4. Score-sync isolation: an EVENTLIVESCORES tick never mutates the field,
//      and an EVENTPARTICIPANTS "details" sync never mutates SportEvent.status.
//   5. A league contest against the linked tournament settles
//      ContestEntryGolfStanding for the sync-driven scores.
//   6. adminUnlinkGolfTournamentScoreSource — a later sync tick does not touch
//      the now-unlinked event's data (unlink-then-no-touch).
//
// UC-GOLF-ADMIN-03 (link a live score source), UC-GOLF-ADMIN-04 (sync-driven
// live scoring + settlement), BR-GOLF-ADMIN-AUTHZ (root-admin-only ops).
//
// NOT covered here, and why: the "a scheduled EVENTPARTICIPANTS sweep skips a
// SCORES_ONLY event" assertion the epic narrative mentions is a
// scheduled-event-reader concern, not reachable through the SDK — the manual
// event-sync endpoint deliberately *permits* EVENTPARTICIPANTS for SCORES_ONLY
// (plans/125 §3.2; unit: admin-support-services.test.ts "pool-master-5h3").
// The scheduled per-feed syncScope gate is covered by
// scheduled-event-reader.test.ts "pool-master-cgb" and by
// mock-contest-feed-provider.integration.ts "pool-master-rop.68.1.7".

const MOCK_PROVIDER_ID = 'mock-contest-feed';
// A fixed, dateable event from the static golf-major-2026 scenario — never the
// wall-clock-relative generated scenario, so the catalog window is deterministic.
const MOCK_EVENT_EXTERNAL_ID = 'golf-us-open-2026';
const MOCK_EVENT_START = '2026-05-28T11:00:00.000Z';
const MOCK_EVENT_END = '2026-05-31T22:00:00.000Z';
const RUN = `cs8-${Date.now()}`;

const created = {
  sportEventIds: new Set<string>(),
  seasonIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
  participantIds: new Set<string>(),
  leagueIds: new Set<string>(),
  squadIds: new Set<string>(),
  contestIds: new Set<string>(),
  userIds: new Set<string>(),
};

async function promoteToRootAdmin(userId: string): Promise<void> {
  await getFunctionalPrisma().user.update({
    where: { id: userId },
    data: { isRootAdmin: true },
  });
}

async function ensureGolfSportRow(): Promise<string> {
  const sport = await getFunctionalPrisma().sport.upsert({
    where: { name: 'GOLF' },
    create: {
      name: 'GOLF',
      participantType: 'INDIVIDUAL',
      category: 'GOLF',
      tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
    },
    update: {},
  });
  return sport.id;
}

/**
 * Polls the provider_sync_runs ledger until the submitted async runs reach a
 * terminal state. adminSyncProviderEventData / adminRefreshGolfTournamentField
 * both return 202 and complete the workflow after acceptance.
 */
async function waitForSyncRuns(ids: string[]): Promise<void> {
  const db = getFunctionalPrisma();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await db.providerSyncRun.findMany({ where: { id: { in: ids } } });
    const terminal = rows.filter((r) => r.status === 'COMPLETED' || r.status === 'FAILED');
    if (rows.length === ids.length && terminal.length === ids.length) {
      const failed = rows.find((r) => r.status === 'FAILED');
      if (failed) {
        throw new Error(`Sync run ${failed.id} FAILED: ${JSON.stringify(failed.payloadJson)}`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for sync runs: ${ids.join(', ')}`);
}

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();

  const byName = await db.sportEvent.findMany({
    where: { OR: [{ name: { contains: RUN } }, { externalId: MOCK_EVENT_EXTERNAL_ID, providerId: MOCK_PROVIDER_ID }] },
    select: { id: true },
  });
  byName.forEach((e) => created.sportEventIds.add(e.id));
  const namedLeagues = await db.sportLeague.findMany({
    where: { name: { contains: RUN } },
    select: { id: true },
  });
  namedLeagues.forEach((l) => created.sportLeagueIds.add(l.id));

  const eventIds = [...created.sportEventIds];
  const sepRows = eventIds.length
    ? await db.sportEventParticipant.findMany({
        where: { sportEventId: { in: eventIds } },
        select: { id: true, participantId: true },
      })
    : [];
  const sepIds = sepRows.map((r) => r.id);
  const importedParticipantIds = new Set(sepRows.map((r) => r.participantId));

  const contestIds = new Set<string>(created.contestIds);
  if (eventIds.length) {
    const rows = await db.contest.findMany({ where: { sportEventId: { in: eventIds } }, select: { id: true } });
    rows.forEach((c) => contestIds.add(c.id));
  }
  if (contestIds.size) {
    const cids = [...contestIds];
    await db.draftPickHistory.deleteMany({ where: { entry: { contestId: { in: cids } } } });
    await db.contestEntryPick.deleteMany({ where: { entry: { contestId: { in: cids } } } });
    await db.contestEntryGolfStanding.deleteMany({ where: { contestId: { in: cids } } });
    await db.contestEntry.deleteMany({ where: { contestId: { in: cids } } });
    await db.draftSession.deleteMany({ where: { contestId: { in: cids } } });
    await db.participantContestScoringRule.deleteMany({ where: { contestConfiguration: { contestId: { in: cids } } } });
    await db.contestEntryAggregationRule.deleteMany({ where: { contestConfiguration: { contestId: { in: cids } } } });
    await db.contestPrizeDefinition.deleteMany({ where: { contestConfiguration: { contestId: { in: cids } } } });
    await db.contestConfiguration.deleteMany({ where: { contestId: { in: cids } } });
    await db.contest.deleteMany({ where: { id: { in: cids } } });
  }

  if (sepIds.length) {
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipantGolfRound.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipantGolfStanding.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipantGolfValuation.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipant.deleteMany({ where: { id: { in: sepIds } } });
  }
  if (eventIds.length) {
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventGolfTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.providerSyncRun.deleteMany({ where: { providerId: MOCK_PROVIDER_ID, eventId: MOCK_EVENT_EXTERNAL_ID } });
    await db.ingestionJob.deleteMany({ where: { providerId: MOCK_PROVIDER_ID } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  const leagueIds = [...created.leagueIds];
  if (leagueIds.length) {
    await db.squadMembership.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await db.squad.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await db.leagueMembership.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await db.league.deleteMany({ where: { id: { in: leagueIds } } });
  }

  const sportLeagueIds = [...created.sportLeagueIds];
  if (sportLeagueIds.length) {
    await db.sportLeague.updateMany({ where: { id: { in: sportLeagueIds } }, data: { currentSeasonId: null } });
  }
  const seasonIds = new Set<string>(created.seasonIds);
  if (sportLeagueIds.length) {
    const extra = await db.season.findMany({ where: { sportLeagueId: { in: sportLeagueIds } }, select: { id: true } });
    extra.forEach((s) => seasonIds.add(s.id));
    await db.leagueEvent.deleteMany({ where: { sportLeagueId: { in: sportLeagueIds } } });
  }
  if (seasonIds.size) {
    await db.season.deleteMany({ where: { id: { in: [...seasonIds] } } });
  }
  if (sportLeagueIds.length) {
    await db.sportLeague.deleteMany({ where: { id: { in: sportLeagueIds } } });
  }

  const allParticipantIds = new Set<string>([...created.participantIds, ...importedParticipantIds]);
  if (allParticipantIds.size) {
    const pids = [...allParticipantIds];
    await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: pids } } });
    await db.participantProviderMapping.deleteMany({ where: { participantId: { in: pids } } });
    await db.participantRankingSnapshot.deleteMany({ where: { participantId: { in: pids } } });
    await db.participant.deleteMany({
      where: {
        id: { in: pids },
        sportEventParticipants: { none: {} },
        providerMappings: { none: {} },
      },
    });
  }

  if (created.userIds.size) {
    const uids = [...created.userIds];
    await db.adminAuditEntry.deleteMany({ where: { actorId: { in: uids } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { id: { in: uids } } });
  }
}

afterAll(async () => {
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Golf provider-linked live scoring + settlement (pool-master-cs8, plans/124 §8)', () => {
  it('UC-GOLF-ADMIN-03/04: browse catalog -> link -> sync-driven R1 scores -> settle -> unlink-then-no-touch', async () => {
    await ensureGolfSportRow();

    const adminCtx = await buildRegisteredUser({ displayName: 'Golf Provider Admin' });
    created.userIds.add(adminCtx.userId);
    await promoteToRootAdmin(adminCtx.userId);
    const admin: Client = adminCtx.client;

    // --- Tour + season -------------------------------------------------------
    const league = await adminCreateGolfLeague({
      client: admin,
      body: { name: `USGA ${RUN}`, matchKeyword: 'U.S. Open' },
    });
    expect(league.response?.status).toBe(201);
    const sportLeagueId = league.data!.league.id;
    created.sportLeagueIds.add(sportLeagueId);

    const season = await adminCreateGolfSeason({
      client: admin,
      body: {
        sportLeagueId,
        name: `USGA ${RUN} 2026`,
        year: 2026,
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-07-31T00:00:00.000Z',
      },
    });
    expect(season.response?.status).toBe(201);
    const seasonId = season.data!.season.id;
    created.seasonIds.add(seasonId);

    // --- Manual-admin tournament (starts unlinked: syncScope NONE). Dates
    // match the provider event so the later details sync is a no-op for the
    // schedule. ------------------------------------------------------------
    const tournament = await adminCreateGolfTournament({
      client: admin,
      body: {
        name: `The ${RUN} Championship`,
        venue: 'Provider National',
        location: 'Testshire',
        startDate: MOCK_EVENT_START,
        endDate: MOCK_EVENT_END,
        rounds: 4,
        releaseAt: '2026-05-20T00:00:00.000Z',
        fieldLocksAt: '2026-05-27T16:00:00.000Z',
        seasonId,
        autoLifecycleEnabled: false,
      },
    });
    expect(tournament.response?.status).toBe(201);
    const eventId = tournament.data!.tournament.id;
    created.sportEventIds.add(eventId);
    expect(tournament.data!.tournament.syncScope).toBe('NONE');
    expect(tournament.data!.tournament.source).toBe('MANUAL');
    expect(tournament.data!.tournament.scoreSource).toBeNull();

    // --- 1. Browse the provider's live catalog for the tournament window ---
    const catalog = await adminListProviderCatalogEvents({
      client: admin,
      path: { providerId: MOCK_PROVIDER_ID },
      query: {
        sport: 'GOLF',
        from: '2026-05-27T00:00:00.000Z',
        to: '2026-05-29T00:00:00.000Z',
      },
    });
    expect(catalog.response?.status).toBe(200);
    const catalogEvents = catalog.data!.events;
    expect(Array.isArray(catalogEvents)).toBe(true);
    const usOpen = catalogEvents.find((e) => e.externalId === MOCK_EVENT_EXTERNAL_ID);
    expect(usOpen).toBeDefined();
    expect(usOpen!.name).toContain('U.S. Open');
    expect(new Date(usOpen!.startDate).getUTCFullYear()).toBe(2026);
    // Plain filtered list — the wall-clock-relative generated scenario is far
    // outside this window, so it must not leak in.
    expect(catalogEvents.every((e) => !e.externalId.startsWith('golf-relative-'))).toBe(true);

    // matchKeyword (from the linked SportLeague) narrows the same browse.
    const filtered = await adminListProviderCatalogEvents({
      client: admin,
      path: { providerId: MOCK_PROVIDER_ID },
      query: {
        sport: 'GOLF',
        sportLeagueId,
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(filtered.response?.status).toBe(200);
    expect(filtered.data!.events.length).toBeGreaterThan(0);
    expect(filtered.data!.events.every((e) => e.name.includes('U.S. Open'))).toBe(true);

    // --- 2. Link the manual-admin tournament's score source -------------
    const link = await adminLinkGolfTournamentScoreSource({
      client: admin,
      path: { eventId },
      body: { providerId: MOCK_PROVIDER_ID, externalId: MOCK_EVENT_EXTERNAL_ID },
    });
    expect(link.response?.status).toBe(200);
    expect(link.data!.tournament.syncScope).toBe('SCORES_ONLY');
    expect(link.data!.tournament.source).toBe('PROVIDER');
    expect(link.data!.tournament.scoreSource).toEqual({
      providerId: MOCK_PROVIDER_ID,
      externalId: MOCK_EVENT_EXTERNAL_ID,
    });

    // Linking does not import the field.
    const fieldAfterLink = await adminGetGolfTournamentField({ client: admin, path: { eventId } });
    expect(fieldAfterLink.data!.entries.length).toBe(0);

    // Failure path: a second manual-admin tournament cannot link the same
    // provider event.
    const rivalSeason = await adminCreateGolfSeason({
      client: admin,
      body: {
        sportLeagueId,
        name: `USGA ${RUN} rival`,
        year: 2027,
        startDate: '2027-04-01T00:00:00.000Z',
        endDate: '2027-07-31T00:00:00.000Z',
      },
    });
    created.seasonIds.add(rivalSeason.data!.season.id);
    const rival = await adminCreateGolfTournament({
      client: admin,
      body: {
        name: `Rival ${RUN} Championship`,
        startDate: MOCK_EVENT_START,
        endDate: MOCK_EVENT_END,
        rounds: 4,
        releaseAt: '2026-05-20T00:00:00.000Z',
        fieldLocksAt: '2026-05-27T16:00:00.000Z',
        seasonId: rivalSeason.data!.season.id,
        autoLifecycleEnabled: false,
      },
    });
    created.sportEventIds.add(rival.data!.tournament.id);
    expectFunctionalError(
      await adminLinkGolfTournamentScoreSource({
        client: admin,
        path: { eventId: rival.data!.tournament.id },
        body: { providerId: MOCK_PROVIDER_ID, externalId: MOCK_EVENT_EXTERNAL_ID },
      }),
      { status: 409, code: 'EXTERNAL_EVENT_ALREADY_LINKED' },
    );

    // --- 3a. Load the field from the provider. EVENTPARTICIPANTS is allowed
    // for a SCORES_ONLY event (plans/125 §3.2), so an admin refresh works and
    // creates the provider-mapped participant identities the score sync needs.
    const refresh = await adminRefreshGolfTournamentField({ client: admin, path: { eventId } });
    expect(refresh.response?.status).toBe(202);
    await waitForSyncRuns(refresh.data!.syncRuns.map((r) => r.id));

    const loadedField = await adminGetGolfTournamentField({ client: admin, path: { eventId } });
    // The mock provider pads the golf field from its scenario pool; assert a
    // real field arrived and remember its exact size for the isolation checks.
    const fieldSize = loadedField.data!.entries.length;
    expect(fieldSize).toBeGreaterThanOrEqual(10);
    const fieldSepIds = loadedField.data!.entries.map((e) => e.sportEventParticipantId).sort();

    // The details sync never writes SportEvent.status (plans/124 §3.3).
    const afterRefresh = await adminGetGolfTournament({ client: admin, path: { eventId } });
    expect(afterRefresh.data!.tournament.status).toBe('SCHEDULED');
    expect(afterRefresh.data!.tournament.syncScope).toBe('SCORES_ONLY');

    // --- Make the loaded field contest-selectable: 2 tiers + auto assign --
    expect(
      (await adminReplaceGolfTournamentTiers({
        client: admin,
        path: { eventId },
        body: {
          tiers: [1, 2].map((n) => ({
            tierKey: `tier-${n}`,
            label: `Tier ${n}`,
            tierNumber: n,
            defaultPickCount: 2,
          })),
          reassignOrphansTo: 'tier-1',
        },
      })).response?.status,
    ).toBe(200);
    expect(
      (await adminAutoAssignGolfTiers({ client: admin, path: { eventId }, body: { source: 'WORLD_RANK' } }))
        .response?.status,
    ).toBe(200);
    expect(
      (await adminAutoAssignGolfPrices({ client: admin, path: { eventId }, body: { minPrice: 1000, maxPrice: 10000 } }))
        .response?.status,
    ).toBe(200);

    // --- 5a. League contest against the linked tournament (prisma fixture:
    // the SDK managed-contest create path rejects an already-field-locked
    // event, and z3l proved the authoring SDK surface separately — here the
    // contest is a settlement fixture, not the thing under test). ---------
    const contestId = await buildGolfContestFixture(eventId);

    // --- 3b. Transition to live; the linked contest activates -----------
    const toLive = await adminTransitionGolfTournament({
      client: admin,
      path: { eventId },
      body: { toStatus: 'IN_PROGRESS' },
    });
    expect(toLive.response?.status).toBe(200);
    expect(toLive.data!.tournament.status).toBe('IN_PROGRESS');

    // --- 3c. One manual EVENTLIVESCORES sync tick -> R1 scores via sync -
    const db = getFunctionalPrisma();
    const r1Sync = await adminSyncProviderEventData({
      client: admin,
      path: { sport: 'GOLF', eventId: MOCK_EVENT_EXTERNAL_ID },
      body: { feeds: ['EVENTLIVESCORES'], mockEventState: 'golf-r1-complete' },
    });
    expect(r1Sync.response?.status).toBe(202);
    await waitForSyncRuns(r1Sync.data!.syncRuns.map((r) => r.id));

    // Scores arrived via the sync path — adminApplyGolfRoundScores was never
    // called anywhere in this scenario.
    const seps = await db.sportEventParticipant.findMany({
      where: { sportEventId: eventId },
      select: { id: true },
    });
    const sepIds = seps.map((s) => s.id);
    expect(sepIds.length).toBe(fieldSize);
    const standings = await db.sportEventParticipantGolfStanding.findMany({
      where: { sportEventParticipantId: { in: sepIds } },
    });
    expect(standings.length).toBe(fieldSize);
    expect(standings.every((s) => Number.isInteger(s.eventScoreToPar) && Number.isInteger(s.eventStrokes))).toBe(true);

    const round1 = await db.sportEventRound.findFirstOrThrow({
      where: { sportEventId: eventId, roundNumber: 1 },
      select: { id: true },
    });
    const r1RoundRows = await db.sportEventParticipantGolfRound.findMany({
      where: { sportEventParticipantId: { in: sepIds }, sportEventRoundId: round1.id },
    });
    expect(r1RoundRows.length).toBe(fieldSize);

    const liveScoreRun = await db.providerSyncRun.findFirst({
      where: { eventId: MOCK_EVENT_EXTERNAL_ID, providerId: MOCK_PROVIDER_ID, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(liveScoreRun).not.toBeNull();

    // --- 4. Score-sync isolation: the field is untouched by the tick ---
    const fieldAfterSync = await adminGetGolfTournamentField({ client: admin, path: { eventId } });
    expect(fieldAfterSync.data!.entries.map((e) => e.sportEventParticipantId).sort()).toEqual(fieldSepIds);
    expect(fieldAfterSync.data!.entries.every((e) => e.isActive)).toBe(true);

    // --- 5b. Drive to the finish, then COMPLETED -> settlement fires ---
    const finalSync = await adminSyncProviderEventData({
      client: admin,
      path: { sport: 'GOLF', eventId: MOCK_EVENT_EXTERNAL_ID },
      body: { feeds: ['EVENTLIVESCORES'], mockEventState: 'golf-completed' },
    });
    expect(finalSync.response?.status).toBe(202);
    await waitForSyncRuns(finalSync.data!.syncRuns.map((r) => r.id));

    const toDone = await adminTransitionGolfTournament({
      client: admin,
      path: { eventId },
      body: { toStatus: 'COMPLETED' },
    });
    expect(toDone.response?.status).toBe(200);
    expect(toDone.data!.tournament.status).toBe('COMPLETED');

    const settlement = await db.contestEntryGolfStanding.findMany({ where: { contestId } });
    expect(settlement.length).toBeGreaterThanOrEqual(1);
    expect(settlement.every((s) => Number.isInteger(s.totalScoreToPar))).toBe(true);
    expect(settlement.every((s) => s.status === 'FINAL')).toBe(true);
    const settledContest = await db.contest.findUniqueOrThrow({ where: { id: contestId } });
    expect(settledContest.status).toBe('COMPLETED');

    // --- 6. Unlink, then a further sync tick does not touch the data ---
    const standingsBefore = await db.sportEventParticipantGolfStanding.findMany({
      where: { sportEventParticipantId: { in: sepIds } },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    const roundsBefore = await db.sportEventParticipantGolfRound.count({
      where: { sportEventParticipantId: { in: sepIds } },
    });

    const unlink = await adminUnlinkGolfTournamentScoreSource({ client: admin, path: { eventId } });
    expect(unlink.response?.status).toBe(200);
    expect(unlink.data!.tournament.syncScope).toBe('NONE');
    expect(unlink.data!.tournament.source).toBe('MANUAL');
    expect(unlink.data!.tournament.scoreSource).toBeNull();
    const unlinkedRow = await db.sportEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(unlinkedRow.providerId).toBe('manual-admin');
    expect(unlinkedRow.externalId.startsWith('manual-')).toBe(true);

    // The mock externalId no longer resolves to any SportEvent row: the tick
    // is accepted but persists nothing against the now-unlinked tournament.
    const staleSync = await adminSyncProviderEventData({
      client: admin,
      path: { sport: 'GOLF', eventId: MOCK_EVENT_EXTERNAL_ID },
      body: { feeds: ['EVENTLIVESCORES'], mockEventState: 'golf-late-correction' },
    });
    expect(staleSync.response?.status).toBe(202);
    await waitForSyncRuns(staleSync.data!.syncRuns.map((r) => r.id));

    const standingsAfter = await db.sportEventParticipantGolfStanding.findMany({
      where: { sportEventParticipantId: { in: sepIds } },
      orderBy: { sportEventParticipantId: 'asc' },
    });
    const roundsAfter = await db.sportEventParticipantGolfRound.count({
      where: { sportEventParticipantId: { in: sepIds } },
    });
    expect(roundsAfter).toBe(roundsBefore);
    expect(standingsAfter.map((s) => [s.sportEventParticipantId, s.eventScoreToPar, s.eventStrokes])).toEqual(
      standingsBefore.map((s) => [s.sportEventParticipantId, s.eventScoreToPar, s.eventStrokes]),
    );

    const finalDetail = await adminGetGolfTournament({ client: admin, path: { eventId } });
    expect(finalDetail.data!.tournament.syncScope).toBe('NONE');
    const finalTiers = await adminGetGolfTournamentTiers({ client: admin, path: { eventId } });
    expect(finalTiers.data!.tiers.length).toBe(2);
  }, 120_000);

  it('BR-GOLF-ADMIN-AUTHZ: provider-link operations reject a non-root-admin caller with 403', async () => {
    const member = await buildRegisteredUser({ displayName: 'Golf Provider Non Admin' });
    created.userIds.add(member.userId);
    const c = member.client;
    const deny = { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' };

    expectFunctionalError(
      await adminListProviderCatalogEvents({
        client: c,
        path: { providerId: MOCK_PROVIDER_ID },
        query: { sport: 'GOLF' },
      }),
      deny,
    );
    expectFunctionalError(
      await adminLinkGolfTournamentScoreSource({
        client: c,
        path: { eventId: 'x' },
        body: { providerId: MOCK_PROVIDER_ID, externalId: MOCK_EVENT_EXTERNAL_ID },
      }),
      deny,
    );
    expectFunctionalError(
      await adminUnlinkGolfTournamentScoreSource({ client: c, path: { eventId: 'x' } }),
      deny,
    );
    expectFunctionalError(
      await adminRefreshGolfTournamentField({ client: c, path: { eventId: 'x' } }),
      deny,
    );
    expectFunctionalError(
      await adminSyncProviderEventData({
        client: c,
        path: { sport: 'GOLF', eventId: MOCK_EVENT_EXTERNAL_ID },
        body: { feeds: ['EVENTLIVESCORES'] },
      }),
      deny,
    );
  });
});

/**
 * Builds a minimal ACTIVE golf ROSTER/TIERED contest against `sportEventId`
 * with one entry whose picks reference the three current world-rank leaders in
 * the (provider-loaded) field — mirroring golf-contest-settlement.integration
 * .ts's fixture. Settlement is driven by the real COMPLETED transition, not a
 * direct service call.
 */
async function buildGolfContestFixture(sportEventId: string): Promise<string> {
  const db = getFunctionalPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await buildRegisteredUser({ displayName: `Provider Contest Owner ${suffix}` });
  created.userIds.add(owner.userId);

  const league = await db.league.create({
    data: {
      leagueCode: `CS8${suffix.toUpperCase()}`,
      name: `Provider Linked ${RUN} ${suffix}`,
      createdBy: owner.userId,
    },
  });
  created.leagueIds.add(league.id);
  await db.leagueMembership.create({
    data: {
      leagueId: league.id,
      userId: owner.userId,
      role: 'COMMISSIONER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  const squad = await db.squad.create({
    data: { leagueId: league.id, createdBy: owner.userId, name: `Provider Squad ${suffix}` },
  });
  created.squadIds.add(squad.id);
  await db.squadMembership.create({
    data: { leagueId: league.id, squadId: squad.id, userId: owner.userId, status: 'ACTIVE' },
  });

  const contest = await db.contest.create({
    data: {
      leagueId: league.id,
      sportEventId,
      name: `Provider Linked Contest ${RUN} ${suffix}`,
      status: 'ACTIVE',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
    },
  });
  created.contestIds.add(contest.id);
  await db.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: 'TIERED',
      configJson: { countedScores: 2 },
      rosterSize: 3,
      pickCount: 3,
    },
  });

  const entry = await db.contestEntry.create({
    data: {
      contestId: contest.id,
      squadId: squad.id,
      entryNumber: 1,
      name: `Provider Entry ${suffix}`,
      status: 'ACTIVE',
    },
  });

  const field = await db.sportEventParticipant.findMany({
    where: { sportEventId },
    orderBy: { worldRanking: 'asc' },
    select: { id: true },
    take: 3,
  });
  await db.contestEntryPick.createMany({
    data: field.map((sep, index) => ({
      entryId: entry.id,
      sportEventParticipantId: sep.id,
      contestFormat: 'ROSTER' as const,
      slot: index + 1,
    })),
  });

  return contest.id;
}
