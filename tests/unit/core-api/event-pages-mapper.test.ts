/**
 * #2042 — an event page answers with its address read from the stored URL segments: its sport's
 * and its own, and the path built from both, for the page and for the page a retired one sends
 * readers on to.
 */
import { ContestFormat, ContestOpeningReason, EventPageOfferState, SelectionType, Sport, type EventPage, type EventPageOffer, TemplateCoverageMode } from '@poolmaster/shared/domain';
import { toEventPageDto } from '../../../packages/core-api/src/mappers/event-pages.mapper';

const STAMP = new Date('2026-10-01T00:00:00.000Z');
const CURRENT: EventPage = { id: 'page-cw', sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'championship-weekend', displayOrder: 20, isActive: true, redirectTo: null, sportLeagueId: 'cw', sportLeagueName: 'Championship Weekend', sportLeagueCompetitionSlotId: 'conference-championships' };
const RETIRED: EventPage = {
  id: 'page-old', sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'conference-weekend', displayOrder: 30, isActive: false,
  redirectTo: { sport: Sport.FOOTBALL, sportUrlSegment: 'football', urlSegment: 'championship-weekend' },
  sportLeagueId: 'cw', sportLeagueName: 'Championship Weekend', sportLeagueCompetitionSlotId: 'conference-championships',
};
const OFFER: EventPageOffer = {
  id: 'tiered',
  eventPageId: CURRENT.id,
  template: {
    id: 'cw-tiered',
    coverageMode: TemplateCoverageMode.ONE_SLOT,
    slots: [],
    sportLeagueId: 'cw',
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
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  sortOrder: 1,
  isPrimary: true,
};

describe('toEventPageDto (#2042)', () => {
  it('answers a page with its stored segments and the path built from them, its sport\'s name, its sport league and slot definition (#2050), and each offer\'s next slot with its end date, or null when it has none', () => {
    const dto = toEventPageDto({
      page: CURRENT,
      offers: [{
        offer: OFFER, state: EventPageOfferState.OPEN, waitingFor: null, closesAt: STAMP,
        nextSlot: { seasonSlotId: 'cw-slot-2027', sportEventId: 'cw-2027', name: 'Conference Championships', championshipYear: 2027, startDate: STAMP, endDate: new Date('2026-10-02T00:00:00.000Z') },
      }, {
        offer: { ...OFFER, id: 'tiered-open-ended' }, state: EventPageOfferState.NOT_YET, waitingFor: ContestOpeningReason.FIELD_NOT_LOADED, closesAt: STAMP,
        nextSlot: { seasonSlotId: 'cw-slot-2028', sportEventId: 'cw-2028', name: 'Conference Championships', championshipYear: 2028, startDate: STAMP, endDate: null },
      }],
    });

    expect([dto.sportName, dto.sportUrlSegment, dto.urlSegment, dto.path, dto.redirectTo, dto.sportLeagueName, dto.sportLeagueCompetitionSlotId, dto.offers.map((offer) => [offer.nextSlot.seasonSlotId, offer.nextSlot.endDate, offer.waitingFor])])
      .toEqual(['Football', 'football', 'championship-weekend', '/play/football/championship-weekend', null, 'Championship Weekend', 'conference-championships', [['cw-slot-2027', '2026-10-02T00:00:00.000Z', null], ['cw-slot-2028', null, 'FIELD_NOT_LOADED']]]);
  });

  it('answers a retired page with the address of the page it sends readers on to, its sport\'s name and path included', () => {
    const dto = toEventPageDto({ page: RETIRED, offers: [] });

    expect(dto.redirectTo).toEqual({ sport: Sport.FOOTBALL, sportName: 'Football', sportUrlSegment: 'football', urlSegment: 'championship-weekend', path: '/play/football/championship-weekend' });
  });
});
