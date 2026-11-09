/**
 * The short route handlers (#1482), each called with a stand-in service and a stub request: what
 * the request becomes as a service call, the status each service error is sent with, and that an
 * error the handler does not own reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto } from '@poolmaster/shared/dto';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import { createChampionshipHandlers } from '../../../packages/core-api/src/modules/championship/handler';
import { ChampionshipLeagueNotFoundError, type ChampionshipService } from '../../../packages/core-api/src/modules/championship/service';
import { createContestConfigTemplateHandlers } from '../../../packages/core-api/src/modules/contest-config-templates/handler';
import {
  ContestConfigTemplateNotFoundError,
  ContestConfigTemplateRulesMismatchError,
  type ContestConfigTemplateService,
} from '../../../packages/core-api/src/modules/contest-config-templates/service';
import { createEventPageHandlers } from '../../../packages/core-api/src/modules/event-pages/handler';
import { EventPageNotFoundError, type EventPageService, type EventPageView } from '../../../packages/core-api/src/modules/event-pages/service';
import { createBulkHandlers } from '../../../packages/core-api/src/modules/leagues/bulk-handler';
import { BulkOperationError, type BulkService } from '../../../packages/core-api/src/modules/leagues/bulk-service';
import { createLeagueEventEmailSettingsHandler } from '../../../packages/core-api/src/modules/leagues/event-email-settings-handler';
import type { LeagueEventEmailSettingsService } from '../../../packages/core-api/src/modules/leagues/event-email-settings-service';
import { LeagueNotFoundError, LeagueOperationError } from '../../../packages/core-api/src/modules/leagues/service';
import { createSelectionHandlers } from '../../../packages/core-api/src/modules/selections/handler';
import type { PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import type { SelectionService } from '../../../packages/core-api/src/modules/selections/service';
import { createSquaresHandlers } from '../../../packages/core-api/src/modules/selections/squares-handler';
import type { SquaresService } from '../../../packages/core-api/src/modules/selections/squares-service';
import { buildLeague } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';
import { platinumEntitlements } from '../../support/plan-entitlements';

const boom = new Error('database down');

describe('championship handlers', () => {
  const service = (getYear: ChampionshipService['getYear']) => ({
    listYears: jest.fn((..._args: unknown[]) => Promise.resolve([])),
    getYear,
  }) as unknown as ChampionshipService;

  it('lists a league\'s championship years', async () => {
    const handlers = createChampionshipHandlers(service(jest.fn()));

    const reply = await callHandler(handlers.listChampionshipYears, stubRequest({ params: { id: 'league-1' } }));

    expect(reply).toMatchObject({ statusCode: 200, body: { years: [] } });
  });

  it('answers a league\'s championship year with it', async () => {
    const year = { leagueId: 'league-1', year: 2026, cupName: 'Cup', isOver: false, contestsCounted: 2, contestsToGo: 1, standings: [], tiles: [] };
    const handlers = createChampionshipHandlers(service(() => Promise.resolve(year)));

    const reply = await callHandler(handlers.getChampionship, stubRequest({ params: { id: 'league-1', year: 2026 } }));

    expect(reply).toMatchObject({ statusCode: 200, body: { championship: { leagueId: 'league-1', year: 2026, contestsToGo: 1 } } });
  });

  it('answers a championship year of a league that does not exist with 404 LEAGUE_NOT_FOUND', async () => {
    const handlers = createChampionshipHandlers(service(() => Promise.reject(new ChampionshipLeagueNotFoundError('League not found'))));

    const reply = await callHandler(handlers.getChampionship, stubRequest({ params: { id: 'league-1', year: 2026 } }));

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_NOT_FOUND' } } });
  });

  it('passes any other failure reading a championship year on to the global error handler', async () => {
    const handlers = createChampionshipHandlers(service(() => Promise.reject(boom)));

    await expect(callHandler(handlers.getChampionship, stubRequest({ params: { id: 'league-1', year: 2026 } }))).rejects.toBe(boom);
  });
});

describe('bulk member import handler', () => {
  const handlersFailingWith = (error: Error) => createBulkHandlers({
    importMembersFromCsv: () => Promise.reject(error),
  } as unknown as BulkService);
  const request = () => stubRequest({ params: { id: 'league-1' }, body: { rows: [] }, authUser: authUser('commish') });

  it('answers an import with 201 and what it did, as the signed-in commissioner', async () => {
    const importMembersFromCsv = jest.fn((..._args: unknown[]) => Promise.resolve({ created: 1 }));
    const handlers = createBulkHandlers({ importMembersFromCsv } as unknown as BulkService);

    const reply = await callHandler(handlers.importMembers, request());

    expect(reply).toMatchObject({ statusCode: 201, body: { created: 1 } });
    expect(importMembersFromCsv).toHaveBeenCalledWith('league-1', 'commish', []);
  });

  it('answers an import into a missing league with 404 and the error\'s own code', async () => {
    const reply = await callHandler(handlersFailingWith(new BulkOperationError('No league', 'LEAGUE_NOT_FOUND')).importMembers, request());

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_NOT_FOUND' } } });
  });

  it('answers any other refused import with 400 and the error\'s own code', async () => {
    const reply = await callHandler(handlersFailingWith(new BulkOperationError('Bad row', 'LEAGUE_OPERATION_INVALID')).importMembers, request());

    expect(reply).toMatchObject({ statusCode: 400, body: { error: { code: 'LEAGUE_OPERATION_INVALID' } } });
  });

  it('passes an unexpected import failure on to the global error handler', async () => {
    await expect(callHandler(handlersFailingWith(boom).importMembers, request())).rejects.toBe(boom);
  });
});

describe('league event email settings handler', () => {
  const league = buildLeague({ id: 'league-1' });
  const handlerWith = (update: LeagueEventEmailSettingsService['update']) => createLeagueEventEmailSettingsHandler(
    { update } as unknown as LeagueEventEmailSettingsService,
    platinumEntitlements(),
    { countActivityFor: () => Promise.resolve({ memberCount: 3, activeContestCount: 1 }) },
  );
  const request = () => stubRequest({ params: { id: 'league-1' }, body: {} });

  it('answers a saved setting with the league and its counts', async () => {
    const reply = await callHandler(handlerWith(() => Promise.resolve(league)), request());

    expect(reply).toMatchObject({ statusCode: 200, body: { league: { id: 'league-1', memberCount: 3, activeContestCount: 1 } } });
  });

  it('answers a missing league with 404 LEAGUE_NOT_FOUND, logging through the request\'s own logger when it has no context logger', async () => {
    const reply = await callHandler(handlerWith(() => Promise.reject(new LeagueNotFoundError('league-1'))), stubRequest({ params: { id: 'league-1' }, body: {}, contextLogger: false }));

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'LEAGUE_NOT_FOUND' } } });
  });

  it('answers a refused setting with the error\'s own status and code', async () => {
    const reply = await callHandler(handlerWith(() => Promise.reject(new LeagueOperationError('Not allowed', 'PLAN_FEATURE_NOT_INCLUDED', 403))), request());

    expect(reply).toMatchObject({ statusCode: 403, body: { error: { code: 'PLAN_FEATURE_NOT_INCLUDED' } } });
  });

  it('passes an unexpected failure on to the global error handler', async () => {
    await expect(callHandler(handlerWith(() => Promise.reject(boom)), request())).rejects.toBe(boom);
  });
});

describe('contest config template handlers', () => {
  const template = { id: 't1' } as unknown as ContestConfigTemplateDto;

  it('keeps the public list by its filters, an omitted filter read as blank, and reads the service once per filter set', async () => {
    const listTemplates = jest.fn((..._args: unknown[]) => Promise.resolve([template]));
    const handlers = createContestConfigTemplateHandlers({ listTemplates } as unknown as ContestConfigTemplateService, new ReadCache(60_000));
    const query = { sport: Sport.GOLF };

    const first = await callHandler(handlers.listTemplates, stubRequest({ query }));
    await callHandler(handlers.listTemplates, stubRequest({ query }));
    await callHandler(handlers.listTemplates, stubRequest({ query: { sport: Sport.GOLF, active: true } }));

    expect(first.body).toEqual({ templates: [template] });
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });

  it('clears the kept lists once an update lands, so the next list reads afresh', async () => {
    const listTemplates = jest.fn((..._args: unknown[]) => Promise.resolve([template]));
    const updateTemplate = jest.fn((..._args: unknown[]) => Promise.resolve(template));
    const handlers = createContestConfigTemplateHandlers({ listTemplates, updateTemplate } as unknown as ContestConfigTemplateService, new ReadCache(60_000));
    await callHandler(handlers.listTemplates, stubRequest({ query: {} }));

    const reply = await callHandler(handlers.updateTemplate, stubRequest({ params: { templateId: 't1' }, body: {} }));
    await callHandler(handlers.listTemplates, stubRequest({ query: {} }));

    expect(reply.body).toEqual({ template });
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a missing template with 404 CONTEST_CONFIG_TEMPLATE_NOT_FOUND', new ContestConfigTemplateNotFoundError('t1'), 404, 'CONTEST_CONFIG_TEMPLATE_NOT_FOUND'],
    ['rules of another selection type with 422 CONTEST_CONFIG_TEMPLATE_RULES_MISMATCH', new ContestConfigTemplateRulesMismatchError('TIERED', 'DRAFT'), 422, 'CONTEST_CONFIG_TEMPLATE_RULES_MISMATCH'],
  ])('answers an update of %s', async (_label, error, status, code) => {
    const handlers = createContestConfigTemplateHandlers({ updateTemplate: () => Promise.reject(error) } as unknown as ContestConfigTemplateService, new ReadCache(60_000));

    const reply = await callHandler(handlers.updateTemplate, stubRequest({ params: { templateId: 't1' }, body: {} }));

    expect(reply).toMatchObject({ statusCode: status, body: { error: { code } } });
  });

  it('passes an unexpected update failure on to the global error handler', async () => {
    const handlers = createContestConfigTemplateHandlers({ updateTemplate: () => Promise.reject(boom) } as unknown as ContestConfigTemplateService, new ReadCache(60_000));

    await expect(callHandler(handlers.updateTemplate, stubRequest({ params: { templateId: 't1' }, body: {} }))).rejects.toBe(boom);
  });
});

describe('event page handler errors', () => {
  const handlersWith = (getPage: EventPageService['getPage']) => createEventPageHandlers(
    { getPage } as unknown as EventPageService,
    { lists: new ReadCache<EventPageView[]>(60_000), pages: new ReadCache<EventPageView>(60_000) },
  );

  it('answers an address with no page with 404 EVENT_PAGE_NOT_FOUND', async () => {
    const handlers = handlersWith(() => Promise.reject(new EventPageNotFoundError('No page')));

    const reply = await callHandler(handlers.getEventPage, stubRequest({ params: { sport: Sport.GOLF, pageSlug: 'nope' } }));

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'EVENT_PAGE_NOT_FOUND' } } });
  });

  it('passes an unexpected failure reading a page on to the global error handler', async () => {
    const handlers = handlersWith(() => Promise.reject(boom));

    await expect(callHandler(handlers.getEventPage, stubRequest({ params: { sport: Sport.GOLF, pageSlug: 'x' } }))).rejects.toBe(boom);
  });
});

describe('squares handlers', () => {
  const board = {
    contest: { id: 'c1', status: ContestStatus.OPEN },
    game: { scheduledDate: null, periodScores: [] },
    digits: null,
  };
  const service = {
    getBoard: jest.fn((..._args: unknown[]) => Promise.resolve(board)),
    claim: jest.fn((..._args: unknown[]) => Promise.resolve(board)),
    clear: jest.fn((..._args: unknown[]) => Promise.resolve(board)),
    draw: jest.fn((..._args: unknown[]) => Promise.resolve(board)),
  };
  const handlers = createSquaresHandlers(service as unknown as SquaresService);
  const actor = { userId: 'user-1', isRootAdmin: false };
  const box = { contestId: 'c1', rowIndex: 2, columnIndex: 3 };

  it('reads the board as the signed-in caller and answers with it', async () => {
    const reply = await callHandler(handlers.getSquaresBoard, stubRequest({ params: { contestId: 'c1' }, authUser: authUser() }));

    expect(reply.body).toMatchObject({ contestId: 'c1', digits: null });
    expect(service.getBoard).toHaveBeenCalledWith('c1', actor);
  });

  it('claims a box for the entry the body names, and clears and draws as the caller', async () => {
    await callHandler(handlers.claimSquaresBox, stubRequest({ params: box, body: { contestEntryId: 'entry-1' }, authUser: authUser() }));
    await callHandler(handlers.clearSquaresBox, stubRequest({ params: box, authUser: authUser() }));
    await callHandler(handlers.drawSquaresNumbers, stubRequest({ params: { contestId: 'c1' }, authUser: authUser('admin', { isRootAdmin: true }) }));

    expect(service.claim).toHaveBeenCalledWith('c1', 2, 3, 'entry-1', actor);
    expect(service.clear).toHaveBeenCalledWith('c1', 2, 3, actor);
    expect(service.draw).toHaveBeenCalledWith('c1', { userId: 'admin', isRootAdmin: true });
  });

  it('refuses a caller with no session with 401 AUTH_SESSION_REQUIRED', async () => {
    await expect(callHandler(handlers.getSquaresBoard, stubRequest({ params: { contestId: 'c1' } })))
      .rejects.toMatchObject({ statusCode: 401, code: 'AUTH_SESSION_REQUIRED' });
  });
});

describe('selection handlers', () => {
  const view = {
    contest: { id: 'c1', name: 'Pool', selectionType: 'TIERED', drawnAt: null },
    entries: [],
    selectionGroups: [],
    picks: [],
  };
  const pickResult = { contestId: 'c1', entryId: 'e1', sportEventId: 'ev1', entryStatus: 'DRAFT', picks: [], lineupSummary: null };
  const gamePicks = { submittedAt: null, games: [] };
  const service = {
    getSelectionState: jest.fn((..._args: unknown[]) => Promise.resolve(view)),
    selectPick: jest.fn((..._args: unknown[]) => Promise.resolve(pickResult)),
    unselectPick: jest.fn((..._args: unknown[]) => Promise.resolve(pickResult)),
    submitEntry: jest.fn((..._args: unknown[]) => Promise.resolve(view)),
    runDraw: jest.fn((..._args: unknown[]) => Promise.resolve(view)),
  };
  const predictions = {
    getGamePicks: jest.fn((..._args: unknown[]) => Promise.resolve(gamePicks)),
    saveGamePicks: jest.fn((..._args: unknown[]) => Promise.resolve(gamePicks)),
    clearGamePick: jest.fn((..._args: unknown[]) => Promise.resolve(gamePicks)),
    submitGamePicks: jest.fn((..._args: unknown[]) => Promise.resolve(gamePicks)),
  };
  const handlers = createSelectionHandlers(service as unknown as SelectionService, predictions as unknown as PredictionService);
  const entryEvent = { contestId: 'c1', entryId: 'e1', sportEventId: 'ev1' };

  it('reads the room for a signed-out caller with no actor, and for a root admin as one', async () => {
    await callHandler(handlers.getSelectionState, stubRequest({ params: { contestId: 'c1' }, query: {} }));
    const reply = await callHandler(handlers.getSelectionState, stubRequest({
      params: { contestId: 'c1' }, query: { entryId: 'e1', sportEventId: 'ev1' }, authUser: authUser('admin', { isRootAdmin: true }),
    }));

    expect(service.getSelectionState.mock.calls).toEqual([
      [{ contestId: 'c1', selectedEntryId: undefined, sportEventId: undefined, actorUserId: undefined, actorIsRootAdmin: false }],
      [{ contestId: 'c1', selectedEntryId: 'e1', sportEventId: 'ev1', actorUserId: 'admin', actorIsRootAdmin: true }],
    ]);
    expect(reply.body).toMatchObject({ contestId: 'c1', contestName: 'Pool', drawnAt: null });
  });

  it('answers a pick and an unpick with what changed on the entry only', async () => {
    const params = { contestId: 'c1', entryId: 'e1', sportEventParticipantId: 'sep-1' };

    const picked = await callHandler(handlers.selectContestPick, stubRequest({ params, authUser: authUser() }));
    await callHandler(handlers.unselectContestPick, stubRequest({ params }));

    expect(picked.body).toEqual({ contestId: 'c1', entryId: 'e1', sportEventId: 'ev1', entryStatus: 'DRAFT', picks: [], lineupSummary: null });
    expect(service.selectPick).toHaveBeenCalledWith({ ...params, actorUserId: 'user-1' });
    expect(service.unselectPick).toHaveBeenCalledWith({ ...params, actorUserId: undefined });
  });

  it('submits an entry\'s event and runs a draw as the caller, answering with the room', async () => {
    await callHandler(handlers.submitContestEntry, stubRequest({ params: entryEvent, authUser: authUser() }));
    await callHandler(handlers.runContestDraw, stubRequest({ params: { contestId: 'c1' } }));

    expect(service.submitEntry).toHaveBeenCalledWith({ ...entryEvent, actorUserId: 'user-1' });
    expect(service.runDraw).toHaveBeenCalledWith({ contestId: 'c1', actorUserId: undefined });
  });

  it('reads, saves, clears and submits game picks for the entry and event the path names', async () => {
    const actor = { ...entryEvent, actorUserId: 'user-1' };

    await callHandler(handlers.getGamePicks, stubRequest({ params: entryEvent, authUser: authUser() }));
    await callHandler(handlers.saveGamePicks, stubRequest({ params: entryEvent, body: { picks: [], tiebreakerValue: 41 }, authUser: authUser() }));
    await callHandler(handlers.clearGamePick, stubRequest({ params: { ...entryEvent, sportEventMatchId: 'm1' }, authUser: authUser() }));
    const submitted = await callHandler(handlers.submitGamePicks, stubRequest({ params: entryEvent }));

    expect(predictions.getGamePicks).toHaveBeenCalledWith(actor);
    expect(predictions.saveGamePicks).toHaveBeenCalledWith({ ...actor, picks: [], tiebreakerValue: 41 });
    expect(predictions.clearGamePick).toHaveBeenCalledWith({ ...actor, sportEventMatchId: 'm1' });
    expect(predictions.submitGamePicks).toHaveBeenCalledWith({ ...entryEvent, actorUserId: undefined });
    expect(submitted.body).toMatchObject({ submittedAt: null, games: [] });
  });
});
