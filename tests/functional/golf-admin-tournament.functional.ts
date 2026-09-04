import {
  adminSetCurrentGolfSeason,
  adminApplyGolfLeagueRosterUpload,
  adminApplyGolfRoundScores,
  adminAutoAssignGolfPrices,
  adminAutoAssignGolfTiers,
  adminBulkAddGolfFieldEntries,
  adminCloneGolfSeason,
  adminCreateGolfLeague,
  adminCreateGolfPlayer,
  adminCreateGolfSeason,
  adminCreateGolfTournament,
  adminGetGolfSeason,
  adminGetGolfTournament,
  adminGetGolfTournamentField,
  adminGetGolfTournamentRounds,
  adminGetGolfTournamentTiers,
  adminListGolfSeasons,
  adminListGolfTournaments,
  adminPreviewGolfRoundScores,
  adminReplaceGolfTierAssignments,
  adminReplaceGolfTournamentTiers,
  adminSeedGolfTournamentField,
  adminTransitionGolfTournament,
  adminUpdateGolfFieldEntries,
  adminUpdateGolfRoundScore,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  createFunctionalEmail,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';

// plans/124 §8 — pool-master-z3l. End-to-end golf-admin authoring journey through
// the generated SDK: tour -> season -> players -> roster upload -> tournament ->
// field seed/edit/guest-add -> tiers/prices -> assignments -> lifecycle
// transitions -> round-score bulk load + correction -> clone season. Plus
// root-admin permission negatives on the new operations.
//
// UC-GOLF-ADMIN-01 (manual tournament setup), UC-GOLF-ADMIN-02 (clone a season's
// calendar), BR-GOLF-ADMIN-AUTHZ (every admin-golf op requires root admin).

const RUN = `z3l-${Date.now()}`;

async function promoteToRootAdmin(userId: string): Promise<void> {
  await getFunctionalPrisma().user.update({
    where: { id: userId },
    data: { isRootAdmin: true },
  });
}

async function ensureGolfSportRow(): Promise<void> {
  await getFunctionalPrisma().sport.upsert({
    where: { name: 'GOLF' },
    create: {
      name: 'GOLF',
      participantType: 'INDIVIDUAL',
      category: 'GOLF',
      tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
    },
    update: {},
  });
}

// Track everything this suite creates so it can be torn down child-first — the
// shared functional cleanup keys off @functional.test users / test provider ids
// and does not know about manual-admin golf rows.
const created = {
  sportEventIds: new Set<string>(),
  seasonIds: new Set<string>(),
  sportLeagueIds: new Set<string>(),
  participantIds: new Set<string>(),
  userIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  // Safety net for a mid-run failure that created an event this suite never
  // captured (e.g. a clone): sweep by this run's name stamp too.
  const byName = await db.sportEvent.findMany({
    where: { name: { contains: RUN } },
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
        select: { id: true },
      })
    : [];
  const sepIds = sepRows.map((r) => r.id);

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
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  const leagueIds = [...created.sportLeagueIds];
  if (leagueIds.length) {
    // Clear the current-season pointer before deleting seasons.
    await db.sportLeague.updateMany({
      where: { id: { in: leagueIds } },
      data: { currentSeasonId: null },
    });
  }
  if (created.participantIds.size) {
    const pids = [...created.participantIds];
    await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: pids } } });
    await db.participantProviderMapping.deleteMany({ where: { participantId: { in: pids } } });
  }
  // Seasons the suite created *plus* any clone-created seasons on its leagues.
  const seasonIds = new Set<string>(created.seasonIds);
  if (leagueIds.length) {
    const extra = await db.season.findMany({
      where: { sportLeagueId: { in: leagueIds } },
      select: { id: true },
    });
    extra.forEach((s) => seasonIds.add(s.id));
  }
  if (seasonIds.size) {
    await db.leagueEvent.deleteMany({ where: { sportLeague: { id: { in: leagueIds } } } });
    await db.season.deleteMany({ where: { id: { in: [...seasonIds] } } });
  }
  if (leagueIds.length) {
    await db.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
  if (created.userIds.size) {
    await db.adminAuditEntry.deleteMany({ where: { actorId: { in: [...created.userIds] } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
    await db.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  }
}

afterAll(async () => {
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Golf tournament admin (pool-master-z3l, plans/124 §8)', () => {
  it('UC-GOLF-ADMIN-01/02: walks the full manual authoring journey and clones the season forward', async () => {
    await ensureGolfSportRow();

    const admin = await buildRegisteredUser({ displayName: 'Golf Admin Pilot' });
    created.userIds.add(admin.userId);
    await promoteToRootAdmin(admin.userId);
    const c = admin.client;

    // --- Tour + season -------------------------------------------------------
    const league = await adminCreateGolfLeague({
      client: c,
      body: { name: `PGA Tour ${RUN}`, matchKeyword: 'PGA' },
    });
    expect(league.response?.status).toBe(201);
    const leagueId = league.data!.league.id;
    created.sportLeagueIds.add(leagueId);

    const season = await adminCreateGolfSeason({
      client: c,
      body: {
        sportLeagueId: leagueId,
        name: `PGA Tour ${RUN} 2026`,
        year: 2026,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-11-30T00:00:00.000Z',
      },
    });
    expect(season.response?.status).toBe(201);
    const seasonId = season.data!.season.id;
    created.seasonIds.add(seasonId);

    // --- 20 players + roster bulk upload (incl. a tied ranking pair) --------
    const players: Array<{ id: string; externalId: string; rank: number }> = [];
    for (let i = 0; i < 20; i += 1) {
      const externalId = `${RUN}-p${i}`;
      const p = await adminCreateGolfPlayer({
        client: c,
        body: { name: `${RUN} Player ${i}`, shortName: `P${i}`, nationality: 'USA', externalId },
      });
      expect(p.response?.status).toBe(201);
      created.participantIds.add(p.data!.player.id);
      // ranks 1..19 with p18 and p19 tied at 19 to exercise the tie-break
      players.push({ id: p.data!.player.id, externalId, rank: i >= 18 ? 19 : i + 1 });
    }

    const rosterApply = await adminApplyGolfLeagueRosterUpload({
      client: c,
      path: { leagueId },
      body: { rows: players.map((p) => ({ externalId: p.externalId, worldRanking: p.rank })) },
    });
    expect(rosterApply.response?.status).toBe(200);
    expect(rosterApply.data!.entries.length).toBe(20);

    // --- Tournament: seeds 4 rounds + 6 default tiers ----------------------
    const tournament = await adminCreateGolfTournament({
      client: c,
      body: {
        name: `The ${RUN} Open`,
        venue: 'Royal Functional',
        location: 'Testshire',
        startDate: '2026-07-16T08:00:00.000Z',
        endDate: '2026-07-19T20:00:00.000Z',
        rounds: 4,
        releaseAt: '2026-07-01T00:00:00.000Z',
        fieldLocksAt: '2026-07-15T00:00:00.000Z',
        seasonId,
        autoLifecycleEnabled: false,
      },
    });
    expect(tournament.response?.status).toBe(201);
    const eventId = tournament.data!.tournament.id;
    created.sportEventIds.add(eventId);
    expect(tournament.data!.tournament.syncScope).toBe('NONE');

    // ensureDefaultGolfTiers + ensureSportEventRounds run inside createTournament;
    // assert the persisted result via a fresh read.
    const rounds = await adminGetGolfTournamentRounds({ client: c, path: { eventId } });
    expect(rounds.data!.rounds.length).toBe(4);
    const defaultTiers = await adminGetGolfTournamentTiers({ client: c, path: { eventId } });
    expect(defaultTiers.data!.tiers.length).toBe(6);

    // --- Seed field from the league roster; derived seeds + odds -----------
    const seed = await adminSeedGolfTournamentField({ client: c, path: { eventId } });
    expect(seed.response?.status).toBe(200);
    expect(seed.data!.added).toBe(20);
    expect(seed.data!.seedNumbersDerived).toBe(20);
    expect(seed.data!.oddsDerived).toBe(20);

    let field = await adminGetGolfTournamentField({ client: c, path: { eventId } });
    expect(field.data!.entries.length).toBe(20);
    const seeds = field.data!.entries
      .map((e) => e.seedNumber)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(new Set(seeds).size).toBe(20); // unique seed numbers
    // Odds ordering tracks rank ordering: the rank-1 golfer has the shortest odds.
    const byRank = [...field.data!.entries].sort(
      (a, b) => (a.worldRanking ?? 0) - (b.worldRanking ?? 0),
    );
    expect(byRank[0].oddsToWin!).toBeLessThanOrEqual(byRank[byRank.length - 1].oddsToWin!);

    // --- Withdraw two golfers --------------------------------------------------
    const withdraw = field.data!.entries.slice(0, 2);
    const wd = await adminUpdateGolfFieldEntries({
      client: c,
      path: { eventId },
      body: {
        entries: withdraw.map((e) => ({
          sportEventParticipantId: e.sportEventParticipantId,
          isActive: false,
          inactiveReason: 'WITHDRAWN' as const,
        })),
      },
    });
    expect(wd.response?.status).toBe(200);

    // --- 21st, non-affiliated golfer added straight to the field -----------
    const guest = await adminCreateGolfPlayer({
      client: c,
      body: { name: `${RUN} LIV Guest`, shortName: 'GUEST', nationality: 'ESP', externalId: `${RUN}-guest` },
    });
    created.participantIds.add(guest.data!.player.id);
    const bulkAdd = await adminBulkAddGolfFieldEntries({
      client: c,
      path: { eventId },
      body: { participantIds: [guest.data!.player.id] },
    });
    expect(bulkAdd.response?.status).toBe(200);
    expect(bulkAdd.data!.added).toBe(1);

    field = await adminGetGolfTournamentField({ client: c, path: { eventId } });
    const guestRow = field.data!.entries.find((e) => e.participantId === guest.data!.player.id)!;
    expect(guestRow.isLeagueRosterMember).toBe(false);
    field.data!.entries
      .filter((e) => e.participantId !== guest.data!.player.id)
      .forEach((e) => expect(e.isLeagueRosterMember).toBe(true));

    // --- Manually adjust one golfer's odds --------------------------------
    const adjust = field.data!.entries[5];
    await adminUpdateGolfFieldEntries({
      client: c,
      path: { eventId },
      body: { entries: [{ sportEventParticipantId: adjust.sportEventParticipantId, oddsToWin: 4242 }] },
    });

    // --- Reshape to 4 tiers, then auto-assign from ODDS -------------------
    const fourTiers = await adminReplaceGolfTournamentTiers({
      client: c,
      path: { eventId },
      body: {
        tiers: [1, 2, 3, 4].map((n) => ({
          tierKey: `tier-${n}`,
          label: `Tier ${n}`,
          tierNumber: n,
          defaultPickCount: 1,
        })),
        reassignOrphansTo: 'tier-1',
      },
    });
    expect(fourTiers.response?.status).toBe(200);

    const autoTiers = await adminAutoAssignGolfTiers({
      client: c,
      path: { eventId },
      body: { source: 'ODDS', tierSize: 6 },
    });
    expect(autoTiers.response?.status).toBe(200);
    const allAssigned = autoTiers.data!.tiers.flatMap((t) => t.assignments.map((a) => a.participantId));
    // The guest golfer is tiered alongside everyone else (tiering ignores roster origin).
    expect(allAssigned).toContain(guest.data!.player.id);

    // --- Auto-assign prices; tier assignment source must be untouched -----
    const tiersBeforePrices = await adminGetGolfTournamentTiers({ client: c, path: { eventId } });
    const tierKeyBySep = new Map(
      tiersBeforePrices.data!.tiers.flatMap((t) =>
        t.assignments.map((a) => [a.sportEventParticipantId, t.tierKey] as const),
      ),
    );
    const prices = await adminAutoAssignGolfPrices({
      client: c,
      path: { eventId },
      body: { minPrice: 1000, maxPrice: 10000 },
    });
    expect(prices.response?.status).toBe(200);
    const tiersAfterPrices = await adminGetGolfTournamentTiers({ client: c, path: { eventId } });
    let pricedCount = 0;
    tiersAfterPrices.data!.tiers.forEach((t) =>
      t.assignments.forEach((a) => {
        // Tier assignment is untouched by the price action (independent §4.5).
        expect(tierKeyBySep.get(a.sportEventParticipantId)).toBe(t.tierKey);
        // Every seeded golfer gets a derived price in range; the guest golfer
        // (added via bulk-add, no seedNumber) legitimately has no price yet.
        if (a.price !== null) {
          expect(a.price).toBeGreaterThanOrEqual(1000);
          expect(a.price).toBeLessThanOrEqual(10000);
          pricedCount += 1;
        }
      }),
    );
    expect(pricedCount).toBeGreaterThanOrEqual(18); // 20 seeded - 2 withdrawn

    // --- "Drag" one golfer to another tier via the assignments PUT -------
    const flat = tiersAfterPrices.data!.tiers.flatMap((t) =>
      t.assignments.map((a) => ({ sep: a.sportEventParticipantId, tierKey: t.tierKey, idx: a.tierOrderIndex ?? 0 })),
    );
    const mover = flat.find((x) => x.tierKey === 'tier-1')!;
    const desired = flat.map((x) =>
      x.sep === mover.sep
        ? { sportEventParticipantId: x.sep, tierKey: 'tier-4', tierOrderIndex: 0 }
        : { sportEventParticipantId: x.sep, tierKey: x.tierKey, tierOrderIndex: x.idx },
    );
    const replaced = await adminReplaceGolfTierAssignments({
      client: c,
      path: { eventId },
      body: { assignments: desired },
    });
    expect(replaced.response?.status).toBe(200);
    const movedInto = replaced.data!.tiers.find((t) => t.tierKey === 'tier-4')!;
    expect(movedInto.assignments.some((a) => a.sportEventParticipantId === mover.sep)).toBe(true);

    // --- Lifecycle: SCHEDULED -> IN_PROGRESS -----------------------------
    const detail = await adminGetGolfTournament({ client: c, path: { eventId } });
    expect(detail.data!.tournament.workflow.allowedTransitions).toContain('IN_PROGRESS');
    const toLive = await adminTransitionGolfTournament({
      client: c,
      path: { eventId },
      body: { toStatus: 'IN_PROGRESS' },
    });
    expect(toLive.response?.status).toBe(200);
    expect(toLive.data!.tournament.status).toBe('IN_PROGRESS');

    // --- Round-1 scores: bulk preview + apply, then a single-row correction
    const scoreRows = field.data!.entries.slice(0, 5).map((e, i) => ({
      externalId: undefined,
      playerName: e.participantName,
      strokes: 70 + i,
      scoreToPar: i - 1,
      thru: 18,
      status: 'COMPLETED' as const,
    }));
    const preview = await adminPreviewGolfRoundScores({
      client: c,
      path: { eventId, round: 1 },
      body: { rows: scoreRows },
    });
    expect(preview.response?.status).toBe(200);
    expect(preview.data!.rollup.unresolved).toBe(0);

    const applyScores = await adminApplyGolfRoundScores({
      client: c,
      path: { eventId, round: 1 },
      body: { rows: scoreRows },
    });
    expect(applyScores.response?.status).toBe(200);

    const correctSep = field.data!.entries[0].sportEventParticipantId;
    const correction = await adminUpdateGolfRoundScore({
      client: c,
      path: { eventId, round: 1, sportEventParticipantId: correctSep },
      body: { strokes: 65, status: 'COMPLETED' },
    });
    expect(correction.response?.status).toBe(200);

    // --- COMPLETE the tournament ----------------------------------------
    const toDone = await adminTransitionGolfTournament({
      client: c,
      path: { eventId },
      body: { toStatus: 'COMPLETED' },
    });
    expect(toDone.response?.status).toBe(200);
    expect(toDone.data!.tournament.status).toBe('COMPLETED');

    // --- Make the 2026 season current, then clone one year forward -------
    const setCurrent = await adminSetCurrentGolfSeason({ client: c, path: { seasonId } });
    expect(setCurrent.response?.status).toBe(200);

    // --- Clone the season one year forward (pool-master-pcd, §4.2a) -----
    const clone = await adminCloneGolfSeason({ client: c, path: { seasonId }, body: {} });
    expect(clone.response?.status).toBe(201);
    expect(clone.data!.tournamentsCloned).toBe(1);
    const newSeasonId = clone.data!.season.id;
    created.seasonIds.add(newSeasonId);
    expect(clone.data!.season.year).toBe(2027);
    expect(clone.data!.season.isCurrent).toBe(false);

    // Source season is unchanged; its league still points at it.
    const sourceAfter = await adminGetGolfSeason({ client: c, path: { seasonId } });
    expect(sourceAfter.data!.season.isCurrent).toBe(true);

    // The cloned tournament is a fresh shell: empty field, 6 default tiers, NONE.
    const clonedList = await adminListGolfTournaments({ client: c });
    const clonedEvent = clonedList.data!.tournaments.find((t) => t.seasonId === newSeasonId)!;
    expect(clonedEvent).toBeDefined();
    created.sportEventIds.add(clonedEvent.id);
    expect(clonedEvent.syncScope).toBe('NONE');
    expect(clonedEvent.fieldCount).toBe(0);
    expect(clonedEvent.tierCount).toBe(6);
    // Dates shifted exactly one calendar year.
    expect(clonedEvent.startDate.startsWith('2027-07-16')).toBe(true);

    const seasonsForLeague = await adminListGolfSeasons({
      client: c,
      query: { sportLeagueId: leagueId },
    });
    expect(seasonsForLeague.data!.seasons.map((s) => s.year).sort()).toEqual([2026, 2027]);
  }, 60_000);

  it('BR-GOLF-ADMIN-AUTHZ: every new golf-admin operation rejects a non-root-admin caller with 403', async () => {
    const member = await buildRegisteredUser({ displayName: 'Golf Non Admin' });
    created.userIds.add(member.userId);
    const c = member.client;
    const deny = { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' };

    expectFunctionalError(
      await adminCreateGolfLeague({ client: c, body: { name: `denied-${RUN}` } }),
      deny,
    );
    expectFunctionalError(
      await adminCreateGolfSeason({
        client: c,
        body: {
          sportLeagueId: 'x',
          name: 'x',
          year: 2030,
          startDate: '2030-01-01T00:00:00.000Z',
          endDate: '2030-12-01T00:00:00.000Z',
        },
      }),
      deny,
    );
    expectFunctionalError(
      await adminCloneGolfSeason({ client: c, path: { seasonId: 'x' }, body: {} }),
      deny,
    );
    expectFunctionalError(
      await adminSeedGolfTournamentField({ client: c, path: { eventId: 'x' } }),
      deny,
    );
    expectFunctionalError(
      await adminBulkAddGolfFieldEntries({ client: c, path: { eventId: 'x' }, body: { participantIds: [] } }),
      deny,
    );
    expectFunctionalError(
      await adminAutoAssignGolfTiers({ client: c, path: { eventId: 'x' }, body: { source: 'ODDS' } }),
      deny,
    );
    expectFunctionalError(
      await adminAutoAssignGolfPrices({ client: c, path: { eventId: 'x' }, body: { minPrice: 1, maxPrice: 2 } }),
      deny,
    );
    expectFunctionalError(
      await adminReplaceGolfTierAssignments({ client: c, path: { eventId: 'x' }, body: { assignments: [] } }),
      deny,
    );
    expectFunctionalError(
      await adminApplyGolfRoundScores({ client: c, path: { eventId: 'x', round: 1 }, body: { rows: [] } }),
      deny,
    );
    expectFunctionalError(
      await adminCreateGolfPlayer({ client: c, body: { name: `denied-${RUN}` } }),
      deny,
    );
  });
});

void createFunctionalEmail;
