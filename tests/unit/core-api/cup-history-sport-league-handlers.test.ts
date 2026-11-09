/**
 * The cup, history and sport league route handlers (#1482), called with a stand-in service: the
 * status each service error is sent with, what the plan hides, and that an error the handler does
 * not own reaches the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import { ContestStatus, CupStatus, PlanFeature, Sport } from '@poolmaster/shared/domain';
import type { SportLeagueListResponse } from '@poolmaster/shared/dto/sport-catalog.dto';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import { createCupHandlers } from '../../../packages/core-api/src/modules/cups/handler';
import {
  CupCrownedError,
  CupHasUnfinishedContestsError,
  CupNotFoundError,
  CupNothingCountedError,
  CupSquadNotFoundError,
  type CupService,
} from '../../../packages/core-api/src/modules/cups/service';
import { createHistoryHandlers } from '../../../packages/core-api/src/modules/history/handler';
import { HistorySquadNotFoundError, HistorySquadRequiredError, type HistoryService } from '../../../packages/core-api/src/modules/history/service';
import {
  YearReviewAlreadySentError,
  YearReviewNothingToSendError,
  YearReviewNotOpenError,
  type YearReviewService,
} from '../../../packages/core-api/src/modules/history/year-review-service';
import type { PlanEntitlements } from '../../../packages/core-api/src/modules/plans/plan-entitlements-service';
import type { SportLeagueService } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';
import { createSportLeagueHandlers } from '../../../packages/core-api/src/modules/sport-leagues/handler';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');
const cupView = {
  cup: { id: 'cup-1', leagueId: 'league-1', seasonYear: 2026, sportLeagueId: 'pga', status: CupStatus.OPEN, crownedAt: null },
  sportLeagueName: 'PGA Tour',
  standings: [],
  contests: [],
};

describe('cup handlers', () => {
  const service = {
    listSeasonCups: jest.fn((..._args: unknown[]) => Promise.resolve([cupView])),
    listSeasonYears: jest.fn((..._args: unknown[]) => Promise.resolve([2026, 2025])),
    getCup: jest.fn((..._args: unknown[]) => Promise.resolve(cupView)),
    getSquadPoints: jest.fn((..._args: unknown[]) => Promise.resolve({ cup: cupView.cup, sportLeagueName: 'PGA Tour', squad: { id: 's1', name: 'Eagles' }, points: 12, contests: [] })),
    getProjection: jest.fn((..._args: unknown[]) => Promise.resolve({ cup: cupView.cup, contests: [], standings: [] })),
    crown: jest.fn((..._args: unknown[]) => Promise.resolve({ ...cupView, cup: { ...cupView.cup, status: CupStatus.CROWNED } })),
  };
  const handlers = createCupHandlers(service as unknown as CupService);
  const cupParams = { id: 'league-1', cupId: 'cup-1' };

  it('lists a season\'s cups and the seasons that have any', async () => {
    const cups = await callHandler(handlers.listCups, stubRequest({ params: { id: 'league-1' }, query: { seasonYear: 2026 } }));
    const seasons = await callHandler(handlers.listCupSeasons, stubRequest({ params: { id: 'league-1' } }));

    expect(cups.body).toMatchObject({ cups: [{ id: 'cup-1', name: '2026 PGA Tour Cup' }] });
    expect(service.listSeasonCups).toHaveBeenCalledWith('league-1', 2026);
    expect(seasons.body).toEqual({ seasonYears: [2026, 2025] });
  });

  it('answers a cup, a squad\'s points, a projection and a crowning with each', async () => {
    const cup = await callHandler(handlers.getCup, stubRequest({ params: cupParams }));
    const points = await callHandler(handlers.getCupSquadPoints, stubRequest({
      params: { id: 'league-1', squadId: 's1' }, query: { seasonYear: 2026, sportLeagueId: 'pga' },
    }));
    const projection = await callHandler(handlers.getCupProjection, stubRequest({ params: cupParams }));
    const crowned = await callHandler(handlers.crownCup, stubRequest({ params: cupParams }));

    expect(cup.body).toMatchObject({ cup: { id: 'cup-1' } });
    expect(service.getSquadPoints).toHaveBeenCalledWith({ leagueId: 'league-1', seasonYear: 2026, sportLeagueId: 'pga' }, 's1');
    expect(points.body).toMatchObject({ squadPoints: { squadId: 's1', points: 12 } });
    expect(projection.body).toEqual({ projection: { cupId: 'cup-1', contests: [], standings: [] } });
    expect(crowned.body).toMatchObject({ cup: { status: CupStatus.CROWNED } });
  });

  const unfinished = new CupHasUnfinishedContestsError('Contests still running', [
    { id: 'c1', name: 'Masters', status: ContestStatus.ACTIVE } as never,
  ]);

  it.each([
    ['a missing cup with 404', 'getCup', 'getCup', new CupNotFoundError('No cup'), 404],
    ['a missing squad with 404', 'getCupSquadPoints', 'getSquadPoints', new CupSquadNotFoundError('No squad'), 404],
    ['a projection of a crowned cup with 409', 'getCupProjection', 'getProjection', new CupCrownedError('Crowned'), 409],
    ['crowning a cup with nothing counted with 409', 'crownCup', 'crown', new CupNothingCountedError('Nothing counted'), 409],
  ] as const)('answers %s and the error\'s own code', async (_label, handler, method, error, status) => {
    const failing = createCupHandlers({ [method]: () => Promise.reject(error) } as unknown as CupService);

    const reply = await callHandler(failing[handler], stubRequest({ params: { ...cupParams, squadId: 's1' }, query: {} }));

    expect(reply).toMatchObject({ statusCode: status, body: { error: { code: error.code } } });
  });

  it('answers crowning a cup whose contests are still running with 409 and each such contest', async () => {
    const failing = createCupHandlers({ crown: () => Promise.reject(unfinished) } as unknown as CupService);

    const reply = await callHandler(failing.crownCup, stubRequest({ params: cupParams }));

    expect(reply).toMatchObject({
      statusCode: 409,
      body: { error: { code: unfinished.code, details: { contests: [{ contestId: 'c1', name: 'Masters', status: ContestStatus.ACTIVE }] } } },
    });
  });

  it('passes an unexpected cup failure on to the global error handler', async () => {
    const failing = createCupHandlers({ getCup: () => Promise.reject(boom) } as unknown as CupService);

    await expect(callHandler(failing.getCup, stubRequest({ params: cupParams }))).rejects.toBe(boom);
  });
});

describe('history handlers', () => {
  const thisYear = new Date().getUTCFullYear();
  const squadYear = (year: number) => ({ squad: { id: 's1' }, year, championship: null, cups: [] });
  const service = {
    getPerpetualTrophies: jest.fn((..._args: unknown[]) => Promise.resolve([])),
    getRecords: jest.fn((..._args: unknown[]) => Promise.resolve([])),
    getSquadHistory: jest.fn((..._args: unknown[]) => Promise.resolve({ squad: { id: 's1' }, medals: [], trophies: [], years: [squadYear(thisYear), squadYear(2001)] })),
    getSquadYear: jest.fn((..._args: unknown[]) => Promise.resolve({ ...squadYear(thisYear), cups: [{ view: cupView, contestsCounted: 1, standing: null }] })),
    getSummary: jest.fn((..._args: unknown[]) => Promise.resolve({ tiles: [], years: [] })),
    listYearContests: jest.fn((..._args: unknown[]) => Promise.resolve([])),
  };
  const yearReviews = {
    getLastYear: jest.fn((..._args: unknown[]) => Promise.resolve({ year: 2025, status: 'OPEN', sentAt: null, sentBy: null })),
    send: jest.fn((..._args: unknown[]) => Promise.resolve({ year: 2025, status: 'SENT', sentAt: new Date('2026-01-05T00:00:00.000Z'), sentBy: null })),
  };
  const plan = (features: PlanFeature[]) => ({ forLeague: () => Promise.resolve({ features: new Set(features) } as unknown as PlanEntitlements) });
  const handlers = createHistoryHandlers(service as unknown as HistoryService, yearReviews as unknown as YearReviewService, plan([]));

  it('answers last year\'s review, and sends it as the signed-in commissioner', async () => {
    const review = await callHandler(handlers.getYearReview, stubRequest({ params: { id: 'league-1' } }));
    const sent = await callHandler(handlers.sendYearReview, stubRequest({ params: { id: 'league-1', year: 2025 }, authUser: authUser('commish') }));

    expect(review.body).toEqual({ yearReview: { year: 2025, status: 'OPEN', sentAt: null, sentByName: null } });
    expect(yearReviews.send).toHaveBeenCalledWith('league-1', 2025, 'commish');
    expect(sent.body).toMatchObject({ yearReview: { status: 'SENT', sentAt: '2026-01-05T00:00:00.000Z' } });
  });

  it.each([
    ['not open', new YearReviewNotOpenError('Not open')],
    ['with nothing to send', new YearReviewNothingToSendError('Nothing')],
    ['already sent', new YearReviewAlreadySentError('Sent')],
  ])('answers sending a review %s with 409 and its code', async (_label, error) => {
    const failing = createHistoryHandlers(service as unknown as HistoryService, { send: () => Promise.reject(error) } as unknown as YearReviewService, plan([]));

    const reply = await callHandler(failing.sendYearReview, stubRequest({ params: { id: 'league-1', year: 2025 }, authUser: authUser() }));

    expect(reply).toMatchObject({ statusCode: 409, body: { error: { code: error.code } } });
  });

  it('passes an unexpected failure sending a review on to the global error handler', async () => {
    const failing = createHistoryHandlers(service as unknown as HistoryService, { send: () => Promise.reject(boom) } as unknown as YearReviewService, plan([]));

    await expect(callHandler(failing.sendYearReview, stubRequest({ params: { id: 'league-1', year: 2025 } }))).rejects.toBe(boom);
  });

  it('lists the league\'s perpetual trophies, records and summary', async () => {
    const params = { id: 'league-1' };

    expect((await callHandler(handlers.listPerpetualTrophies, stubRequest({ params }))).body).toEqual({ trophies: [] });
    expect((await callHandler(handlers.listRecords, stubRequest({ params }))).body).toEqual({ records: [] });
    expect((await callHandler(handlers.getHistorySummary, stubRequest({ params }))).body).toEqual({ summary: { tiles: [], years: [] } });
  });

  it('leaves out a squad\'s earlier years and its cups when the plan has neither', async () => {
    const history = await callHandler(handlers.getSquadHistory, stubRequest({ params: { id: 'league-1', squadId: 's1' } }));
    const year = await callHandler(handlers.getSquadYear, stubRequest({ params: { id: 'league-1', squadId: 's1' }, query: { year: thisYear } }));

    expect((history.body as { squadHistory: { years: Array<{ year: number }> } }).squadHistory.years.map((row) => row.year)).toEqual([thisYear]);
    expect(year.body).toMatchObject({ squadYear: { year: thisYear, cups: [] } });
  });

  it('keeps a squad\'s earlier years and its cups when the plan has them', async () => {
    const full = createHistoryHandlers(service as unknown as HistoryService, yearReviews as unknown as YearReviewService, plan([PlanFeature.PAST_YEARS, PlanFeature.CUP_STANDINGS]));

    const history = await callHandler(full.getSquadHistory, stubRequest({ params: { id: 'league-1', squadId: 's1' } }));

    expect((history.body as { squadHistory: { years: unknown[] } }).squadHistory.years).toHaveLength(2);
  });

  it.each([
    ['getSquadHistory', 'getSquadHistory'],
    ['getSquadYear', 'getSquadYear'],
    ['listContestResults', 'listYearContests'],
  ] as const)('%s answers a squad that is not in the league with 404 SQUAD_NOT_FOUND and passes anything else on', async (handler, method) => {
    const notFound = createHistoryHandlers({ [method]: () => Promise.reject(new HistorySquadNotFoundError('No squad')) } as unknown as HistoryService, yearReviews as unknown as YearReviewService, plan([]));
    const broken = createHistoryHandlers({ [method]: () => Promise.reject(boom) } as unknown as HistoryService, yearReviews as unknown as YearReviewService, plan([]));
    const request = () => stubRequest({ params: { id: 'league-1', squadId: 's1' }, query: { year: 2026 } });

    expect(await callHandler(notFound[handler], request())).toMatchObject({ statusCode: 404, body: { error: { code: 'SQUAD_NOT_FOUND' } } });
    await expect(callHandler(broken[handler], request())).rejects.toBe(boom);
  });

  it('lists a year\'s contest results filtered by squad and place, and refuses a place filter with no squad with 400 SQUAD_ID_REQUIRED', async () => {
    const ok = await callHandler(handlers.listContestResults, stubRequest({ params: { id: 'league-1' }, query: { year: 2026, squadId: 's1', place: 1 } }));
    const failing = createHistoryHandlers({ listYearContests: () => Promise.reject(new HistorySquadRequiredError('Name a squad')) } as unknown as HistoryService, yearReviews as unknown as YearReviewService, plan([]));

    const refused = await callHandler(failing.listContestResults, stubRequest({ params: { id: 'league-1' }, query: { year: 2026, place: 1 } }));

    expect(ok.body).toEqual({ contests: [] });
    expect(service.listYearContests).toHaveBeenCalledWith('league-1', 2026, { squadId: 's1', place: 1 });
    expect(refused).toMatchObject({ statusCode: 400, body: { error: { code: 'SQUAD_ID_REQUIRED' } } });
  });
});

describe('sport league handlers', () => {
  const AT = new Date('2026-01-01T00:00:00.000Z');
  const sportLeague = { id: 'sl1', roundNames: [], createdAt: AT, updatedAt: AT };
  const affiliation = {
    id: 'a1', sportLeagueId: 'sl1', participantId: 'p1', ranking: 1, createdAt: AT, updatedAt: AT,
    participant: { id: 'p1', injuryStatus: { status: null, detail: null, expectedReturn: null, updatedAt: null }, createdAt: AT, updatedAt: AT },
  };
  const service = {
    listSportLeagues: jest.fn((..._args: unknown[]) => Promise.resolve([sportLeague])),
    getSportLeague: jest.fn((id: string) => Promise.resolve(id === 'sl1' ? sportLeague : null)),
    createSportLeague: jest.fn((..._args: unknown[]) => Promise.resolve(sportLeague)),
    updateSportLeague: jest.fn((..._args: unknown[]) => Promise.resolve(sportLeague)),
    deleteSportLeague: jest.fn((..._args: unknown[]) => Promise.resolve()),
    listAffiliations: jest.fn((..._args: unknown[]) => Promise.resolve([affiliation])),
    addAffiliation: jest.fn((..._args: unknown[]) => Promise.resolve(affiliation)),
    removeAffiliation: jest.fn((..._args: unknown[]) => Promise.resolve()),
    updateRankings: jest.fn((..._args: unknown[]) => Promise.resolve([affiliation])),
    previewAffiliationUpload: jest.fn((..._args: unknown[]) => Promise.resolve([{ row: 1, resolution: 'MATCHED', participantId: 'p1', participantName: 'One' }])),
    applyAffiliationUpload: jest.fn((..._args: unknown[]) => Promise.resolve([affiliation])),
  };
  const handlers = createSportLeagueHandlers(service as unknown as SportLeagueService, new ReadCache<SportLeagueListResponse>(60_000));
  const params = { sportLeagueId: 'sl1' };

  it('keeps the public list by sport and active filter, an omitted filter read as blank', async () => {
    await callHandler(handlers.listSportLeagues, stubRequest({ query: {} }));
    await callHandler(handlers.listSportLeagues, stubRequest({ query: {} }));
    const filtered = await callHandler(handlers.listSportLeagues, stubRequest({ query: { sport: Sport.GOLF, isActive: true } }));

    expect(service.listSportLeagues.mock.calls).toEqual([[{ sport: undefined, isActive: undefined }], [{ sport: Sport.GOLF, isActive: true }]]);
    expect(filtered.body).toMatchObject({ sportLeagues: [{ id: 'sl1' }] });
  });

  it('answers a sport league, and one that does not exist with 404 SPORT_LEAGUE_NOT_FOUND', async () => {
    const found = await callHandler(handlers.getSportLeague, stubRequest({ params }));
    const missing = await callHandler(handlers.getSportLeague, stubRequest({ params: { sportLeagueId: 'nope' } }));

    expect(found.body).toMatchObject({ sportLeague: { id: 'sl1' } });
    expect(missing).toMatchObject({ statusCode: 404, body: { error: { code: 'SPORT_LEAGUE_NOT_FOUND' } } });
  });

  it('creates a sport league for the sport the body names with 201, and updates and deletes one', async () => {
    const created = await callHandler(handlers.createSportLeague, stubRequest({ body: { sport: Sport.GOLF, name: 'PGA Tour' } }));
    const updated = await callHandler(handlers.updateSportLeague, stubRequest({ params, body: { name: 'PGA' } }));
    const deleted = await callHandler(handlers.deleteSportLeague, stubRequest({ params }));

    expect(service.createSportLeague).toHaveBeenCalledWith(Sport.GOLF, { name: 'PGA Tour' });
    expect(created).toMatchObject({ statusCode: 201, body: { sportLeague: { id: 'sl1' } } });
    expect(updated.body).toMatchObject({ sportLeague: { id: 'sl1' } });
    expect(deleted.statusCode).toBe(204);
  });

  it('lists, adds, removes and re-ranks a sport league\'s affiliations', async () => {
    const listed = await callHandler(handlers.listAffiliations, stubRequest({ params }));
    const added = await callHandler(handlers.createAffiliation, stubRequest({ params, body: { participantId: 'p1' } }));
    const removed = await callHandler(handlers.deleteAffiliation, stubRequest({ params: { sportLeagueId: 'sl1', participantId: 'p1' } }));
    const ranked = await callHandler(handlers.updateAffiliationRankings, stubRequest({ params, body: { rankings: [{ participantId: 'p1', ranking: 1 }] } }));

    expect(listed.body).toMatchObject({ affiliations: [{ id: 'a1' }] });
    expect(added).toMatchObject({ statusCode: 201, body: { affiliation: { id: 'a1' } } });
    expect(service.removeAffiliation).toHaveBeenCalledWith('sl1', 'p1');
    expect(removed.statusCode).toBe(204);
    expect(ranked.body).toMatchObject({ affiliations: [{ ranking: 1 }] });
  });

  it('previews and applies an affiliation upload', async () => {
    const preview = await callHandler(handlers.previewAffiliationUpload, stubRequest({ params, body: { rows: [] } }));
    const applied = await callHandler(handlers.applyAffiliationUpload, stubRequest({ params, body: { rows: [] } }));

    expect(preview.body).toEqual({ rows: [{ row: 1, resolution: 'MATCHED', participantId: 'p1', participantName: 'One' }] });
    expect(applied.body).toMatchObject({ affiliations: [{ id: 'a1' }] });
  });
});
