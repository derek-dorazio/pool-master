import type { EventPageDto, EventPageOfferDto } from '@poolmaster/shared/dto';
import type { EventPageOfferView, EventPageView } from '../modules/event-pages/service';
import { mapContestConfigTemplateDto } from './contest-management.mapper';

export function toEventPageOfferDto(view: EventPageOfferView): EventPageOfferDto {
  return {
    id: view.offer.id,
    sportLeagueId: view.offer.sportLeagueId,
    sportLeagueName: view.offer.sportLeagueName,
    eventSeriesName: view.offer.eventSeriesName,
    template: mapContestConfigTemplateDto(view.offer.template),
    startsAtRound: view.startsAtRound,
    sortOrder: view.offer.sortOrder,
    isPrimary: view.offer.isPrimary,
    state: view.state,
    edition: {
      sportEventId: view.edition.sportEventId,
      name: view.edition.name,
      eventYear: view.edition.eventYear,
      startDate: view.edition.startDate.toISOString(),
      endDate: view.edition.endDate?.toISOString() ?? null,
    },
  };
}

export function toEventPageDto(view: EventPageView): EventPageDto {
  return {
    id: view.page.id,
    sport: view.page.sport,
    slug: view.page.slug,
    displayOrder: view.page.displayOrder,
    isActive: view.page.isActive,
    redirectTo: view.page.redirectTo,
    offers: view.offers.map(toEventPageOfferDto),
  };
}
