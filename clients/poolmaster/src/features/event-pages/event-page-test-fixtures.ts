import type { EventPageDto, EventPageOfferDto } from '@/lib/api';

/** An event page offer as the API sends it, for the event page tests. */
export function offerFixture(templateKey: string, overrides: Partial<EventPageOfferDto> = {}): EventPageOfferDto {
  return {
    id: `offer-${templateKey}`,
    sportLeagueId: 'nfl',
    sportLeagueName: 'NFL',
    eventSeriesName: 'NFL Playoffs',
    template: {
      id: `template-${templateKey}`,
      sport: 'AMERICAN_FOOTBALL',
      sportLeagueId: 'nfl',
      eventType: null,
      contestFormat: 'SQUARES',
      selectionType: 'SQUARES',
      templateKey,
      name: `${templateKey} setup`,
      description: `${templateKey} description.`,
      sortOrder: 1,
      isDefault: true,
      active: true,
      schemaVersion: 1,
      configuration: { selectionType: 'SQUARES', maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 },
    },
    startsAtRound: null,
    sortOrder: 1,
    isPrimary: false,
    state: 'OPEN',
    edition: { sportEventId: `event-${templateKey}`, name: 'NFL Playoffs', championshipYear: 2027, startDate: '2027-01-09T18:00:00.000Z', endDate: null },
    ...overrides,
  };
}

/** Championship Weekend as the API sends it: its bracket still to open, its squares open. */
export function championshipWeekendFixture(overrides: Partial<EventPageDto> = {}): EventPageDto {
  return {
    id: 'page-cw',
    sport: 'AMERICAN_FOOTBALL',
    slug: 'championship-weekend',
    displayOrder: 20,
    isActive: true,
    redirectTo: null,
    offers: [
      offerFixture('nfl-bracket-second-chance-doubling', {
        sportLeagueName: 'NFL',
        eventSeriesName: 'NFL Playoffs',
        isPrimary: true,
        state: 'NOT_YET',
        startsAtRound: 3,
        sortOrder: 2,
        edition: { sportEventId: 'event-cw', name: 'NFL Playoffs', championshipYear: 2027, startDate: '2027-01-24T20:00:00.000Z', endDate: null },
      }),
      offerFixture('nfl-squares', { sortOrder: 3 }),
    ],
    ...overrides,
  };
}
