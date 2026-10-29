/**
 * Event pages (#1007): a page's offers, each with its series' first edition still able to take
 * the contest, and retired pages and unknown addresses.
 */
import type { EventPageRepository } from '@poolmaster/shared/db';
import {
  ContestFormat,
  EventPageOfferState,
  SelectionType,
  Sport,
  type ContestConfigTemplate,
  type EventPage,
  type EventPageEdition,
  type EventPageOffer,
} from '@poolmaster/shared/domain';
import { ContestOpening, type ContestOpeningSetup } from '../../../packages/core-api/src/modules/contest-management/contest-opening';
import { EventPageNotFoundError, EventPageService, eventPagesChangeAt } from '../../../packages/core-api/src/modules/event-pages/service';

const STAMP = new Date('2026-10-01T00:00:00.000Z');
const DEFAULT_CLOSES_AT = new Date('2027-01-09T18:00:00.000Z');

function template(id: string, configJson: ContestConfigTemplate['configJson']): ContestConfigTemplate {
  return {
    id,
    sport: Sport.AMERICAN_FOOTBALL,
    sportLeagueId: null,
    contestFormat: ContestFormat.ROSTER,
    selectionType: configJson.selectionType,
    templateKey: id,
    name: id,
    description: id,
    sortOrder: 1,
    isDefault: true,
    active: true,
    configJson,
    schemaVersion: 1,
    eventSeriesNames: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const PAGE: EventPage = { id: 'page-cw', sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend', displayOrder: 20, isActive: true, redirectTo: null };
const RETIRED: EventPage = { id: 'page-old', sport: Sport.AMERICAN_FOOTBALL, slug: 'conference-weekend', displayOrder: 30, isActive: false, redirectTo: { sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend' } };

function offer(id: string, overrides: Partial<EventPageOffer>): EventPageOffer {
  return {
    id,
    eventPageId: PAGE.id,
    sportLeagueId: 'nfl',
    sportLeagueName: 'NFL',
    eventSeriesName: 'NFL Playoffs',
    template: template(`${id}-template`, { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 }),
    bracketStartRound: null,
    sortOrder: 1,
    isPrimary: false,
    ...overrides,
  };
}

const CLUTCH_CARD = offer('clutch-card', {
  sportLeagueId: 'cw',
  sportLeagueName: 'Championship Weekend',
  eventSeriesName: 'Conference Championships',
  template: template('cw-tiered', { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }),
  isPrimary: true,
});
const BRACKET = offer('bracket', {
  template: template('nfl-second-chance', { selectionType: SelectionType.BRACKET, startsAtRound: 2 }),
  bracketStartRound: 3,
  sortOrder: 2,
});
const SQUARES = offer('squares', { sortOrder: 3 });

function edition(sportEventId: string, startDate: string): EventPageEdition {
  return { sportEventId, name: sportEventId, eventYear: 2027, startDate: new Date(startDate), endDate: null };
}

function build(options: {
  pages?: EventPage[];
  offers?: EventPageOffer[];
  editions?: Record<string, EventPageEdition[]>;
  openings?: Record<string, ContestOpening>;
  closesAt?: Record<string, Date>;
}) {
  const pages = options.pages ?? [PAGE];
  const offers = options.offers ?? [CLUTCH_CARD, BRACKET, SQUARES];
  const repo: EventPageRepository = {
    findBySportSlug: (sport, slug) => Promise.resolve(pages.find((page) => page.sport === sport && page.slug === slug) ?? null),
    findActive: (sport) => Promise.resolve(pages.filter((page) => page.isActive && (sport === undefined || page.sport === sport))),
    findOffers: (ids) => Promise.resolve(offers.filter((each) => ids.includes(each.eventPageId))),
    findEditionsNotOver: (sportLeagueId, seriesName) => Promise.resolve(options.editions?.[`${sportLeagueId}/${seriesName}`] ?? []),
  };
  const asked: Array<{ sportEventId: string; setup: ContestOpeningSetup }> = [];
  const service = new EventPageService({
    pages: repo,
    opening: (sportEventId, setup) => {
      asked.push({ sportEventId, setup });
      const opening = options.openings?.[sportEventId] ?? ContestOpening.OPEN;
      const closesAt = opening === ContestOpening.CLOSED ? null : options.closesAt?.[sportEventId] ?? DEFAULT_CLOSES_AT;
      return Promise.resolve({ opening, closesAt });
    },
  });
  return { service, asked };
}

describe('EventPageService', () => {
  it('shows each offer with its series\' next edition and whether it opens now, in order', async () => {
    const { service } = build({
      editions: {
        'cw/Conference Championships': [edition('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
      openings: { 'cw-2027': ContestOpening.NOT_YET },
    });

    const view = await service.getPage(Sport.AMERICAN_FOOTBALL, 'championship-weekend');

    expect(view.offers.map((each) => [each.offer.id, each.edition.sportEventId, each.state])).toEqual([
      ['clutch-card', 'cw-2027', EventPageOfferState.NOT_YET],
      ['bracket', 'playoffs-2027', EventPageOfferState.OPEN],
      ['squares', 'playoffs-2027', EventPageOfferState.OPEN],
    ]);
  });

  it('carries each offer\'s cutoff, and says the pages change at the soonest one, so no copy is kept past it (#1181)', async () => {
    const { service } = build({
      editions: {
        'cw/Conference Championships': [edition('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
      closesAt: { 'cw-2027': new Date('2027-01-24T20:00:00.000Z'), 'playoffs-2027': new Date('2027-01-16T21:30:00.000Z') },
    });

    const view = await service.getPage(Sport.AMERICAN_FOOTBALL, 'championship-weekend');

    expect(view.offers.map((each) => each.closesAt.toISOString())).toEqual([
      '2027-01-24T20:00:00.000Z', '2027-01-16T21:30:00.000Z', '2027-01-16T21:30:00.000Z',
    ]);
    expect(eventPagesChangeAt([view])).toEqual(new Date('2027-01-16T21:30:00.000Z'));
    expect(eventPagesChangeAt([{ page: PAGE, offers: [] }])).toBeNull();
  });

  it('asks about a bracket from the offer\'s own starting round, over its template\'s, and about anything else with none', async () => {
    const { service, asked } = build({ editions: { 'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z')] } });

    const view = await service.getPage(Sport.AMERICAN_FOOTBALL, 'championship-weekend');

    expect(asked.map((each) => each.setup)).toEqual([
      { selectionType: SelectionType.BRACKET, startsAtRound: 3 },
      { selectionType: SelectionType.SQUARES, startsAtRound: null },
    ]);
    expect(view.offers.map((each) => each.startsAtRound)).toEqual([3, null]);
  });

  it('takes a bracket\'s starting round from its template when the offer names none', async () => {
    const { service } = build({
      offers: [{ ...BRACKET, bracketStartRound: null }],
      editions: { 'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z')] },
    });

    expect((await service.getPage(Sport.AMERICAN_FOOTBALL, 'championship-weekend')).offers[0]?.startsAtRound).toBe(2);
  });

  it('skips an edition past the contest\'s cutoff for the next one, and leaves out an offer with none left', async () => {
    const { service } = build({
      editions: {
        'cw/Conference Championships': [edition('cw-2027', '2027-01-24T20:00:00.000Z'), edition('cw-2028', '2028-01-23T20:00:00.000Z')],
        'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
      openings: { 'cw-2027': ContestOpening.CLOSED, 'cw-2028': ContestOpening.NOT_YET, 'playoffs-2027': ContestOpening.CLOSED },
    });

    const view = await service.getPage(Sport.AMERICAN_FOOTBALL, 'championship-weekend');

    expect(view.offers.map((each) => [each.offer.id, each.edition.sportEventId, each.state])).toEqual([
      ['clutch-card', 'cw-2028', EventPageOfferState.NOT_YET],
    ]);
  });

  it('shows an active page between seasons with no offers', async () => {
    const { service } = build({});

    const view = await service.getPage(Sport.AMERICAN_FOOTBALL, 'championship-weekend');

    expect([view.page.isActive, view.offers]).toEqual([true, []]);
  });

  it('answers a retired page with its successor and no offers, without reading its offers\' editions', async () => {
    const { service, asked } = build({ pages: [PAGE, RETIRED], offers: [{ ...SQUARES, eventPageId: RETIRED.id }] });

    const view = await service.getPage(Sport.AMERICAN_FOOTBALL, 'conference-weekend');

    expect([view.page.redirectTo, view.offers, asked]).toEqual([{ sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend' }, [], []]);
  });

  it('refuses an address no page has with EventPageNotFoundError', async () => {
    const { service } = build({});

    await expect(service.getPage(Sport.AMERICAN_FOOTBALL, 'super-bowl')).rejects.toBeInstanceOf(EventPageNotFoundError);
    await expect(service.getPage(Sport.BASKETBALL, 'championship-weekend')).rejects.toBeInstanceOf(EventPageNotFoundError);
  });

  it('lists only the active pages of the sport asked for, each with its own offers', async () => {
    const other: EventPage = { ...PAGE, id: 'page-finals', sport: Sport.BASKETBALL, slug: 'nba-finals' };
    const { service } = build({
      pages: [PAGE, RETIRED, other],
      offers: [SQUARES, { ...SQUARES, id: 'finals-squares', eventPageId: other.id, sportLeagueId: 'nba' }],
      editions: { 'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z')] },
    });

    const football = await service.listPages(Sport.AMERICAN_FOOTBALL);
    const every = await service.listPages();

    expect(football.map((view) => [view.page.slug, view.offers.map((each) => each.offer.id)])).toEqual([['championship-weekend', ['squares']]]);
    expect(every.map((view) => view.page.slug)).toEqual(['championship-weekend', 'nba-finals']);
  });
  it('finds the page offering each event, the first page in display order winning, and leaves out a retired page and an edition no offer shows', async () => {
    const LATER: EventPage = { ...PAGE, id: 'page-later', slug: 'playoffs', displayOrder: 40 };
    const { service } = build({
      pages: [PAGE, LATER, { ...RETIRED, isActive: false }],
      offers: [CLUTCH_CARD, SQUARES, { ...SQUARES, id: 'later-squares', eventPageId: LATER.id }, { ...SQUARES, id: 'retired-squares', eventPageId: RETIRED.id }],
      editions: {
        'cw/Conference Championships': [edition('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl/NFL Playoffs': [edition('playoffs-2027', '2027-01-09T18:00:00.000Z'), edition('playoffs-2028', '2028-01-08T18:00:00.000Z')],
      },
    });

    const pages = await service.pagesByEvent();

    expect([...pages].map(([sportEventId, page]) => [sportEventId, page.id])).toEqual([
      ['cw-2027', PAGE.id],
      ['playoffs-2027', PAGE.id],
    ]);
  });
});
