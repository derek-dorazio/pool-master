/**
 * #1181 — the event page routes against a stand-in repository: how long a copy of a page may be
 * kept follows its soonest offer cutoff, and a copy this task kept is read afresh once an offer
 * in it has closed, so no page shows a closed contest as open.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { EventPageRepository } from '@poolmaster/shared/db';
import { ContestFormat, SelectionType, Sport, type EventPage, type EventPageOffer } from '@poolmaster/shared/domain';
import { ContestOpening, type ContestOpeningWindow } from '../../../packages/core-api/src/modules/contest-management/contest-opening';
import { createEventPageHandlers } from '../../../packages/core-api/src/modules/event-pages/handler';
import { EventPageService, type EventPageView } from '../../../packages/core-api/src/modules/event-pages/service';
import { PUBLIC_CACHE_CONTROL } from '../../../packages/core-api/src/core/public-cache';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import { etagPlugin } from '../../../packages/core-api/src/plugins/etag-support';

const STAMP = new Date('2026-10-01T00:00:00.000Z');
const PAGE: EventPage = { id: 'page-cw', sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend', displayOrder: 20, isActive: true, redirectTo: null };
const OFFER: EventPageOffer = {
  id: 'clutch-card',
  eventPageId: PAGE.id,
  sportLeagueId: 'cw',
  sportLeagueName: 'Championship Weekend',
  eventSeriesName: 'Conference Championships',
  template: {
    id: 'cw-tiered',
    sport: Sport.AMERICAN_FOOTBALL,
    sportLeagueId: null,
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    templateKey: 'cw-tiered',
    name: 'Championship Weekend Stars',
    description: 'Stars',
    sortOrder: 1,
    isDefault: true,
    active: true,
    configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
    schemaVersion: 1,
    eventSeriesNames: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  bracketStartRound: null,
  sortOrder: 1,
  isPrimary: true,
};

const pages: EventPageRepository = {
  findBySportSlug: () => Promise.resolve(PAGE),
  findActive: () => Promise.resolve([PAGE]),
  findOffers: () => Promise.resolve([OFFER]),
  findEditionsNotOver: () => Promise.resolve([{ sportEventId: 'cw-2027', name: 'Conference Championships', eventYear: 2027, startDate: STAMP, endDate: null }]),
};

/** An app whose offer closes at each of `cutoffs` in turn, one per time the page is computed. */
async function appClosingAt(cutoffs: Array<() => Date>): Promise<{ app: FastifyInstance; computed: () => number }> {
  let computed = 0;
  const service = new EventPageService({
    pages,
    opening: (): Promise<ContestOpeningWindow> => {
      const closesAt = (cutoffs[Math.min(computed, cutoffs.length - 1)] ?? (() => STAMP))();
      computed += 1;
      return Promise.resolve({ opening: ContestOpening.OPEN, closesAt });
    },
  });
  const handlers = createEventPageHandlers(service, {
    lists: new ReadCache<EventPageView[]>(60_000),
    pages: new ReadCache<EventPageView>(60_000),
  });
  const app = Fastify({ logger: false });
  await app.register(etagPlugin);
  await app.register((scope) => {
    scope.get('/', handlers.listEventPages);
    scope.get('/:sport/:pageSlug', handlers.getEventPage);
  }, { prefix: '/api/v1/event-pages' });
  await app.ready();
  return { app, computed: () => computed };
}

const inSeconds = (seconds: number) => () => new Date(Date.now() + seconds * 1000 + 500);

describe('event page routes (#1181)', () => {
  it('lets a page whose offer closes in 10 minutes be kept 5 minutes in the browser and 10 at CloudFront, no longer', async () => {
    const { app } = await appClosingAt([inSeconds(600)]);

    const page = await app.inject({ method: 'GET', url: '/api/v1/event-pages/AMERICAN_FOOTBALL/championship-weekend' });
    const list = await app.inject({ method: 'GET', url: '/api/v1/event-pages' });

    expect(page.headers['cache-control']).toBe('public, max-age=300, s-maxage=600');
    expect(list.headers['cache-control']).toBe('public, max-age=300, s-maxage=600');
    await app.close();
  });

  it('keeps a page whose offers close more than an hour away for the full hour', async () => {
    const { app } = await appClosingAt([inSeconds(7200)]);

    const page = await app.inject({ method: 'GET', url: '/api/v1/event-pages/AMERICAN_FOOTBALL/championship-weekend' });

    expect(page.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    await app.close();
  });

  it('reads a page afresh, rather than answering from this task\'s copy, once an offer in the copy has closed', async () => {
    const { app, computed } = await appClosingAt([inSeconds(-5), inSeconds(7200)]);

    const page = await app.inject({ method: 'GET', url: '/api/v1/event-pages/AMERICAN_FOOTBALL/championship-weekend' });
    const again = await app.inject({ method: 'GET', url: '/api/v1/event-pages/AMERICAN_FOOTBALL/championship-weekend' });

    expect(computed()).toBe(2);
    expect(page.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    expect(again.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    await app.close();
  });
});
