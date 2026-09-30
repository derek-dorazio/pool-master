import {
  addEventParticipants,
  applyEventGolfRoundScores,
  applyParticipantLeagueAffiliationUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  cloneSeason,
  createEvent,
  createParticipant,
  createSeason,
  createSportLeague,
  getEvent,
  getSeason,
  listEventParticipants,
  listEventRounds,
  listEvents,
  listEventTiers,
  listSeasons,
  listSports,
  previewEventGolfRoundScores,
  replaceEventTierAssignments,
  replaceEventTiers,
  seedEventParticipants,
  setCurrentSeason,
  transitionEvent,
  updateEventParticipantGolfRoundScore,
  updateEventParticipants,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
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
    await db.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: { sportEventParticipantId: { in: sepIds } } } });
    await db.sportEventParticipantRound.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipantGolfStanding.deleteMany({ where: { standing: { sportEventParticipantId: { in: sepIds } } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
    await db.sportEventParticipant.deleteMany({ where: { id: { in: sepIds } } });
  }
  if (eventIds.length) {
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
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
    await db.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
    await db.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  }
}

afterAll(async () => {
  await cleanup();
  await disconnectFunctionalPrisma();
});

const ANY_UUID = '00000000-0000-4000-8000-000000000000';

describe('SDK Functional: Golf tournament admin (pool-master-z3l, plans/124 §8; operations per #236)', () => {
  it('UC-GOLF-ADMIN-01/02: walks the full manual authoring journey and clones the season forward', async () => {
    await ensureGolfSportRow();

    const admin = await buildRegisteredUser({ displayName: 'Golf Admin Pilot' });
    created.userIds.add(admin.userId);
    await promoteToRootAdmin(admin);
    const c = admin.client;
    const golfSportId = (await listSports({ client: c })).data!.sports.find((sport) => sport.name === 'GOLF')!.id;

    // --- Sport league (tour) + season -------------------------------------------
    const league = await createSportLeague({
      client: c,
      body: { sport: 'GOLF', name: `PGA Tour ${RUN}`, matchKeyword: 'PGA' },
    });
    expect(league.response?.status).toBe(201);
    const sportLeagueId = league.data!.sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);

    const season = await createSeason({
      client: c,
      path: { sportLeagueId },
      body: {
        name: `PGA Tour ${RUN} 2026`,
        year: 2026,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-11-30T00:00:00.000Z',
      },
    });
    expect(season.response?.status).toBe(201);
    const seasonId = season.data!.season.id;
    created.seasonIds.add(seasonId);

    // --- 20 participants + affiliation upload (incl. a tied ranking pair) ------
    const players: Array<{ id: string; externalId: string; rank: number }> = [];
    for (let i = 0; i < 20; i += 1) {
      const externalId = `${RUN}-p${i}`;
      const p = await createParticipant({
        client: c,
        body: { sportId: golfSportId, participantType: 'INDIVIDUAL', name: `${RUN} Player ${i}`, shortName: `P${i}`, nationality: 'USA', externalId },
      });
      expect(p.response?.status).toBe(201);
      created.participantIds.add(p.data!.participant.id);
      // ranks 1..19 with p18 and p19 tied at 19 to exercise the tie-break
      players.push({ id: p.data!.participant.id, externalId, rank: i >= 18 ? 19 : i + 1 });
    }

    const rosterApply = await applyParticipantLeagueAffiliationUpload({
      client: c,
      path: { sportLeagueId },
      body: { rows: players.map((p) => ({ externalId: p.externalId, ranking: p.rank })) },
    });
    expect(rosterApply.response?.status).toBe(200);
    expect(rosterApply.data!.affiliations.length).toBe(20);

    // --- Event: seeds 4 rounds + 6 default tiers --------------------------------
    const tournament = await createEvent({
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
    const eventId = tournament.data!.event.id;
    created.sportEventIds.add(eventId);
    expect(tournament.data!.event.syncScope).toBe('NONE');

    const rounds = await listEventRounds({ client: c, path: { eventId } });
    expect(rounds.data!.rounds.length).toBe(4);
    const defaultTiers = await listEventTiers({ client: c, path: { eventId } });
    expect(defaultTiers.data!.tiers.length).toBe(6);

    // --- Seed the field from the sport league; derived seeds + odds ------------
    const seed = await seedEventParticipants({ client: c, path: { eventId } });
    expect(seed.response?.status).toBe(200);
    expect(seed.data!.added).toBe(20);
    expect(seed.data!.seedNumbersDerived).toBe(20);
    expect(seed.data!.oddsDerived).toBe(20);

    let field = await listEventParticipants({ client: c, path: { eventId } });
    expect(field.data!.participants.length).toBe(20);
    expect(new Set(field.data!.participants.map((e) => e.seedNumber)).size).toBe(20); // unique seed numbers
    // Odds ordering tracks rank ordering: the rank-1 golfer has the shortest odds.
    const byRank = [...field.data!.participants].sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0));
    expect(byRank[0].oddsToWin!).toBeLessThanOrEqual(byRank[byRank.length - 1].oddsToWin!);

    // --- Withdraw two golfers ---------------------------------------------------
    const wd = await updateEventParticipants({
      client: c,
      path: { eventId },
      body: {
        participants: field.data!.participants.slice(0, 2).map((e) => ({
          sportEventParticipantId: e.id,
          isActive: false,
          inactiveReason: 'WITHDRAWN' as const,
        })),
      },
    });
    expect(wd.response?.status).toBe(200);

    // --- 21st, non-affiliated participant added straight to the field ----------
    const guest = await createParticipant({
      client: c,
      body: { sportId: golfSportId, participantType: 'INDIVIDUAL', name: `${RUN} LIV Guest`, shortName: 'GUEST', nationality: 'ESP', externalId: `${RUN}-guest` },
    });
    const guestId = guest.data!.participant.id;
    created.participantIds.add(guestId);
    const bulkAdd = await addEventParticipants({ client: c, path: { eventId }, body: { participantIds: [guestId] } });
    expect(bulkAdd.response?.status).toBe(200);
    expect(bulkAdd.data!.added).toBe(1);

    field = await listEventParticipants({ client: c, path: { eventId } });
    expect(field.data!.participants.find((e) => e.participantId === guestId)!.affiliatedWithSportLeague).toBe(false);
    field.data!.participants
      .filter((e) => e.participantId !== guestId)
      .forEach((e) => expect(e.affiliatedWithSportLeague).toBe(true));

    // --- Manually adjust one golfer's odds --------------------------------------
    await updateEventParticipants({
      client: c,
      path: { eventId },
      body: { participants: [{ sportEventParticipantId: field.data!.participants[5].id, oddsToWin: 4242 }] },
    });

    // --- Reshape to 4 tiers, then auto-assign from ODDS -------------------------
    const fourTiers = await replaceEventTiers({
      client: c,
      path: { eventId },
      body: {
        tiers: [1, 2, 3, 4].map((n) => ({ tierKey: `tier-${n}`, label: `Tier ${n}`, tierNumber: n, defaultPickCount: 1 })),
        reassignOrphansTo: 'tier-1',
      },
    });
    expect(fourTiers.response?.status).toBe(200);
    const tierKeyById = new Map(fourTiers.data!.tiers.map((tier) => [tier.id, tier.tierKey]));

    const autoTiers = await autoAssignEventTiers({ client: c, path: { eventId }, body: { source: 'ODDS', tierSize: 6 } });
    expect(autoTiers.response?.status).toBe(200);
    // The guest golfer is tiered alongside everyone else (tiering ignores affiliation).
    const guestAfterTiering = autoTiers.data!.participants.find((e) => e.participantId === guestId)!;
    expect(guestAfterTiering.valuation?.sportEventTierId).not.toBeNull();

    // --- Auto-assign prices; tier placement must be untouched ------------------
    const tierKeyBySep = new Map(autoTiers.data!.participants.map((e) => [e.id, tierKeyById.get(e.valuation?.sportEventTierId ?? '')]));
    const prices = await autoAssignEventPrices({ client: c, path: { eventId }, body: { minPrice: 1000, maxPrice: 10000 } });
    expect(prices.response?.status).toBe(200);
    let pricedCount = 0;
    prices.data!.participants.forEach((e) => {
      expect(tierKeyById.get(e.valuation?.sportEventTierId ?? '')).toBe(tierKeyBySep.get(e.id));
      // Every seeded, active golfer gets a price in range; the guest (no seed) has none yet.
      if (e.valuation?.price != null) {
        expect(e.valuation.price).toBeGreaterThanOrEqual(1000);
        expect(e.valuation.price).toBeLessThanOrEqual(10000);
        pricedCount += 1;
      }
    });
    expect(pricedCount).toBeGreaterThanOrEqual(18); // 20 seeded - 2 withdrawn

    // --- "Drag" one golfer to another tier via the assignments PUT --------------
    const placed = prices.data!.participants.filter((e) => e.valuation?.sportEventTierId);
    const mover = placed.find((e) => tierKeyById.get(e.valuation!.sportEventTierId!) === 'tier-1')!;
    const replaced = await replaceEventTierAssignments({
      client: c,
      path: { eventId },
      body: {
        assignments: placed.map((e) => (e.id === mover.id
          ? { sportEventParticipantId: e.id, tierKey: 'tier-4', tierOrderIndex: 0 }
          : { sportEventParticipantId: e.id, tierKey: tierKeyById.get(e.valuation!.sportEventTierId!)!, tierOrderIndex: e.valuation!.tierOrderIndex ?? 0 })),
      },
    });
    expect(replaced.response?.status).toBe(200);
    const moved = replaced.data!.participants.find((e) => e.id === mover.id)!;
    expect(tierKeyById.get(moved.valuation!.sportEventTierId!)).toBe('tier-4');

    // --- Lifecycle: SCHEDULED -> IN_PROGRESS ------------------------------------
    const detail = await getEvent({ client: c, path: { eventId } });
    expect(detail.data!.event.allowedTransitions).toContain('IN_PROGRESS');
    const toLive = await transitionEvent({ client: c, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } });
    expect(toLive.response?.status).toBe(200);
    expect(toLive.data!.event.status).toBe('IN_PROGRESS');

    // --- Round-1 scores: bulk preview + apply, then a single-row correction -----
    const scoreRows = field.data!.participants.slice(0, 5).map((e, i) => ({
      playerName: e.participant.name,
      strokes: 70 + i,
      scoreToPar: i - 1,
      thru: 18,
      status: 'COMPLETED' as const,
    }));
    const preview = await previewEventGolfRoundScores({ client: c, path: { eventId, roundNumber: 1 }, body: { rows: scoreRows } });
    expect(preview.response?.status).toBe(200);
    expect(preview.data!.rollup.unresolved).toBe(0);

    const applyScores = await applyEventGolfRoundScores({ client: c, path: { eventId, roundNumber: 1 }, body: { rows: scoreRows } });
    expect(applyScores.response?.status).toBe(200);
    const scored = applyScores.data!.participants.find((e) => e.id === field.data!.participants[0].id)!;
    expect(scored.rounds[0].golf).toMatchObject({ strokes: 70, scoreToPar: -1 });
    expect(scored.standing?.golf).toMatchObject({ eventScoreToPar: -1 });

    const correction = await updateEventParticipantGolfRoundScore({
      client: c,
      path: { eventId, roundNumber: 1, sportEventParticipantId: field.data!.participants[0].id },
      body: { strokes: 65, status: 'COMPLETED' },
    });
    expect(correction.response?.status).toBe(200);
    expect(correction.data!.participant.rounds[0].golf).toMatchObject({ strokes: 65, scoreToPar: -1 });

    // --- COMPLETE the event -----------------------------------------------------
    const toDone = await transitionEvent({ client: c, path: { eventId }, body: { toStatus: 'COMPLETED' } });
    expect(toDone.response?.status).toBe(200);
    expect(toDone.data!.event.status).toBe('COMPLETED');

    // --- Make the 2026 season current, then clone one year forward ---------------
    const setCurrent = await setCurrentSeason({ client: c, path: { seasonId } });
    expect(setCurrent.response?.status).toBe(200);
    expect(setCurrent.data!.sportLeague.currentSeasonId).toBe(seasonId);

    const clone = await cloneSeason({ client: c, path: { seasonId }, body: {} });
    expect(clone.response?.status).toBe(201);
    expect(clone.data!.clonedEventCount).toBe(1);
    const newSeasonId = clone.data!.season.id;
    created.seasonIds.add(newSeasonId);
    expect(clone.data!.season.year).toBe(2027);
    expect(clone.data!.season.isCurrent).toBe(false);

    // Source season is unchanged; its sport league still points at it.
    const sourceAfter = await getSeason({ client: c, path: { seasonId } });
    expect(sourceAfter.data!.season.isCurrent).toBe(true);

    // The cloned event is a fresh one: empty field, 6 default tiers, no provider data.
    const clonedList = await listEvents({ client: c, query: { seasonId: newSeasonId } });
    const [clonedEvent] = clonedList.data!.events;
    expect(clonedEvent).toBeDefined();
    created.sportEventIds.add(clonedEvent.id);
    expect(clonedEvent.syncScope).toBe('NONE');
    expect(clonedEvent.loadedParticipantCount).toBe(0);
    expect(clonedEvent.tierCount).toBe(6);
    // Dates shifted exactly one calendar year.
    expect(clonedEvent.startDate.startsWith('2027-07-16')).toBe(true);

    const seasonsForLeague = await listSeasons({ client: c, path: { sportLeagueId } });
    expect(seasonsForLeague.data!.seasons.map((s) => s.year).sort()).toEqual([2026, 2027]);
  }, 60_000);

  it('BR-GOLF-ADMIN-AUTHZ: every golf administration write rejects a non-root-admin caller with 403, before validating its input', async () => {
    const member = await buildRegisteredUser({ displayName: 'Golf Non Admin' });
    created.userIds.add(member.userId);
    const c = member.client;
    const deny = { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' };

    // Deliberately malformed ids and bodies: the refusal must not depend on — or reveal — the input's shape.
    expectFunctionalError(await createSportLeague({ client: c, body: { sport: 'GOLF', name: `denied-${RUN}` } }), deny);
    expectFunctionalError(
      await createSeason({
        client: c,
        path: { sportLeagueId: 'x' },
        body: { name: 'x', year: 2030, startDate: '2030-01-01T00:00:00.000Z', endDate: '2030-12-01T00:00:00.000Z' },
      }),
      deny,
    );
    expectFunctionalError(await cloneSeason({ client: c, path: { seasonId: 'x' }, body: {} }), deny);
    expectFunctionalError(await seedEventParticipants({ client: c, path: { eventId: 'x' } }), deny);
    expectFunctionalError(await addEventParticipants({ client: c, path: { eventId: 'x' }, body: { participantIds: [] } }), deny);
    expectFunctionalError(await autoAssignEventTiers({ client: c, path: { eventId: 'x' }, body: { source: 'ODDS' } }), deny);
    expectFunctionalError(await autoAssignEventPrices({ client: c, path: { eventId: 'x' }, body: { minPrice: 1, maxPrice: 2 } }), deny);
    expectFunctionalError(await replaceEventTierAssignments({ client: c, path: { eventId: 'x' }, body: { assignments: [] } }), deny);
    expectFunctionalError(await applyEventGolfRoundScores({ client: c, path: { eventId: 'x', roundNumber: 1 }, body: { rows: [] } }), deny);
    expectFunctionalError(await createEvent({
      client: c,
      body: { seasonId: ANY_UUID, name: 'x', startDate: '2030-01-01T00:00:00.000Z', releaseAt: '2030-01-01T00:00:00.000Z', fieldLocksAt: '2030-01-01T00:00:00.000Z' },
    }), deny);
    expectFunctionalError(await createParticipant({ client: c, body: { sportId: ANY_UUID, participantType: 'INDIVIDUAL', name: `denied-${RUN}` } }), deny);
  });
});

void createFunctionalEmail;
