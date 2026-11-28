/**
 * Event pages (#1007, `plans/event-landing-pages.md`): public pages for one event a fan would
 * name, each a curated list of offers. An offer is shown with its slot definition's next Season
 * slot that can still take the contest (#2010), and whether it takes it now; an offer with no such
 * slot is left out.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { EventPageRepository } from '@poolmaster/shared/db';
import {
  ContestOpening,
  type ContestOpeningReason,
  EventPageOfferState,
  type EventPage,
  type EventPageNextSlot,
  type EventPageOffer,
  type Sport,
} from '@poolmaster/shared/domain';
import type { ContestOpeningSetup, ContestOpeningWindow } from '../contest-management/contest-opening';

type EventPageLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn'>;

export class EventPageNotFoundError extends Error {
  readonly code = 'EVENT_PAGE_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'EventPageNotFoundError';
  }
}

/** An offer as the page shows it: with its next Season slot and whether it opens now. */
export interface EventPageOfferView {
  offer: EventPageOffer;
  state: EventPageOfferState;
  /** What a NOT_YET offer waits for (`ContestOpeningReason`); null when OPEN. */
  waitingFor: ContestOpeningReason | null;
  nextSlot: EventPageNextSlot;
  /** When the setup's cutoff on the slot's event falls, after which this offer no longer shows as it does now. */
  closesAt: Date;
}

export interface EventPageView {
  page: EventPage;
  /** The offers that have a Season slot left, in order; none for a retired page. */
  offers: EventPageOfferView[];
}

/** Whether Create contest would take the setup on the event now, and its cutoff (`contestOpening`). */
export type ContestOpeningAsk = (sportEventId: string, setup: ContestOpeningSetup) => Promise<ContestOpeningWindow>;

export interface EventPageServiceDeps {
  pages: EventPageRepository;
  /**
   * The opening question for one page read (#1316): the events it is asked about together are
   * read together, so a page costs the same statements for 2 offers as for 20.
   */
  openings: () => ContestOpeningAsk;
  logger?: EventPageLogger;
}

export class EventPageService {
  private readonly pages: EventPageRepository;
  private readonly openings: EventPageServiceDeps['openings'];
  private readonly logger: EventPageLogger | undefined;

  constructor(deps: EventPageServiceDeps) {
    this.pages = deps.pages;
    this.openings = deps.openings;
    this.logger = deps.logger;
  }

  async getPage(sportUrlSegment: string, urlSegment: string): Promise<EventPageView> {
    this.logger?.debug({ action: 'eventPages.get.enter', sportUrlSegment, urlSegment }, 'Getting event page');
    const page = await this.pages.findByUrlSegments(sportUrlSegment, urlSegment);
    if (page === null) {
      this.logger?.info({ action: 'eventPages.get.notFound', sportUrlSegment, urlSegment }, 'Event page not found');
      throw new EventPageNotFoundError('There is no event page at that address.');
    }
    if (!page.isActive) {
      return { page, offers: [] };
    }
    const offers = await this.pages.findOffers([page.id]);
    return { page, offers: await this.showOffers([page], offers) };
  }

  /**
   * The active pages, by sport then display order; with `upcoming`, only those whose primary offer
   * shows a slot coming, soonest first: what a Coming up row shows (#1202).
   */
  async listPages(sport?: Sport, upcoming = false): Promise<EventPageView[]> {
    this.logger?.debug({ action: 'eventPages.list.enter', sport, upcoming }, 'Listing event pages');
    const pages = await this.pages.findActive(sport);
    const shown = await this.showOffers(pages, await this.pages.findOffers(pages.map((page) => page.id)));
    const views = pages.map((page) => ({ page, offers: shown.filter(({ offer }) => offer.eventPageId === page.id) }));
    if (!upcoming) {
      return views;
    }
    return views
      .flatMap((view) => {
        const primary = view.offers.find(({ offer }) => offer.isPrimary);
        return primary === undefined ? [] : [{ view, startDate: primary.nextSlot.startDate.getTime() }];
      })
      .sort((left, right) => left.startDate - right.startDate)
      .map(({ view }) => view);
  }

  /**
   * The active page each event is offered on, by sport event id: the event an offer shows now
   * (its next Season slot's, still taking the contest). Where two pages offer one event, the
   * first in display order wins. Emails about an event link to its page.
   */
  async pagesByEvent(): Promise<Map<string, EventPage>> {
    const byEvent = new Map<string, EventPage>();
    for (const view of await this.listPages()) {
      for (const offer of view.offers) {
        if (!byEvent.has(offer.nextSlot.sportEventId)) byEvent.set(offer.nextSlot.sportEventId, view.page);
      }
    }
    return byEvent;
  }

  /**
   * The offers that have a Season slot left, in order, each with it. Every offer's slots are read
   * at once and every slot's opening asked side by side, so the reads are the same for any
   * number of offers (#1316).
   */
  private async showOffers(pages: readonly EventPage[], offers: readonly EventPageOffer[]): Promise<EventPageOfferView[]> {
    // Each offer is shown with its page's slot definition (#2050).
    const slots = await this.pages.findSlotsNotOver(pages.map((page) => page.sportLeagueCompetitionSlotId));
    const slotsByPage = new Map(pages.map((page, index) => [page.id, slots[index] ?? []]));
    const askOpening = this.openings();
    const shown = await Promise.all(offers.map((offer) => showOffer(offer, slotsByPage.get(offer.eventPageId) ?? [], askOpening)));
    return shown.filter((view): view is EventPageOfferView => view !== null);
  }
}

/** The offer with its slot definition's first Season slot not past the contest's cutoff, or null when none is left. */
async function showOffer(offer: EventPageOffer, slots: readonly EventPageNextSlot[], askOpening: ContestOpeningAsk): Promise<EventPageOfferView | null> {
  for (const nextSlot of slots) {
    const setup: ContestOpeningSetup = { selectionType: offer.template.selectionType, seasonSlotId: nextSlot.seasonSlotId };
    const { opening, reason, closesAt } = await askOpening(nextSlot.sportEventId, setup);
    if (opening !== ContestOpening.CLOSED && closesAt !== null) {
      const state = opening === ContestOpening.OPEN ? EventPageOfferState.OPEN : EventPageOfferState.NOT_YET;
      return { offer, state, waitingFor: reason, nextSlot, closesAt };
    }
  }
  return null;
}

/**
 * The soonest cutoff among the pages' offers: until then each page shows as it does now, so no
 * copy of it may be kept past it (#1181). Null when no page has an offer.
 */
export function eventPagesChangeAt(views: readonly EventPageView[]): Date | null {
  const cutoffs = views.flatMap((view) => view.offers.map((offer) => offer.closesAt.getTime()));
  return cutoffs.length === 0 ? null : new Date(Math.min(...cutoffs));
}
