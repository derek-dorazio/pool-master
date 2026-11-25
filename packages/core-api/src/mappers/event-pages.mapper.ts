import { buildEventPagePath, type EventPageAddress } from '@poolmaster/shared/domain';
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
      championshipYear: view.edition.championshipYear,
      startDate: view.edition.startDate.toISOString(),
      endDate: view.edition.endDate?.toISOString() ?? null,
    },
  };
}

function toAddressDto(address: EventPageAddress) {
  return {
    sport: address.sport,
    sportUrlSegment: address.sportUrlSegment,
    urlSegment: address.urlSegment,
    path: buildEventPagePath(address),
  };
}

export function toEventPageDto(view: EventPageView): EventPageDto {
  return {
    id: view.page.id,
    ...toAddressDto(view.page),
    displayOrder: view.page.displayOrder,
    isActive: view.page.isActive,
    redirectTo: view.page.redirectTo === null ? null : toAddressDto(view.page.redirectTo),
    offers: view.offers.map(toEventPageOfferDto),
  };
}
