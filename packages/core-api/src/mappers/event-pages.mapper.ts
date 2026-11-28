import { buildEventPagePath, getSportDefinition, type EventPageAddress } from '@poolmaster/shared/domain';
import type { EventPageDto, EventPageOfferDto } from '@poolmaster/shared/dto';
import type { EventPageOfferView, EventPageView } from '../modules/event-pages/service';
import { mapContestConfigTemplateDto } from './contest-management.mapper';

export function toEventPageOfferDto(view: EventPageOfferView): EventPageOfferDto {
  return {
    id: view.offer.id,
    template: mapContestConfigTemplateDto(view.offer.template),
    sortOrder: view.offer.sortOrder,
    isPrimary: view.offer.isPrimary,
    state: view.state,
    nextSlot: {
      seasonSlotId: view.nextSlot.seasonSlotId,
      sportEventId: view.nextSlot.sportEventId,
      name: view.nextSlot.name,
      championshipYear: view.nextSlot.championshipYear,
      startDate: view.nextSlot.startDate.toISOString(),
      endDate: view.nextSlot.endDate?.toISOString() ?? null,
    },
  };
}

function toAddressDto(address: EventPageAddress) {
  return {
    sport: address.sport,
    sportName: getSportDefinition(address.sport).name,
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
    sportLeagueId: view.page.sportLeagueId,
    sportLeagueName: view.page.sportLeagueName,
    sportLeagueCompetitionSlotId: view.page.sportLeagueCompetitionSlotId,
    offers: view.offers.map(toEventPageOfferDto),
  };
}
