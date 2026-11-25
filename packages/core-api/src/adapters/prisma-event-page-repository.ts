/**
 * Prisma adapter for the EventPageRepository port (#1007).
 */
import type { PrismaClient } from '@prisma/client';
import type { EventPageRepository, EventPageSeries } from '@poolmaster/shared/db';
import {
  SportEventStatus,
  type EventPage,
  type EventPageAddress,
  type EventPageEdition,
  type EventPageOffer,
  type Sport,
  NOT_OVER_SPORT_EVENT_STATUSES,
} from '@poolmaster/shared/domain';
import { mapContestConfigTemplate, TEMPLATE_INCLUDE } from './prisma-contest-management-repositories';

/** A page's address reads its sport's stored URL segment (#2042). */
const ADDRESS_SELECT = { sport: true, urlSegment: true, sportConfig: { select: { urlSegment: true } } } as const;
const PAGE_INCLUDE = { sportConfig: { select: { urlSegment: true } }, redirectTo: { select: ADDRESS_SELECT } } as const;

interface AddressRow {
  sport: Sport;
  urlSegment: string;
  sportConfig: { urlSegment: string };
}

function mapAddress(row: AddressRow): EventPageAddress {
  return { sport: row.sport, sportUrlSegment: row.sportConfig.urlSegment, urlSegment: row.urlSegment };
}

function mapEventPage(row: AddressRow & {
  id: string;
  displayOrder: number;
  isActive: boolean;
  redirectTo: AddressRow | null;
}): EventPage {
  return {
    id: row.id,
    ...mapAddress(row),
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    redirectTo: row.redirectTo === null ? null : mapAddress(row.redirectTo),
  };
}

export class PrismaEventPageRepository implements EventPageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUrlSegments(sportUrlSegment: string, urlSegment: string): Promise<EventPage | null> {
    const row = await this.prisma.eventPage.findFirst({
      where: { urlSegment, sportConfig: { urlSegment: sportUrlSegment } },
      include: PAGE_INCLUDE,
    });
    return row === null ? null : mapEventPage(row);
  }

  async findActive(sport?: Sport): Promise<EventPage[]> {
    // Grouped by sport in the sports' own display order, then each sport's pages in theirs.
    const rows = await this.prisma.eventPage.findMany({
      where: { isActive: true, ...(sport !== undefined && { sport }) },
      include: PAGE_INCLUDE,
      orderBy: [{ sportConfig: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { urlSegment: 'asc' }],
    });
    return rows.map(mapEventPage);
  }

  async findOffers(eventPageIds: readonly string[]): Promise<EventPageOffer[]> {
    if (eventPageIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.eventPageOffer.findMany({
      // A disabled setup is left out, as Create contest refuses it, and so is a switched-off
      // sport league's offer (#1812), as Create contest offers none of its events.
      where: { eventPageId: { in: [...eventPageIds] }, template: { active: true }, sportLeague: { isActive: true } },
      include: { template: { include: TEMPLATE_INCLUDE }, sportLeague: { select: { name: true, displayName: true } } },
      orderBy: [{ eventPageId: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      eventPageId: row.eventPageId,
      sportLeagueId: row.sportLeagueId,
      sportLeagueName: row.sportLeague.displayName ?? row.sportLeague.name,
      eventSeriesName: row.eventSeriesName,
      template: mapContestConfigTemplate(row.template),
      bracketStartRound: row.bracketStartRound,
      sortOrder: row.sortOrder,
      isPrimary: row.isPrimary,
    }));
  }

  async findEditionsNotOver(series: readonly EventPageSeries[]): Promise<EventPageEdition[][]> {
    if (series.length === 0) return [];
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        eventSeries: { OR: series.map(({ sportLeagueId, eventSeriesName }) => ({ sportLeagueId, name: eventSeriesName })) },
        status: { in: [...NOT_OVER_SPORT_EVENT_STATUSES] },
      },
      select: {
        id: true, name: true, sportLeagueSeason: { select: { championshipYear: true } }, startDate: true, endDate: true, status: true,
        eventSeries: { select: { sportLeagueId: true, name: true } },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return series.map(({ sportLeagueId, eventSeriesName }) => {
      const editions = rows.filter((row) => row.eventSeries.sportLeagueId === sportLeagueId && row.eventSeries.name === eventSeriesName);
      // The edition under way comes first, then the rest soonest first.
      const underWay = editions.filter((row) => row.status === SportEventStatus.IN_PROGRESS);
      const rest = editions.filter((row) => row.status !== SportEventStatus.IN_PROGRESS);
      return [...underWay, ...rest].map((row) => ({
        sportEventId: row.id,
        name: row.name,
        championshipYear: row.sportLeagueSeason.championshipYear,
        startDate: row.startDate,
        endDate: row.endDate,
      }));
    });
  }
}
