/**
 * The sport event route handlers (#1482), called with stand-in services: who may read drafts and
 * the root admin's counts, the dates a body's ISO strings become, what each write answers with,
 * and the status each provider sync refusal is sent with.
 */
import { expect } from '@jest/globals';
import { SportEventStatus, SportEventSyncScope, type SportEvent } from '@poolmaster/shared/domain';
import type { EventLifecycleService } from '../../../packages/core-api/src/modules/events/event-lifecycle-service';
import type { EventScoreSourceService } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { createEventHandlers } from '../../../packages/core-api/src/modules/events/handler';
import type { SportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import {
  SportEventSyncScopeError,
  SportProviderNotFoundError,
  SportSyncNotConfiguredError,
  type IngestionService,
} from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const AT = new Date('2026-04-09T12:00:00.000Z');
const ISO = AT.toISOString();
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const boom = new Error('feed down');
const admin = authUser('admin', { isRootAdmin: true, email: 'admin@example.test' });
const member = authUser('member');

function sportEvent(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: EVENT_ID,
    externalId: 'masters-2026',
    providerId: 'feed',
    sport: 'GOLF',
    name: 'The Masters',
    status: 'SCHEDULED',
    startDate: new Date('2999-04-09T12:00:00.000Z'),
    participantCount: 88,
    metadata: {},
    eventSeriesId: 'series-1',
    eventYear: 2026,
    sportLeagueId: 'pga',
    syncScope: 'SCORES_ONLY',
    autoLifecycleEnabled: true,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}
const summary = { event: sportEvent(), loadedParticipantCount: 88, tierCount: 0, adminCounts: null };
const fieldRow = {
  entry: { id: 'sep-1', sportEventId: EVENT_ID, participantId: 'p1', isActive: true, isPlayInPlace: false, createdAt: AT, updatedAt: AT },
  participant: { id: 'p1', name: 'Scottie', injuryStatus: { status: 'HEALTHY' }, externalIds: {}, createdAt: AT, updatedAt: AT },
  valuation: null, standing: null, rounds: [], raceResult: null, affiliatedWithSportLeague: true,
};
const round = { id: 'r1', sportEventId: EVENT_ID, roundNumber: 1, scheduledDate: AT, scheduledEndAt: null, createdAt: AT, updatedAt: AT };

function fakes() {
  const fn = <T>(value: T) => jest.fn((..._args: unknown[]) => Promise.resolve(value));
  const services = {
    sportEvents: {
      listEvents: fn([summary]),
      listEventYears: fn([2026, 2025]),
      requireSummary: fn(summary),
      requireAdminSummary: fn(summary),
      requireEvent: fn(sportEvent()),
      createEvent: fn(summary),
      createEventFromProviderEvent: fn(summary),
      cloneEventYear: fn([summary]),
      importProviderEventYear: fn({ created: [summary], skipped: [] }),
      updateEvent: fn(summary),
      deleteEvent: fn(undefined),
      releaseEvent: fn(summary),
    },
    rounds: { listRounds: fn([round]), reschedule: fn([round]) },
    field: {
      listEventParticipants: fn([fieldRow]),
      getEventParticipant: fn(fieldRow),
      listCachedEventParticipants: fn([fieldRow]),
      seedFromSportLeague: fn({ addedCount: 3 }),
      addParticipants: fn({ addedCount: 1 }),
      updateParticipants: fn([fieldRow]),
      previewUpload: fn([]),
      applyUpload: fn([fieldRow]),
      removeParticipant: fn(undefined),
    },
    tiers: {
      listTiers: fn([]),
      replaceTiers: fn([]),
      autoAssignTiers: fn(undefined),
      replaceTierAssignments: fn(undefined),
      autoAssignPrices: fn(undefined),
    },
    golfScores: { previewRoundScores: fn([]), applyRoundScores: fn(undefined), updateRoundScore: fn(undefined) },
    raceResults: { previewResults: fn({ rows: [], orderErrors: [] }), applyResults: fn(undefined) },
    statLines: { applyGameLines: fn(undefined) },
    matchResults: {
      recordResult: fn([]), clearResult: fn([]), recordPeriodScore: fn([]), clearPeriodScore: fn([]), cancelMatch: fn([]),
    },
    bracket: {
      listBracket: fn([]),
      loadBracket: fn([]),
      updateMatch: fn({ id: 'm1', scheduledDate: null, periodScores: [] }),
      proposeRoundMatchups: fn([{ matchNumber: 1 }]),
      setRoundMatchups: fn([]),
      fillPlayInSlot: fn(undefined),
      replaceWithdrawn: fn('sep-2'),
    },
  };
  const lifecycle = { applySportEventStatusTransition: fn(undefined) };
  const scoreSource = {
    getProviderEventDetail: fn({ externalId: 'x1' }),
    listTourEventsForYear: fn([]),
    linkScoreSource: fn(undefined),
    unlinkScoreSource: fn(undefined),
    startLiveSimulation: fn({ startsAt: AT, endsAt: AT, minutesPerRound: 5, phase: 'RUNNING', currentRound: 1 }),
    getLiveSimulation: fn({ startsAt: AT, endsAt: AT, minutesPerRound: 5, phase: 'RUNNING', currentRound: 1 }),
  };
  const ingestion = { syncEventData: fn({ sport: 'GOLF', eventId: 'masters-2026', requestedFeeds: ['EVENTPARTICIPANTS'], submittedAt: AT, syncRuns: [] }) };
  const handlers = createEventHandlers({
    services: services as unknown as SportEventServices,
    eventLifecycle: lifecycle as unknown as EventLifecycleService,
    scoreSource: scoreSource as unknown as EventScoreSourceService,
    ingestion: ingestion as unknown as IngestionService,
  });
  return { services, lifecycle, scoreSource, ingestion, handlers };
}
const params = { eventId: EVENT_ID };

describe('event reads: drafts and admin counts are a root admin\'s', () => {
  it('lists every event a root admin asks for, drafts included, with the admin counts', async () => {
    const { services, handlers } = fakes();

    const reply = await callHandler(handlers.listEvents, stubRequest({ query: { sport: 'GOLF' }, authUser: admin, contextLogger: false }));

    expect(services.sportEvents.listEvents).toHaveBeenCalledWith({ sport: 'GOLF', statuses: undefined, releasedOnly: false }, { adminCounts: true });
    expect(reply.body).toMatchObject({ events: [{ id: EVENT_ID }] });
  });

  it('lets a member list the events open for contests, or one sport league\'s season, released only and without counts', async () => {
    const { services, handlers } = fakes();

    await callHandler(handlers.listEvents, stubRequest({ query: { status: [SportEventStatus.SCHEDULED] }, authUser: member }));
    await callHandler(handlers.listEvents, stubRequest({ query: { sportLeagueId: 'pga', eventYear: 2026 } }));

    expect(services.sportEvents.listEvents.mock.calls).toEqual([
      [{ statuses: [SportEventStatus.SCHEDULED], releasedOnly: true }, { adminCounts: false }],
      [{ sportLeagueId: 'pga', eventYear: 2026, statuses: undefined, releasedOnly: true }, { adminCounts: false }],
    ]);
  });

  it.each([
    ['no filter', {}],
    ['a status that cannot take a contest', { status: [SportEventStatus.COMPLETED] }],
    ['an empty status list', { status: [] }],
    ['a sport league without a year', { sportLeagueId: 'pga' }],
  ])('refuses a member\'s unbounded list with %s with 403 ROOT_ADMIN_ACCESS_REQUIRED', async (_label, query) => {
    const { services, handlers } = fakes();

    await expect(callHandler(handlers.listEvents, stubRequest({ query, authUser: member })))
      .rejects.toMatchObject({ statusCode: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });
    expect(services.sportEvents.listEvents).not.toHaveBeenCalled();
  });

  it('reads years, an event and its bracket released only for a member, and with drafts for a root admin', async () => {
    const { services, handlers } = fakes();

    const years = await callHandler(handlers.listEventYears, stubRequest({ query: { sportLeagueId: 'pga' }, authUser: member }));
    await callHandler(handlers.listEventYears, stubRequest({ query: { sportLeagueId: 'pga' }, authUser: admin }));
    const event = await callHandler(handlers.getEvent, stubRequest({ params, authUser: member }));
    await callHandler(handlers.getEvent, stubRequest({ params, authUser: admin }));
    const bracket = await callHandler(handlers.getEventBracket, stubRequest({ params }));

    expect(years.body).toEqual({ years: [2026, 2025] });
    expect(services.sportEvents.listEventYears.mock.calls).toEqual([['pga', { releasedOnly: true }], ['pga', { releasedOnly: false }]]);
    expect(event.body).toMatchObject({ event: { id: EVENT_ID } });
    expect(services.sportEvents.requireSummary.mock.calls).toEqual([
      [EVENT_ID, { releasedOnly: true, adminCounts: false }],
      [EVENT_ID, { releasedOnly: false, adminCounts: true }],
    ]);
    expect(services.sportEvents.requireEvent).toHaveBeenCalledWith(EVENT_ID, { releasedOnly: true });
    expect(bracket.body).toEqual({ matches: [] });
  });
});

describe('event writes', () => {
  it('creates an event with its dates read from the body, an omitted end as none', async () => {
    const { services, handlers } = fakes();

    const created = await callHandler(handlers.createEvent, stubRequest({ body: { name: 'Open', startDate: ISO, endDate: ISO } }));
    await callHandler(handlers.createEvent, stubRequest({ body: { name: 'Open', startDate: ISO } }));

    expect(created.statusCode).toBe(201);
    expect(services.sportEvents.createEvent.mock.calls).toEqual([
      [{ name: 'Open', startDate: AT, endDate: AT }],
      [{ name: 'Open', startDate: AT, endDate: undefined }],
    ]);
  });

  it('creates an event from the provider event the body names, with 201', async () => {
    const { services, scoreSource, handlers } = fakes();
    const body = { sportLeagueId: 'pga', eventYear: 2026, providerId: 'feed', externalId: 'x1', rounds: 4 };

    const reply = await callHandler(handlers.createEventFromProviderEvent, stubRequest({ body }));

    expect(scoreSource.getProviderEventDetail).toHaveBeenCalledWith('feed', 'x1');
    expect(services.sportEvents.createEventFromProviderEvent).toHaveBeenCalledWith({ ...body, providerEvent: { externalId: 'x1' } });
    expect(reply.statusCode).toBe(201);
  });

  it('clones a year and imports a provider\'s year, each with 201', async () => {
    const { scoreSource, handlers } = fakes();

    const cloned = await callHandler(handlers.cloneEventYear, stubRequest({ body: { sportLeagueId: 'pga', fromYear: 2025, toYear: 2026 } }));
    const imported = await callHandler(handlers.importEventYearFromProvider, stubRequest({ body: { sportLeagueId: 'pga', eventYear: 2026, providerId: 'feed' } }));

    expect(cloned).toMatchObject({ statusCode: 201, body: { events: [{ id: EVENT_ID }] } });
    expect(scoreSource.listTourEventsForYear).toHaveBeenCalledWith('feed', 'pga', 2026);
    expect(imported).toMatchObject({ statusCode: 201, body: { created: [{ id: EVENT_ID }], skipped: [] } });
  });

  it('updates an event, telling members unless the body says not to, and clears an end sent as null', async () => {
    const { services, handlers } = fakes();

    await callHandler(handlers.updateEvent, stubRequest({ params, body: { name: 'Masters', startDate: ISO, endDate: null } }));
    await callHandler(handlers.updateEvent, stubRequest({ params, body: { endDate: ISO, tellMembers: false } }));
    await callHandler(handlers.updateEvent, stubRequest({ params, body: { name: 'Masters' } }));

    expect(services.sportEvents.updateEvent.mock.calls).toEqual([
      [EVENT_ID, { name: 'Masters', startDate: AT, endDate: null }, { tellMembers: true }],
      [EVENT_ID, { endDate: AT }, { tellMembers: false }],
      [EVENT_ID, { name: 'Masters' }, { tellMembers: true }],
    ]);
  });

  it('deletes an event with 204 and releases one with the event', async () => {
    const { handlers } = fakes();

    expect((await callHandler(handlers.deleteEvent, stubRequest({ params }))).statusCode).toBe(204);
    expect((await callHandler(handlers.releaseEvent, stubRequest({ params }))).body).toMatchObject({ event: { id: EVENT_ID } });
  });

  it('moves an event\'s status through the lifecycle as the root admin, and links and unlinks its score source, each answering with the event', async () => {
    const { lifecycle, scoreSource, handlers } = fakes();

    const moved = await callHandler(handlers.transitionEvent, stubRequest({ params, body: { toStatus: SportEventStatus.IN_PROGRESS } }));
    await callHandler(handlers.linkScoreSource, stubRequest({ params, body: { providerId: 'feed', externalId: 'x1' } }));
    const unlinked = await callHandler(handlers.unlinkScoreSource, stubRequest({ params }));

    expect(lifecycle.applySportEventStatusTransition).toHaveBeenCalledWith({ sportEventId: EVENT_ID, toStatus: SportEventStatus.IN_PROGRESS, actor: { type: 'ROOT_ADMIN' } });
    expect(scoreSource.linkScoreSource).toHaveBeenCalledWith(EVENT_ID, { providerId: 'feed', externalId: 'x1' });
    expect([moved.body, unlinked.body]).toEqual([expect.objectContaining({ event: expect.objectContaining({ id: EVENT_ID }) as unknown }), expect.objectContaining({ event: expect.anything() as unknown })]);
  });

  it('starts a live simulation at the body\'s pace, or the default with no body, and reads one', async () => {
    const { scoreSource, handlers } = fakes();

    const started = await callHandler(handlers.startLiveSimulation, stubRequest({ params, body: { minutesPerRound: 5 } }));
    await callHandler(handlers.startLiveSimulation, stubRequest({ params }));
    const read = await callHandler(handlers.getLiveSimulation, stubRequest({ params }));

    expect(scoreSource.startLiveSimulation.mock.calls).toEqual([[EVENT_ID, { minutesPerRound: 5 }], [EVENT_ID, { minutesPerRound: undefined }]]);
    expect(started.body).toMatchObject({ sportEventId: EVENT_ID, startsAt: ISO, phase: 'RUNNING' });
    expect(read.body).toMatchObject({ sportEventId: EVENT_ID, currentRound: 1 });
  });
});

describe('field refresh from the provider', () => {
  it('queues a field sync as the signed-in root admin with 202', async () => {
    const { ingestion, handlers } = fakes();

    const reply = await callHandler(handlers.refreshEventParticipants, stubRequest({ params, authUser: admin }));

    expect(ingestion.syncEventData).toHaveBeenCalledWith({ sport: 'GOLF', providerId: 'feed', eventId: 'masters-2026', feeds: ['EVENTPARTICIPANTS'] }, 'admin', 'admin@example.test');
    expect(reply).toMatchObject({ statusCode: 202, body: { eventId: 'masters-2026' } });
  });

  it('refuses a field sync for an event with no provider link with 409 EVENT_NOT_LINKED and syncs nothing', async () => {
    const { services, ingestion, handlers } = fakes();
    services.sportEvents.requireEvent.mockResolvedValueOnce(sportEvent({ syncScope: SportEventSyncScope.NONE }));

    const reply = await callHandler(handlers.refreshEventParticipants, stubRequest({ params }));

    expect(reply).toMatchObject({ statusCode: 409, body: { error: { code: 'EVENT_NOT_LINKED' } } });
    expect(ingestion.syncEventData).not.toHaveBeenCalled();
  });

  it.each([
    ['no provider with 404 SPORT_PROVIDER_NOT_FOUND', new SportProviderNotFoundError('GOLF', 'mock-provider'), 404, 'SPORT_PROVIDER_NOT_FOUND'],
    ['a sport ingestion is not set up for with 422 SPORT_SYNC_NOT_CONFIGURED', new SportSyncNotConfiguredError('GOLF'), 422, 'SPORT_SYNC_NOT_CONFIGURED'],
    ['a sync scope that leaves the field out with 409 SPORT_EVENT_SYNC_SCOPE_RESTRICTED', new SportEventSyncScopeError(EVENT_ID, 'SCORES_ONLY', ['EVENTPARTICIPANTS']), 409, 'SPORT_EVENT_SYNC_SCOPE_RESTRICTED'],
  ])('answers a field sync refused for %s, with no session read as no actor', async (_label, error, status, code) => {
    const { ingestion, handlers } = fakes();
    ingestion.syncEventData.mockRejectedValueOnce(error);

    const reply = await callHandler(handlers.refreshEventParticipants, stubRequest({ params }));

    expect(ingestion.syncEventData).toHaveBeenCalledWith(expect.anything(), '', '');
    expect(reply).toMatchObject({ statusCode: status, body: { error: { code } } });
  });

  it('passes an unexpected field sync failure on to the global error handler', async () => {
    const { ingestion, handlers } = fakes();
    ingestion.syncEventData.mockRejectedValueOnce(boom);

    await expect(callHandler(handlers.refreshEventParticipants, stubRequest({ params, authUser: admin }))).rejects.toBe(boom);
  });
});

describe('rounds, field and tiers', () => {
  it('lists an event\'s rounds and reschedules them, a round\'s end cleared, set or left alone', async () => {
    const { services, handlers } = fakes();

    const listed = await callHandler(handlers.listEventRounds, stubRequest({ params }));
    await callHandler(handlers.updateEventRounds, stubRequest({
      params,
      body: { rounds: [
        { roundNumber: 1, scheduledDate: ISO, scheduledEndAt: null },
        { roundNumber: 2, scheduledDate: ISO, scheduledEndAt: ISO },
        { roundNumber: 3, scheduledDate: ISO },
      ] },
    }));

    expect(listed.body).toMatchObject({ rounds: [{ id: 'r1', scheduledDate: ISO, scheduledEndAt: null }] });
    expect(services.rounds.reschedule).toHaveBeenCalledWith(EVENT_ID, [
      { roundNumber: 1, scheduledDate: AT, scheduledEndAt: null },
      { roundNumber: 2, scheduledDate: AT, scheduledEndAt: AT },
      { roundNumber: 3, scheduledDate: AT },
    ]);
  });

  it('reads the cached field, seeds and adds to it, and answers each field write with the field', async () => {
    const { services, handlers } = fakes();

    const listed = await callHandler(handlers.listEventParticipants, stubRequest({ params }));
    const seeded = await callHandler(handlers.seedEventParticipants, stubRequest({ params }));
    const added = await callHandler(handlers.addEventParticipants, stubRequest({ params, body: { participantIds: ['p1'] } }));
    const updated = await callHandler(handlers.updateEventParticipants, stubRequest({ params, body: { participants: [] } }));
    const preview = await callHandler(handlers.previewEventParticipantUpload, stubRequest({ params, body: { rows: [] } }));
    const applied = await callHandler(handlers.applyEventParticipantUpload, stubRequest({ params, body: { rows: [] } }));
    const removed = await callHandler(handlers.removeEventParticipant, stubRequest({ params: { eventId: EVENT_ID, sportEventParticipantId: 'sep-1' } }));

    expect(listed.body).toMatchObject({ participants: [{ id: 'sep-1' }] });
    expect(seeded.body).toEqual({ addedCount: 3 });
    expect(services.field.addParticipants).toHaveBeenCalledWith(EVENT_ID, ['p1']);
    expect(added.body).toEqual({ addedCount: 1 });
    expect(updated.body).toMatchObject({ participants: [{ id: 'sep-1' }] });
    expect(preview.body).toMatchObject({ rows: [] });
    expect(applied.body).toMatchObject({ participants: [{ id: 'sep-1' }] });
    expect(removed.statusCode).toBe(204);
  });

  it('lists and replaces tiers, and answers each tier or price assignment with the field', async () => {
    const { services, handlers } = fakes();

    expect((await callHandler(handlers.listEventTiers, stubRequest({ params }))).body).toEqual({ tiers: [] });
    expect((await callHandler(handlers.replaceEventTiers, stubRequest({ params, body: { tiers: [] } }))).body).toEqual({ tiers: [] });
    for (const [handler, body] of [
      [handlers.autoAssignEventTiers, { tierCount: 3 }],
      [handlers.replaceEventTierAssignments, { assignments: [] }],
      [handlers.autoAssignEventPrices, { salaryCap: 50000 }],
    ] as const) {
      expect((await callHandler(handler, stubRequest({ params, body }))).body).toMatchObject({ participants: [{ id: 'sep-1' }] });
    }
    expect(services.tiers.replaceTiers).toHaveBeenCalledWith({ sportEventId: EVENT_ID, tiers: [] });
    expect(services.tiers.autoAssignPrices).toHaveBeenCalledWith({ sportEventId: EVENT_ID, pricingConfig: { salaryCap: 50000 } });
  });
});

describe('results', () => {
  const roundParams = { eventId: EVENT_ID, roundNumber: 2 };

  it('previews and applies golf round scores, race results and stat lines, answering an apply with the field', async () => {
    const { services, handlers } = fakes();

    const golfPreview = await callHandler(handlers.previewGolfRoundScores, stubRequest({ params: roundParams, body: { rows: [] } }));
    const golfApplied = await callHandler(handlers.applyGolfRoundScores, stubRequest({ params: roundParams, body: { rows: [] } }));
    const racePreview = await callHandler(handlers.previewRaceResults, stubRequest({ params, body: { rows: [] } }));
    const raceApplied = await callHandler(handlers.applyRaceResults, stubRequest({ params, body: { rows: [] } }));
    const lines = await callHandler(handlers.applyGameStatLines, stubRequest({ params: roundParams, body: { rows: [] } }));

    expect(golfPreview.body).toMatchObject({ rows: [], rollup: { total: 0 } });
    expect(services.golfScores.applyRoundScores).toHaveBeenCalledWith(EVENT_ID, 2, []);
    expect(racePreview.body).toMatchObject({ rows: [], orderErrors: [] });
    expect(services.statLines.applyGameLines).toHaveBeenCalledWith(EVENT_ID, 2, []);
    for (const reply of [golfApplied, raceApplied, lines]) {
      expect(reply.body).toMatchObject({ participants: [{ id: 'sep-1' }] });
    }
  });

  it('answers one golfer\'s round score edit with that field row only', async () => {
    const { services, handlers } = fakes();

    const reply = await callHandler(handlers.updateGolfRoundScore, stubRequest({ params: { ...roundParams, sportEventParticipantId: 'sep-1' }, body: { strokes: 70 } }));

    expect(services.golfScores.updateRoundScore).toHaveBeenCalledWith(EVENT_ID, 2, 'sep-1', { strokes: 70 });
    expect(services.field.getEventParticipant).toHaveBeenCalledWith(EVENT_ID, 'sep-1');
    expect(reply.body).toMatchObject({ participant: { id: 'sep-1' } });
  });
});

describe('bracket', () => {
  const matchParams = { eventId: EVENT_ID, matchNumber: 4 };

  it('loads a bracket with each game\'s date read from the body, an unscheduled game\'s as none', async () => {
    const { services, handlers } = fakes();

    await callHandler(handlers.loadEventBracket, stubRequest({ params, body: { matches: [{ matchNumber: 1, scheduledDate: ISO }, { matchNumber: 2, scheduledDate: null }] } }));

    expect(services.bracket.loadBracket).toHaveBeenCalledWith(EVENT_ID, [{ matchNumber: 1, scheduledDate: AT }, { matchNumber: 2, scheduledDate: null }]);
  });

  it('edits a game, its date cleared, set or left alone', async () => {
    const { services, handlers } = fakes();

    const edited = await callHandler(handlers.updateEventBracketMatch, stubRequest({ params: matchParams, body: { scheduledDate: null } }));
    await callHandler(handlers.updateEventBracketMatch, stubRequest({ params: matchParams, body: { scheduledDate: ISO } }));
    await callHandler(handlers.updateEventBracketMatch, stubRequest({ params: matchParams, body: { isNeutralSite: true } }));

    expect(services.bracket.updateMatch.mock.calls).toEqual([
      [EVENT_ID, 4, { scheduledDate: null }],
      [EVENT_ID, 4, { scheduledDate: AT }],
      [EVENT_ID, 4, { isNeutralSite: true }],
    ]);
    expect(edited.body).toMatchObject({ match: { id: 'm1', scheduledDate: null } });
  });

  it('records, clears and cancels results and period scores, each answering with the bracket', async () => {
    const { services, handlers } = fakes();
    const periodParams = { ...matchParams, periodNumber: 2 };

    for (const [handler, request] of [
      [handlers.recordEventMatchResult, stubRequest({ params: matchParams, body: { homeScore: 70, awayScore: 65 } })],
      [handlers.clearEventMatchResult, stubRequest({ params: matchParams })],
      [handlers.recordEventMatchPeriodScore, stubRequest({ params: periodParams, body: { homeScore: 7, awayScore: 3 } })],
      [handlers.clearEventMatchPeriodScore, stubRequest({ params: periodParams })],
      [handlers.cancelEventMatch, stubRequest({ params: matchParams })],
    ] as const) {
      expect((await callHandler(handler, request)).body).toEqual({ matches: [] });
    }
    expect(services.matchResults.recordPeriodScore).toHaveBeenCalledWith(EVENT_ID, 4, 2, { homeScore: 7, awayScore: 3 });
    expect(services.matchResults.clearPeriodScore).toHaveBeenCalledWith(EVENT_ID, 4, 2);
  });

  it('proposes and sets a round\'s matchups', async () => {
    const { services, handlers } = fakes();
    const roundParams = { eventId: EVENT_ID, roundNumber: 2 };

    const proposed = await callHandler(handlers.proposeEventRoundMatchups, stubRequest({ params: roundParams }));
    const set = await callHandler(handlers.setEventRoundMatchups, stubRequest({ params: roundParams, body: { matches: [] } }));

    expect(proposed.body).toEqual({ matches: [{ matchNumber: 1 }] });
    expect(services.bracket.setRoundMatchups).toHaveBeenCalledWith(EVENT_ID, 2, []);
    expect(set.body).toEqual({ matches: [] });
  });

  it('answers a play-in winner with its slot\'s row, and a withdrawn team\'s replacement with the replacement\'s row', async () => {
    const { services, handlers } = fakes();
    const slot = { eventId: EVENT_ID, sportEventParticipantId: 'sep-1' };

    await callHandler(handlers.setEventPlayInWinner, stubRequest({ params: slot, body: { participantId: 'p9' } }));
    await callHandler(handlers.replaceEventParticipant, stubRequest({ params: slot, body: { participantId: 'p9' } }));

    expect(services.bracket.fillPlayInSlot).toHaveBeenCalledWith(EVENT_ID, 'sep-1', 'p9');
    expect(services.field.getEventParticipant.mock.calls).toEqual([[EVENT_ID, 'sep-1'], [EVENT_ID, 'sep-2']]);
  });
});
