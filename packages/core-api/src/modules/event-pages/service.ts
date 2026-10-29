/**
 * Event pages (#1007, `plans/event-landing-pages.md`): public pages for one event a fan would
 * name, each a curated list of offers. An offer is shown with its series' next edition that can
 * still take the contest, and whether it takes it now; an offer with no such edition is left out.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { EventPageRepository } from '@poolmaster/shared/db';
import {
  EventPageOfferState,
  SelectionType,
  type EventPage,
  type EventPageEdition,
  type EventPageOffer,
  type Sport,
} from '@poolmaster/shared/domain';
import { ContestOpening, type ContestOpeningSetup, type ContestOpeningWindow } from '../contest-management/contest-opening';

type EventPageLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn'>;

export class EventPageNotFoundError extends Error {
  readonly code = 'EVENT_PAGE_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'EventPageNotFoundError';
  }
}

/** An offer as the page shows it: with its edition, whether it opens now, and a bracket's starting round. */
export interface EventPageOfferView {
  offer: EventPageOffer;
  startsAtRound: number | null;
  state: EventPageOfferState;
  edition: EventPageEdition;
  /** When the setup's cutoff on the edition falls, after which this offer no longer shows as it does now. */
  closesAt: Date;
}

export interface EventPageView {
  page: EventPage;
  /** The offers that have an edition left, in order; none for a retired page. */
  offers: EventPageOfferView[];
}

export interface EventPageServiceDeps {
  pages: EventPageRepository;
  /** Whether Create contest would take the setup on the event now, and its cutoff (`contestOpening`). */
  opening: (sportEventId: string, setup: ContestOpeningSetup) => Promise<ContestOpeningWindow>;
  logger?: EventPageLogger;
}

/** The round a bracket offer starts at: its own, else its template's; null for any other setup. */
function offerStartsAtRound(offer: EventPageOffer): number | null {
  const rules = offer.template.configJson;
  if (rules.selectionType !== SelectionType.BRACKET) {
    return null;
  }
  return offer.bracketStartRound ?? rules.startsAtRound;
}

export class EventPageService {
  private readonly pages: EventPageRepository;
  private readonly opening: EventPageServiceDeps['opening'];
  private readonly logger: EventPageLogger | undefined;

  constructor(deps: EventPageServiceDeps) {
    this.pages = deps.pages;
    this.opening = deps.opening;
    this.logger = deps.logger;
  }

  async getPage(sport: Sport, slug: string): Promise<EventPageView> {
    this.logger?.debug({ action: 'eventPages.get.enter', sport, slug }, 'Getting event page');
    const page = await this.pages.findBySportSlug(sport, slug);
    if (page === null) {
      this.logger?.info({ action: 'eventPages.get.notFound', sport, slug }, 'Event page not found');
      throw new EventPageNotFoundError('There is no event page at that address.');
    }
    if (!page.isActive) {
      return { page, offers: [] };
    }
    const offers = await this.pages.findOffers([page.id]);
    return { page, offers: await this.showOffers(offers) };
  }

  async listPages(sport?: Sport): Promise<EventPageView[]> {
    this.logger?.debug({ action: 'eventPages.list.enter', sport }, 'Listing event pages');
    const pages = await this.pages.findActive(sport);
    const offers = await this.pages.findOffers(pages.map((page) => page.id));
    return Promise.all(pages.map(async (page) => ({
      page,
      offers: await this.showOffers(offers.filter((offer) => offer.eventPageId === page.id)),
    })));
  }

  /**
   * The active page each event is offered on, by sport event id: the event an offer shows now
   * (its series' next edition still taking the contest). Where two pages offer one event, the
   * first in display order wins. Emails about an event link to its page.
   */
  async pagesByEvent(): Promise<Map<string, EventPage>> {
    const byEvent = new Map<string, EventPage>();
    for (const view of await this.listPages()) {
      for (const offer of view.offers) {
        if (!byEvent.has(offer.edition.sportEventId)) byEvent.set(offer.edition.sportEventId, view.page);
      }
    }
    return byEvent;
  }

  private async showOffers(offers: readonly EventPageOffer[]): Promise<EventPageOfferView[]> {
    const shown = await Promise.all(offers.map((offer) => this.showOffer(offer)));
    return shown.filter((view): view is EventPageOfferView => view !== null);
  }

  /** The offer with its series' first edition not past the contest's cutoff, or null when none is left. */
  private async showOffer(offer: EventPageOffer): Promise<EventPageOfferView | null> {
    const startsAtRound = offerStartsAtRound(offer);
    const setup: ContestOpeningSetup = { selectionType: offer.template.selectionType, startsAtRound };
    const editions = await this.pages.findEditionsNotOver(offer.sportLeagueId, offer.eventSeriesName);
    for (const edition of editions) {
      const { opening, closesAt } = await this.opening(edition.sportEventId, setup);
      if (opening !== ContestOpening.CLOSED && closesAt !== null) {
        const state = opening === ContestOpening.OPEN ? EventPageOfferState.OPEN : EventPageOfferState.NOT_YET;
        return { offer, startsAtRound, state, edition, closesAt };
      }
    }
    return null;
  }
}

/**
 * The soonest cutoff among the pages' offers: until then each page shows as it does now, so no
 * copy of it may be kept past it (#1181). Null when no page has an offer.
 */
export function eventPagesChangeAt(views: readonly EventPageView[]): Date | null {
  const cutoffs = views.flatMap((view) => view.offers.map((offer) => offer.closesAt.getTime()));
  return cutoffs.length === 0 ? null : new Date(Math.min(...cutoffs));
}
