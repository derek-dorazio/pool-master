/**
 * #2042 — an event page answers with its address read from the stored URL segments: its sport's
 * and its own, and the path built from both, for the page and for the page a retired one sends
 * readers on to.
 */
import { ContestFormat, EventPageOfferState, SelectionType, Sport, type EventPage, type EventPageOffer } from '@poolmaster/shared/domain';
import { toEventPageDto } from '../../../packages/core-api/src/mappers/event-pages.mapper';

const STAMP = new Date('2026-10-01T00:00:00.000Z');
const CURRENT: EventPage = { id: 'page-cw', sport: Sport.AMERICAN_FOOTBALL, sportUrlSegment: 'american-football', urlSegment: 'championship-weekend', displayOrder: 20, isActive: true, redirectTo: null };
const RETIRED: EventPage = {
  id: 'page-old', sport: Sport.AMERICAN_FOOTBALL, sportUrlSegment: 'american-football', urlSegment: 'conference-weekend', displayOrder: 30, isActive: false,
  redirectTo: { sport: Sport.AMERICAN_FOOTBALL, sportUrlSegment: 'american-football', urlSegment: 'championship-weekend' },
};
const OFFER: EventPageOffer = {
  id: 'tiered',
  eventPageId: CURRENT.id,
  sportLeagueId: 'cw',
  sportLeagueName: 'Championship Weekend',
  eventSeriesName: 'Conference Championships',
  template: {
    id: 'cw-tiered',
    sport: Sport.AMERICAN_FOOTBALL,
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
    eventSeriesNames: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  bracketStartRound: null,
  sortOrder: 1,
  isPrimary: true,
};

describe('toEventPageDto (#2042)', () => {
  it('answers a page with its stored segments and the path built from them, and each edition\'s end date, or null when it has none', () => {
    const dto = toEventPageDto({
      page: CURRENT,
      offers: [{
        offer: OFFER, startsAtRound: null, state: EventPageOfferState.OPEN, closesAt: STAMP,
        edition: { sportEventId: 'cw-2027', name: 'Conference Championships', eventYear: 2027, startDate: STAMP, endDate: new Date('2026-10-02T00:00:00.000Z') },
      }, {
        offer: { ...OFFER, id: 'tiered-open-ended' }, startsAtRound: null, state: EventPageOfferState.NOT_YET, closesAt: STAMP,
        edition: { sportEventId: 'cw-2028', name: 'Conference Championships', eventYear: 2028, startDate: STAMP, endDate: null },
      }],
    });

    expect([dto.sportUrlSegment, dto.urlSegment, dto.path, dto.redirectTo, dto.offers.map((offer) => offer.edition.endDate)])
      .toEqual(['american-football', 'championship-weekend', '/play/american-football/championship-weekend', null, ['2026-10-02T00:00:00.000Z', null]]);
  });

  it('answers a retired page with the address of the page it sends readers on to, path included', () => {
    const dto = toEventPageDto({ page: RETIRED, offers: [] });

    expect(dto.redirectTo).toEqual({ sport: Sport.AMERICAN_FOOTBALL, sportUrlSegment: 'american-football', urlSegment: 'championship-weekend', path: '/play/american-football/championship-weekend' });
  });
});
