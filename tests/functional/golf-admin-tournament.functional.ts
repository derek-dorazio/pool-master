import {
  addEventParticipants,
  applyEventGolfRoundScores,
  applyEventParticipantUpload,
  applyParticipantLeagueAffiliationUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  cloneEventYear,
  createEvent,
  createParticipant,
  createSportLeague,
  getEvent,
  getSportLeague,
  importEventYearFromProvider,
  listEventParticipants,
  listEventRounds,
  listEvents,
  listEventTiers,
  listSports,
  previewEventGolfRoundScores,
  previewEventParticipantUpload,
  releaseEvent,
  replaceEventTierAssignments,
  replaceEventTiers,
  seedEventParticipants,
  transitionEvent,
  updateEventParticipantGolfRoundScore,
  updateEventParticipants,
  updateSportLeague,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import {
  createFunctionalEmail,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';

// plans/124 §8 — pool-master-z3l. End-to-end golf-admin authoring journey through
// the generated SDK: tour -> players -> roster upload -> tournament in an event
// year -> field seed/edit/guest-add -> tiers/prices -> assignments -> lifecycle
// transitions -> round-score bulk load + correction -> set the current year ->
// clone the year (plans/147 replaced the season with the event year). Plus
// root-admin permission negatives on the new operations.
//
// UC-GOLF-ADMIN-01 (manual tournament setup), UC-GOLF-ADMIN-02 (clone a tour's event
// year calendar), BR-GOLF-ADMIN-AUTHZ (every admin-golf op requires root admin).

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
  if (created.participantIds.size) {
    const pids = [...created.participantIds];
    await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: pids } } });
    await db.participantProviderMapping.deleteMany({ where: { participantId: { in: pids } } });
  }
  if (leagueIds.length) {
    await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
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
  it('UC-GOLF-ADMIN-01/02: walks the full manual authoring journey and clones the event year forward', async () => {
    await ensureGolfSportRow();

    const admin = await buildRegisteredUser({ displayName: 'Golf Admin Pilot' });
    created.userIds.add(admin.userId);
    await promoteToRootAdmin(admin);
    const c = admin.client;
    const golfSportId = expectDefined(expectDefined((await listSports({ client: c })).data).sports.find((sport) => sport.name === 'GOLF')).id;

    // --- Sport league (tour) ------------------------------------------------------
    const league = await createSportLeague({
      client: c,
      body: { sport: 'GOLF', name: `PGA Tour ${RUN}`, matchKeyword: 'PGA' },
    });
    expect(league.response?.status).toBe(201);
    const sportLeagueId = expectDefined(league.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    expect(expectDefined(league.data).sportLeague.currentEventYear).toBeNull();

    // --- 20 participants + affiliation upload (incl. a tied ranking pair) ------
    const players: Array<{ id: string; externalId: string; rank: number }> = [];
    for (let i = 0; i < 20; i += 1) {
      const externalId = `${RUN}-p${i}`;
      const p = await createParticipant({
        client: c,
        body: { sportId: golfSportId, participantType: 'INDIVIDUAL', name: `${RUN} Player ${i}`, shortName: `P${i}`, nationality: 'USA', externalId },
      });
      expect(p.response?.status).toBe(201);
      created.participantIds.add(expectDefined(p.data).participant.id);
      // ranks 1..19 with p18 and p19 tied at 19 to exercise the tie-break
      players.push({ id: expectDefined(p.data).participant.id, externalId, rank: i >= 18 ? 19 : i + 1 });
    }

    const rosterApply = await applyParticipantLeagueAffiliationUpload({
      client: c,
      path: { sportLeagueId },
      body: { rows: players.map((p) => ({ externalId: p.externalId, ranking: p.rank })) },
    });
    expect(rosterApply.response?.status).toBe(200);
    expect(expectDefined(rosterApply.data).affiliations.length).toBe(20);

    // --- Event: seeds 4 rounds + 6 default tiers --------------------------------
    const tournament = await createEvent({
      client: c,
      body: {
        name: `The ${RUN} Open`,
        venue: 'Royal Functional',
        location: 'Testshire',
        // Far future so the release step below never meets a start that has passed.
        startDate: '2099-07-16T08:00:00.000Z',
        endDate: '2099-07-19T20:00:00.000Z',
        rounds: 4,
        sportLeagueId,
        eventYear: 2026,
        autoLifecycleEnabled: false,
      },
    });
    expect(tournament.response?.status).toBe(201);
    const eventId = expectDefined(tournament.data).event.id;
    created.sportEventIds.add(eventId);
    expect(expectDefined(tournament.data).event).toMatchObject({ syncScope: 'NONE', sportLeagueId, eventYear: 2026 });

    const rounds = await listEventRounds({ client: c, path: { eventId } });
    expect(expectDefined(rounds.data).rounds.length).toBe(4);
    const defaultTiers = await listEventTiers({ client: c, path: { eventId } });
    expect(expectDefined(defaultTiers.data).tiers.length).toBe(6);

    // --- Seed the field from the sport league; derived seeds + odds ------------
    const seed = await seedEventParticipants({ client: c, path: { eventId } });
    expect(seed.response?.status).toBe(200);
    expect(expectDefined(seed.data).added).toBe(20);
    expect(expectDefined(seed.data).seedNumbersDerived).toBe(20);
    expect(expectDefined(seed.data).oddsDerived).toBe(20);

    let field = await listEventParticipants({ client: c, path: { eventId } });
    expect(expectDefined(field.data).participants.length).toBe(20);
    expect(new Set(expectDefined(field.data).participants.map((e) => e.seedNumber)).size).toBe(20); // unique seed numbers
    // Odds ordering tracks rank ordering: the rank-1 golfer has the shortest odds.
    const byRank = [...expectDefined(field.data).participants].sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0));
    expect(expectDefined(byRank[0].oddsToWin)).toBeLessThanOrEqual(expectDefined(byRank[byRank.length - 1].oddsToWin));

    // --- Withdraw two golfers ---------------------------------------------------
    const wd = await updateEventParticipants({
      client: c,
      path: { eventId },
      body: {
        participants: expectDefined(field.data).participants.slice(0, 2).map((e) => ({
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
    const guestId = expectDefined(guest.data).participant.id;
    created.participantIds.add(guestId);
    const bulkAdd = await addEventParticipants({ client: c, path: { eventId }, body: { participantIds: [guestId] } });
    expect(bulkAdd.response?.status).toBe(200);
    expect(expectDefined(bulkAdd.data).added).toBe(1);

    field = await listEventParticipants({ client: c, path: { eventId } });
    expect(expectDefined(expectDefined(field.data).participants.find((e) => e.participantId === guestId)).affiliatedWithSportLeague).toBe(false);
    expectDefined(field.data).participants
      .filter((e) => e.participantId !== guestId)
      .forEach((e) => expect(e.affiliatedWithSportLeague).toBe(true));

    // --- Manually adjust one golfer's odds --------------------------------------
    await updateEventParticipants({
      client: c,
      path: { eventId },
      body: { participants: [{ sportEventParticipantId: expectDefined(field.data).participants[5].id, oddsToWin: 4242 }] },
    });

    // --- A ranking or seed past a 32-bit integer is a 400, never a 500 -----------
    const oversized = 2 ** 31;
    const oversizedTarget = expectDefined(field.data).participants[5];
    expectFunctionalError(
      await updateEventParticipants({
        client: c,
        path: { eventId },
        body: { participants: [{ sportEventParticipantId: oversizedTarget.id, ranking: oversized }] },
      }),
      { status: 400, code: 'FST_ERR_VALIDATION' },
    );
    expectFunctionalError(
      await previewEventParticipantUpload({
        client: c,
        path: { eventId },
        body: { rows: [{ participantId: oversizedTarget.participantId, seedNumber: oversized }] },
      }),
      { status: 400, code: 'FST_ERR_VALIDATION' },
    );

    // --- Bulk-adjust the field: preview, a refused apply, then apply -------------
    // The upload only adjusts golfers already on the field; one it cannot find blocks the apply.
    const [upA, upB] = expectDefined(field.data).participants.slice(6, 8);
    const uploadRows = [
      { participantId: upA.participantId, ranking: 1, oddsToWin: 3.5 },
      { playerName: upB.participant.name.toUpperCase(), ranking: null },
    ];
    const uploadPreview = await previewEventParticipantUpload({
      client: c,
      path: { eventId },
      body: { rows: [...uploadRows, { externalId: `${RUN}-not-on-field`, ranking: 2 }] },
    });
    expect(uploadPreview.response?.status).toBe(200);
    expect(expectDefined(uploadPreview.data).rollup).toMatchObject({ total: 3, matched: 2, unresolved: 1, update: 2 });
    expect(expectDefined(uploadPreview.data).rows[1]).toMatchObject({ sportEventParticipantId: upB.id, after: { ranking: null } });
    expect(expectDefined(uploadPreview.data).rows[2].message).toMatch(/refresh the field from the provider first/);

    expectFunctionalError(
      await applyEventParticipantUpload({ client: c, path: { eventId }, body: { rows: [...uploadRows, { externalId: `${RUN}-not-on-field`, ranking: 2 }] } }),
      { status: 422, code: 'EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED' },
    );
    const unchangedField = await listEventParticipants({ client: c, path: { eventId } });
    expect(expectDefined(expectDefined(unchangedField.data).participants.find((e) => e.id === upA.id)).ranking).toBe(upA.ranking);

    const uploaded = await applyEventParticipantUpload({ client: c, path: { eventId }, body: { rows: uploadRows } });
    expect(uploaded.response?.status).toBe(200);
    expect(expectDefined(uploaded.data).participants).toHaveLength(expectDefined(field.data).participants.length);
    expect(expectDefined(uploaded.data).participants.find((e) => e.id === upA.id)).toMatchObject({ ranking: 1, oddsToWin: 3.5 });
    expect(expectDefined(expectDefined(uploaded.data).participants.find((e) => e.id === upB.id)).ranking).toBeNull();

    expectFunctionalError(
      await previewEventParticipantUpload({ client: c, path: { eventId: ANY_UUID }, body: { rows: uploadRows } }),
      { status: 404, code: 'EVENT_NOT_FOUND' },
    );

    // --- Reshape to 4 tiers, then auto-assign from ODDS -------------------------
    const fourTiers = await replaceEventTiers({
      client: c,
      path: { eventId },
      body: {
        tiers: [1, 2, 3, 4].map((n) => ({ tierKey: `tier-${n}`, label: `Tier ${n}`, tierNumber: n })),
        reassignOrphansTo: 'tier-1',
      },
    });
    expect(fourTiers.response?.status).toBe(200);
    const tierKeyById = new Map(expectDefined(fourTiers.data).tiers.map((tier) => [tier.id, tier.tierKey]));

    const autoTiers = await autoAssignEventTiers({ client: c, path: { eventId }, body: { source: 'ODDS', tierSize: 6 } });
    expect(autoTiers.response?.status).toBe(200);
    // The guest golfer is tiered alongside everyone else (tiering ignores affiliation).
    const guestAfterTiering = expectDefined(expectDefined(autoTiers.data).participants.find((e) => e.participantId === guestId));
    expect(guestAfterTiering.valuation?.sportEventTierId).not.toBeNull();

    // --- Auto-assign prices; tier placement must be untouched ------------------
    const tierKeyBySep = new Map(expectDefined(autoTiers.data).participants.map((e) => [e.id, tierKeyById.get(e.valuation?.sportEventTierId ?? '')]));
    const prices = await autoAssignEventPrices({ client: c, path: { eventId }, body: standardEventPricing() });
    expect(prices.response?.status).toBe(200);
    let pricedCount = 0;
    expectDefined(prices.data).participants.forEach((e) => {
      expect(tierKeyById.get(e.valuation?.sportEventTierId ?? '')).toBe(tierKeyBySep.get(e.id));
      // Every active golfer, the unseeded guest included, gets a price between the Standard
      // profile's floor and top shares of its $50,000 cap (#93).
      if (e.valuation?.price != null) {
        expect(e.valuation.price).toBeGreaterThanOrEqual(6000);
        expect(e.valuation.price).toBeLessThanOrEqual(12000);
        pricedCount += 1;
      }
    });
    expect(pricedCount).toBe(expectDefined(prices.data).participants.filter((e) => e.isActive).length);
    const pricedEvent = await getEvent({ client: c, path: { eventId } });
    expect(expectDefined(pricedEvent.data).event.pricing).toEqual(standardEventPricing());

    // --- "Drag" one golfer to another tier via the assignments PUT --------------
    const placed = expectDefined(prices.data).participants.filter((e) => e.valuation?.sportEventTierId);
    const mover = expectDefined(placed.find((e) => tierKeyById.get(expectDefined(expectDefined(e.valuation).sportEventTierId)) === 'tier-1'));
    const replaced = await replaceEventTierAssignments({
      client: c,
      path: { eventId },
      body: {
        assignments: placed.map((e) => (e.id === mover.id
          ? { sportEventParticipantId: e.id, tierKey: 'tier-4', tierOrderIndex: 0 }
          : { sportEventParticipantId: e.id, tierKey: expectDefined(tierKeyById.get(expectDefined(expectDefined(e.valuation).sportEventTierId))), tierOrderIndex: expectDefined(e.valuation).tierOrderIndex ?? 0 })),
      },
    });
    expect(replaced.response?.status).toBe(200);
    const moved = expectDefined(expectDefined(replaced.data).participants.find((e) => e.id === mover.id));
    expect(tierKeyById.get(expectDefined(expectDefined(moved.valuation).sportEventTierId))).toBe('tier-4');

    // --- Release for contests (#431): DRAFT -> SCHEDULED, then the tiers lock ---
    expectFunctionalError(
      await transitionEvent({ client: c, path: { eventId }, body: { toStatus: 'SCHEDULED' } }),
      { status: 409, code: 'SPORT_EVENT_RELEASE_REQUIRED' },
    );
    const released = await releaseEvent({ client: c, path: { eventId } });
    expect(released.response?.status).toBe(200);
    expect(expectDefined(released.data).event.status).toBe('SCHEDULED');
    expectFunctionalError(
      await autoAssignEventTiers({ client: c, path: { eventId }, body: { source: 'ODDS', tierSize: 6 } }),
      { status: 409, code: 'SPORT_EVENT_TIERS_LOCKED' },
    );

    // --- Lifecycle: SCHEDULED -> IN_PROGRESS ------------------------------------
    const detail = await getEvent({ client: c, path: { eventId } });
    expect(expectDefined(detail.data).event.allowedTransitions).toContain('IN_PROGRESS');
    const toLive = await transitionEvent({ client: c, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } });
    expect(toLive.response?.status).toBe(200);
    expect(expectDefined(toLive.data).event.status).toBe('IN_PROGRESS');

    // --- Round-1 scores: bulk preview + apply, then a single-row correction -----
    const scoreRows = expectDefined(field.data).participants.slice(0, 5).map((e, i) => ({
      playerName: e.participant.name,
      strokes: 70 + i,
      scoreToPar: i - 1,
      thru: 18,
      status: 'COMPLETED' as const,
    }));
    const preview = await previewEventGolfRoundScores({ client: c, path: { eventId, roundNumber: 1 }, body: { rows: scoreRows } });
    expect(preview.response?.status).toBe(200);
    expect(expectDefined(preview.data).rollup.unresolved).toBe(0);

    const applyScores = await applyEventGolfRoundScores({ client: c, path: { eventId, roundNumber: 1 }, body: { rows: scoreRows } });
    expect(applyScores.response?.status).toBe(200);
    const scored = expectDefined(expectDefined(applyScores.data).participants.find((e) => e.id === expectDefined(field.data).participants[0].id));
    expect(scored.rounds[0].golf).toMatchObject({ strokes: 70, scoreToPar: -1 });
    expect(scored.standing?.golf).toMatchObject({ eventScoreToPar: -1 });

    const correction = await updateEventParticipantGolfRoundScore({
      client: c,
      path: { eventId, roundNumber: 1, sportEventParticipantId: expectDefined(field.data).participants[0].id },
      body: { strokes: 65, status: 'COMPLETED' },
    });
    expect(correction.response?.status).toBe(200);
    expect(expectDefined(correction.data).participant.rounds[0].golf).toMatchObject({ strokes: 65, scoreToPar: -1 });

    // --- COMPLETE the event -----------------------------------------------------
    const toDone = await transitionEvent({ client: c, path: { eventId }, body: { toStatus: 'COMPLETED' } });
    expect(toDone.response?.status).toBe(200);
    expect(expectDefined(toDone.data).event.status).toBe('COMPLETED');

    // --- Set the current year: refused for a year with no events (plans/147 decision 6) ---
    const noEvents = await updateSportLeague({ client: c, path: { sportLeagueId }, body: { currentEventYear: 1823 } });
    expectFunctionalError(noEvents, { status: 422, code: 'EVENT_YEAR_HAS_NO_EVENTS' });
    const unchanged = await getSportLeague({ client: c, path: { sportLeagueId } });
    expect(expectDefined(unchanged.data).sportLeague.currentEventYear).toBeNull();

    const setCurrent = await updateSportLeague({ client: c, path: { sportLeagueId }, body: { currentEventYear: 2026 } });
    expect(setCurrent.response?.status).toBe(200);
    expect(expectDefined(setCurrent.data).sportLeague.currentEventYear).toBe(2026);

    // --- Clone the 2026 calendar one year forward -------------------------------------
    const clone = await cloneEventYear({ client: c, body: { sportLeagueId, eventYear: 2026 } });
    expect(clone.response?.status).toBe(201);
    expect(expectDefined(clone.data).events).toHaveLength(1);
    const [clonedEvent] = expectDefined(clone.data).events;
    created.sportEventIds.add(clonedEvent.id);
    // Next year's edition of the same series: a fresh event — empty field, 6 default
    // tiers, no provider data — with its dates shifted exactly one calendar year.
    expect(clonedEvent).toMatchObject({
      eventYear: 2027,
      eventSeriesId: expectDefined(tournament.data).event.eventSeriesId,
      sportLeagueId,
      syncScope: 'NONE',
      loadedParticipantCount: 0,
      tierCount: 6,
    });
    expect(clonedEvent.startDate.startsWith('2100-07-16')).toBe(true);

    // The current year is unchanged by the clone.
    const leagueAfter = await getSportLeague({ client: c, path: { sportLeagueId } });
    expect(expectDefined(leagueAfter.data).sportLeague).toMatchObject({ currentEventYear: 2026, sportEventCount: 2 });

    // A second clone into a year that now has events is refused whole.
    expectFunctionalError(
      await cloneEventYear({ client: c, body: { sportLeagueId, eventYear: 2026 } }),
      { status: 409, code: 'EVENT_YEAR_NOT_EMPTY' },
    );

    const leagueEvents = await listEvents({ client: c, query: { sportLeagueId } });
    expect(expectDefined(leagueEvents.data).events.map((event) => event.eventYear).sort((a, b) => a - b)).toEqual([2026, 2027]);
  }, 60_000);

  // plans/147 decision 5 — @@unique([eventSeriesId, eventYear]): there is one 2026 edition of
  // a series. Driven through createEvent, so it proves the constraint reaches the caller as a
  // 409 rather than a 500, and that the same series in another year is still allowed.
  it('BR-EVENT-EDITION-UNIQUE: refuses a second edition of a series in one year with 409 EVENT_EDITION_ALREADY_EXISTS', async () => {
    await ensureGolfSportRow();
    const admin = await buildRegisteredUser({ displayName: 'Golf Admin Editions' });
    created.userIds.add(admin.userId);
    await promoteToRootAdmin(admin);
    const c = admin.client;
    const league = await createSportLeague({ client: c, body: { sport: 'GOLF', name: `Editions Tour ${RUN}` } });
    const sportLeagueId = expectDefined(league.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);
    const edition = (eventYear: number) => createEvent({
      client: c,
      body: {
        sportLeagueId,
        eventYear,
        name: `The ${RUN} Masters`,
        startDate: `${eventYear}-04-09T12:00:00.000Z`,
      },
    });

    const first = await edition(2026);
    expect(first.response?.status).toBe(201);
    created.sportEventIds.add(expectDefined(first.data).event.id);

    expectFunctionalError(await edition(2026), { status: 409, code: 'EVENT_EDITION_ALREADY_EXISTS' });

    const nextYear = await edition(2027);
    expect(nextYear.response?.status).toBe(201);
    created.sportEventIds.add(expectDefined(nextYear.data).event.id);
    expect(expectDefined(nextYear.data).event.eventSeriesId).toBe(expectDefined(first.data).event.eventSeriesId);

    const editions = await listEvents({ client: c, query: { sportLeagueId } });
    expect(expectDefined(editions.data).events.map((event) => event.eventYear).sort((a, b) => a - b)).toEqual([2026, 2027]);
  });

  // #385 — a tour's year imported from the FAPI daemon's real mock provider, whose tour seeds
  // (#383) carry PGA TOUR and LPGA Tour slates. The match is the provider's tour name, so an
  // "LPGA Tour" league gets only LPGA events, and a second run creates nothing.
  it('imports a tour\'s year from the provider as linked events, only that tour\'s, and skips them all on a second run', async () => {
    await ensureGolfSportRow();
    const admin = await buildRegisteredUser({ displayName: 'Golf Admin Import' });
    created.userIds.add(admin.userId);
    await promoteToRootAdmin(admin);
    const c = admin.client;
    const league = await createSportLeague({ client: c, body: { sport: 'GOLF', name: `Import Tour ${RUN}`, matchKeyword: 'LPGA Tour' } });
    const sportLeagueId = expectDefined(league.data).sportLeague.id;
    created.sportLeagueIds.add(sportLeagueId);

    const first = await importEventYearFromProvider({ client: c, body: { sportLeagueId, eventYear: 2027, providerId: 'mock-contest-feed' } });
    expect(first.response?.status).toBe(201);
    const imported = expectDefined(first.data).created;
    imported.forEach((event) => created.sportEventIds.add(event.id));
    expect(expectDefined(first.data).skipped).toEqual([]);
    expect(imported.length).toBeGreaterThan(20);
    for (const event of imported) {
      expect(event).toMatchObject({ sportLeagueId, eventYear: 2027, providerId: 'mock-contest-feed', syncScope: 'SCORES_ONLY', loadedParticipantCount: 0 });
      expect(event.externalId.startsWith('lpga-tour-2027-')).toBe(true);
    }

    const again = await importEventYearFromProvider({ client: c, body: { sportLeagueId, eventYear: 2027, providerId: 'mock-contest-feed' } });
    expect(again.response?.status).toBe(201);
    expect(expectDefined(again.data).created).toEqual([]);
    expect(expectDefined(again.data).skipped).toHaveLength(imported.length);
    expect(new Set(expectDefined(again.data).skipped.map((row) => row.reason))).toEqual(new Set(['ALREADY_LINKED']));

    const noKeyword = await createSportLeague({ client: c, body: { sport: 'GOLF', name: `No Keyword Tour ${RUN}` } });
    created.sportLeagueIds.add(expectDefined(noKeyword.data).sportLeague.id);
    expectFunctionalError(
      await importEventYearFromProvider({ client: c, body: { sportLeagueId: expectDefined(noKeyword.data).sportLeague.id, eventYear: 2027, providerId: 'mock-contest-feed' } }),
      { status: 422, code: 'SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD' },
    );
  }, 60_000);

  it('BR-GOLF-ADMIN-AUTHZ: every golf administration write rejects a non-root-admin caller with 403, before validating its input', async () => {
    const member = await buildRegisteredUser({ displayName: 'Golf Non Admin' });
    created.userIds.add(member.userId);
    const c = member.client;
    const deny = { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' };

    // Deliberately malformed ids and bodies: the refusal must not depend on — or reveal — the input's shape.
    expectFunctionalError(await createSportLeague({ client: c, body: { sport: 'GOLF', name: `denied-${RUN}` } }), deny);
    expectFunctionalError(await updateSportLeague({ client: c, path: { sportLeagueId: 'x' }, body: { currentEventYear: 2030 } }), deny);
    expectFunctionalError(await cloneEventYear({ client: c, body: { sportLeagueId: 'x', eventYear: 2030 } }), deny);
    expectFunctionalError(await importEventYearFromProvider({ client: c, body: { sportLeagueId: 'x', eventYear: 2030, providerId: 'x' } }), deny);
    expectFunctionalError(await seedEventParticipants({ client: c, path: { eventId: 'x' } }), deny);
    expectFunctionalError(await addEventParticipants({ client: c, path: { eventId: 'x' }, body: { participantIds: [] } }), deny);
    expectFunctionalError(await autoAssignEventTiers({ client: c, path: { eventId: 'x' }, body: { source: 'ODDS' } }), deny);
    expectFunctionalError(await autoAssignEventPrices({ client: c, path: { eventId: 'x' }, body: standardEventPricing() }), deny);
    expectFunctionalError(await replaceEventTierAssignments({ client: c, path: { eventId: 'x' }, body: { assignments: [] } }), deny);
    expectFunctionalError(await applyEventGolfRoundScores({ client: c, path: { eventId: 'x', roundNumber: 1 }, body: { rows: [] } }), deny);
    expectFunctionalError(await previewEventParticipantUpload({ client: c, path: { eventId: 'x' }, body: { rows: [] } }), deny);
    expectFunctionalError(await applyEventParticipantUpload({ client: c, path: { eventId: 'x' }, body: { rows: [] } }), deny);
    expectFunctionalError(await updateEventParticipantGolfRoundScore({ client: c, path: { eventId: 'x', roundNumber: 1, sportEventParticipantId: 'x' }, body: { strokes: 70 } }), deny);
    expectFunctionalError(await createEvent({
      client: c,
      body: { sportLeagueId: ANY_UUID, eventYear: 2030, name: 'x', startDate: '2030-01-01T00:00:00.000Z' },
    }), deny);
    expectFunctionalError(await createParticipant({ client: c, body: { sportId: ANY_UUID, participantType: 'INDIVIDUAL', name: `denied-${RUN}` } }), deny);
  });
});

void createFunctionalEmail;
