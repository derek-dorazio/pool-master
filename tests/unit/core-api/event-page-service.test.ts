/**
 * Event pages (#1007): a page's offers, each with its slot definition's first Season slot still
 * able to take the contest (#2010), and retired pages and unknown addresses.
 */
import type { EventPageRepository } from '@poolmaster/shared/db';
import {
  ContestFormat,
  ContestOpening,
  ContestOpeningReason,
  EventPageOfferState,
  SelectionType,
  Sport,
  TemplateCoverageMode,
  type ContestConfigTemplate,
  type EventPage,
  type EventPageNextSlot,
  type EventPageOffer,
} from '@poolmaster/shared/domain';
import type { ContestOpeningSetup } from '../../../packages/core-api/src/modules/contest-management/contest-opening';
import { EventPageNotFoundError, EventPageService, eventPagesChangeAt } from '../../../packages/core-api/src/modules/event-pages/service';

const STAMP = new Date('2026-10-01T00:00:00.000Z');
const DEFAULT_CLOSES_AT = new Date('2027-01-09T18:00:00.000Z');

function template(id: string, configJson: ContestConfigTemplate['configJson']): ContestConfigTemplate {
  return {
    id,
    sportLeagueId: 'nfl',
    coverageMode: TemplateCoverageMode.ONE_SLOT,
    slots: [],
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
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const PAGE: EventPage = { id: 'page-cw', sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'championship-weekend', displayOrder: 20, isActive: true, redirectTo: null, sportLeagueId: 'nfl', sportLeagueName: 'NFL', sportLeagueCompetitionSlotId: 'conference-championships' };
const RETIRED: EventPage = { id: 'page-old', sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'conference-weekend', displayOrder: 30, isActive: false, redirectTo: { sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'championship-weekend' }, sportLeagueId: 'nfl', sportLeagueName: 'NFL', sportLeagueCompetitionSlotId: 'conference-championships' };

function offer(id: string, overrides: Partial<EventPageOffer>): EventPageOffer {
  return {
    id,
    eventPageId: PAGE.id,
    template: template(`${id}-template`, { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 }),
    sortOrder: 1,
    isPrimary: false,
    ...overrides,
  };
}

const TIERED = offer('tiered', {
  template: template('cw-tiered', { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }),
  isPrimary: true,
});
const BRACKET = offer('bracket', {
  template: template('nfl-bracket', { selectionType: SelectionType.BRACKET }),
  sortOrder: 2,
});
const SQUARES = offer('squares', { sortOrder: 3 });

function nextSlot(sportEventId: string, startDate: string): EventPageNextSlot {
  return { seasonSlotId: `slot-${sportEventId}`, sportEventId, name: sportEventId, championshipYear: 2027, startDate: new Date(startDate), endDate: null };
}

function build(options: {
  pages?: EventPage[];
  offers?: EventPageOffer[];
  slots?: Record<string, EventPageNextSlot[]>;
  openings?: Record<string, ContestOpening>;
  closesAt?: Record<string, Date>;
}) {
  const pages = options.pages ?? [PAGE];
  const offers = options.offers ?? [TIERED, BRACKET, SQUARES];
  const repo: EventPageRepository = {
    findByUrlSegments: (sportUrlSegment, urlSegment) => Promise.resolve(pages.find((page) => page.sportUrlSegment === sportUrlSegment && page.urlSegment === urlSegment) ?? null),
    findActive: (sport) => Promise.resolve(pages.filter((page) => page.isActive && (sport === undefined || page.sport === sport))),
    findOffers: (ids) => Promise.resolve(offers.filter((each) => ids.includes(each.eventPageId))),
    findSlotsNotOver: (definitionIds) => {
      reads.slots += 1;
      return Promise.resolve(definitionIds.map((definitionId) => options.slots?.[definitionId] ?? []));
    },
  };
  const asked: Array<{ sportEventId: string; setup: ContestOpeningSetup }> = [];
  const reads = { slots: 0, openings: 0 };
  const service = new EventPageService({
    pages: repo,
    openings: () => {
      reads.openings += 1;
      return (sportEventId, setup) => {
        asked.push({ sportEventId, setup });
        // Keyed by the event, or by the event and the setup's selection type for one setup alone.
        const key = `${sportEventId}:${setup.selectionType}`;
        const opening = options.openings?.[key] ?? options.openings?.[sportEventId] ?? ContestOpening.OPEN;
        const closesAt = opening === ContestOpening.CLOSED ? null : options.closesAt?.[key] ?? options.closesAt?.[sportEventId] ?? DEFAULT_CLOSES_AT;
        // A NOT_YET offer waits for release here; the reason is passed through as the API gives it.
        const reason = opening === ContestOpening.OPEN ? null : opening === ContestOpening.NOT_YET ? ContestOpeningReason.EVENT_NOT_RELEASED : ContestOpeningReason.EVENT_STARTED;
        return Promise.resolve({ opening, reason, closesAt });
      };
    },
  });
  return { service, asked, reads };
}

describe('EventPageService', () => {
  it('reads every listed page\'s offers\' next slots in one read, and asks their openings from one batch for the whole list (#1316)', async () => {
    const second = { ...PAGE, id: 'page-2', urlSegment: 'wild-card-weekend', displayOrder: 2, sportLeagueCompetitionSlotId: 'nfl-playoffs' };
    const { service, reads, asked } = build({
      pages: [PAGE, second],
      offers: [TIERED, { ...BRACKET, eventPageId: second.id }, SQUARES],
      slots: {
        'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl-playoffs': [nextSlot('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
    });

    const views = await service.listPages(Sport.FOOTBALL);

    expect(views.map((view) => [view.page.id, view.offers.map((each) => each.offer.id)])).toEqual([
      [PAGE.id, ['tiered', 'squares']],
      [second.id, ['bracket']],
    ]);
    expect(reads).toEqual({ slots: 1, openings: 1 });
    expect(asked).toHaveLength(3);
  });

  it('shows each offer with its page\'s slot definition\'s next slot, whether it opens now and what a NOT_YET one waits for, in order (#2050, #2015)', async () => {
    const { service } = build({
      slots: {
        'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl-playoffs': [nextSlot('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
      openings: { 'cw-2027:TIERED': ContestOpening.NOT_YET },
    });

    const view = await service.getPage('football', 'championship-weekend');

    expect(view.offers.map((each) => [each.offer.id, each.nextSlot.sportEventId, each.state, each.waitingFor])).toEqual([
      ['tiered', 'cw-2027', EventPageOfferState.NOT_YET, ContestOpeningReason.EVENT_NOT_RELEASED],
      ['bracket', 'cw-2027', EventPageOfferState.OPEN, null],
      ['squares', 'cw-2027', EventPageOfferState.OPEN, null],
    ]);
  });

  it('carries each offer\'s cutoff, and says the pages change at the soonest one, so no copy is kept past it (#1181)', async () => {
    const { service } = build({
      slots: {
        'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl-playoffs': [nextSlot('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
      closesAt: { 'cw-2027:TIERED': new Date('2027-01-24T20:00:00.000Z'), 'cw-2027': new Date('2027-01-16T21:30:00.000Z') },
    });

    const view = await service.getPage('football', 'championship-weekend');

    expect(view.offers.map((each) => each.closesAt.toISOString())).toEqual([
      '2027-01-24T20:00:00.000Z', '2027-01-16T21:30:00.000Z', '2027-01-16T21:30:00.000Z',
    ]);
    expect(eventPagesChangeAt([view])).toEqual(new Date('2027-01-16T21:30:00.000Z'));
    expect(eventPagesChangeAt([{ page: PAGE, offers: [] }])).toBeNull();
  });

  it('asks about each offer by its template\'s selection type and the Season slot it would start at (#2015)', async () => {
    const { service, asked } = build({ slots: { 'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z')] } });

    await service.getPage('football', 'championship-weekend');

    expect(asked.map((each) => each.setup)).toEqual([
      { selectionType: SelectionType.TIERED, seasonSlotId: 'slot-cw-2027' },
      { selectionType: SelectionType.BRACKET, seasonSlotId: 'slot-cw-2027' },
      { selectionType: SelectionType.SQUARES, seasonSlotId: 'slot-cw-2027' },
    ]);
  });

  it('skips a slot past the contest\'s cutoff for the next one, and leaves out an offer with none left', async () => {
    const { service } = build({
      slots: {
        'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z'), nextSlot('cw-2028', '2028-01-23T20:00:00.000Z')],
        'nfl-playoffs': [nextSlot('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
      openings: { 'cw-2027': ContestOpening.CLOSED, 'cw-2028': ContestOpening.CLOSED, 'cw-2028:TIERED': ContestOpening.NOT_YET },
    });

    const view = await service.getPage('football', 'championship-weekend');

    expect(view.offers.map((each) => [each.offer.id, each.nextSlot.sportEventId, each.state])).toEqual([
      ['tiered', 'cw-2028', EventPageOfferState.NOT_YET],
    ]);
  });

  it('shows an active page between seasons with no offers', async () => {
    const { service } = build({});

    const view = await service.getPage('football', 'championship-weekend');

    expect([view.page.isActive, view.offers]).toEqual([true, []]);
  });

  it('answers a retired page with its successor and no offers, without reading its offers\' slots', async () => {
    const { service, asked } = build({ pages: [PAGE, RETIRED], offers: [{ ...SQUARES, eventPageId: RETIRED.id }] });

    const view = await service.getPage('football', 'conference-weekend');

    expect([view.page.redirectTo, view.offers, asked]).toEqual([{ sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'championship-weekend' }, [], []]);
  });

  it('refuses an address no page has with EventPageNotFoundError', async () => {
    const { service } = build({});

    await expect(service.getPage('football', 'super-bowl')).rejects.toBeInstanceOf(EventPageNotFoundError);
    await expect(service.getPage('basketball', 'championship-weekend')).rejects.toBeInstanceOf(EventPageNotFoundError);
  });

  it('lists only the active pages of the sport asked for, each with its own offers', async () => {
    const other: EventPage = { ...PAGE, id: 'page-finals', sport: Sport.BASKETBALL, sportUrlSegment: 'basketball', urlSegment: 'nba-finals', sportLeagueId: 'nba', sportLeagueName: 'NBA', sportLeagueCompetitionSlotId: 'nba-finals' };
    const { service } = build({
      pages: [PAGE, RETIRED, other],
      offers: [SQUARES, { ...SQUARES, id: 'finals-squares', eventPageId: other.id }],
      slots: { 'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z')], 'nba-finals': [nextSlot('finals-2027', '2027-06-03T00:30:00.000Z')] },
    });

    const football = await service.listPages(Sport.FOOTBALL);
    const every = await service.listPages();

    expect(football.map((view) => [view.page.urlSegment, view.offers.map((each) => each.offer.id)])).toEqual([['championship-weekend', ['squares']]]);
    expect(every.map((view) => view.page.urlSegment)).toEqual(['championship-weekend', 'nba-finals']);
  });

  it('lists only the pages whose primary offer shows a slot coming, soonest first, when asked for the upcoming ones (#1202)', async () => {
    const superBowl: EventPage = { ...PAGE, id: 'page-sb', urlSegment: 'super-bowl', displayOrder: 10, sportLeagueCompetitionSlotId: 'super-bowl' };
    const proBowl: EventPage = { ...PAGE, id: 'page-pb', urlSegment: 'pro-bowl', displayOrder: 30, sportLeagueCompetitionSlotId: 'nfl-playoffs' };
    const between: EventPage = { ...PAGE, id: 'page-between', urlSegment: 'between-seasons', displayOrder: 40, sportLeagueCompetitionSlotId: 'nothing-scheduled' };
    const { service } = build({
      pages: [superBowl, PAGE, proBowl, between],
      offers: [
        { ...TIERED, id: 'sb-card', eventPageId: superBowl.id },
        TIERED,
        // The Pro Bowl's only showing offer is not its primary one, so it has no slot heading it.
        { ...SQUARES, id: 'pb-squares', eventPageId: proBowl.id },
        { ...TIERED, id: 'between-card', eventPageId: between.id },
      ],
      slots: {
        'super-bowl': [nextSlot('sb-2027', '2027-02-07T23:30:00.000Z')],
        'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z')],
        'nfl-playoffs': [nextSlot('playoffs-2027', '2027-01-09T18:00:00.000Z')],
      },
    });

    const upcoming = await service.listPages(Sport.FOOTBALL, true);
    const every = await service.listPages(Sport.FOOTBALL);

    expect(upcoming.map((view) => view.page.urlSegment)).toEqual(['championship-weekend', 'super-bowl']);
    expect(every.map((view) => view.page.urlSegment)).toEqual(['super-bowl', 'championship-weekend', 'pro-bowl', 'between-seasons']);
  });
  it('finds the page offering each event, the first page in display order winning, and leaves out a retired page and a slot no offer shows', async () => {
    const LATER: EventPage = { ...PAGE, id: 'page-later', urlSegment: 'playoffs', displayOrder: 40 };
    const { service } = build({
      pages: [PAGE, LATER, { ...RETIRED, isActive: false }],
      offers: [TIERED, SQUARES, { ...SQUARES, id: 'later-squares', eventPageId: LATER.id }, { ...SQUARES, id: 'retired-squares', eventPageId: RETIRED.id }],
      slots: {
        'conference-championships': [nextSlot('cw-2027', '2027-01-24T20:00:00.000Z'), nextSlot('cw-2028', '2028-01-23T20:00:00.000Z')],
      },
    });

    const pages = await service.pagesByEvent();

    expect([...pages].map(([sportEventId, page]) => [sportEventId, page.id])).toEqual([
      ['cw-2027', PAGE.id],
    ]);
  });
});
