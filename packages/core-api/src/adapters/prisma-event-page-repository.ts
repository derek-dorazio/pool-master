/**
 * Prisma adapter for the EventPageRepository port (#1007).
 */
import type { PrismaClient } from '@prisma/client';
import type { EventPageRepository, EventPageSeries } from '@poolmaster/shared/db';
import {
  SportEventStatus,
  type EventPage,
  type EventPageEdition,
  type EventPageOffer,
  type Sport,
} from '@poolmaster/shared/domain';
import { mapContestConfigTemplate } from './prisma-contest-management-repositories';

const PAGE_INCLUDE = { redirectTo: { select: { sport: true, slug: true } } } as const;

/** The statuses of an edition that is not over: still to open, open, or under way. */
const NOT_OVER_STATUSES: SportEventStatus[] = [
  SportEventStatus.DRAFT,
  SportEventStatus.SCHEDULED,
  SportEventStatus.POSTPONED,
  SportEventStatus.IN_PROGRESS,
];

function mapEventPage(row: {
  id: string;
  sport: Sport;
  slug: string;
  displayOrder: number;
  isActive: boolean;
  redirectTo: { sport: Sport; slug: string } | null;
}): EventPage {
  return {
    id: row.id,
    sport: row.sport,
    slug: row.slug,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    redirectTo: row.redirectTo === null ? null : { sport: row.redirectTo.sport, slug: row.redirectTo.slug },
  };
}

export class PrismaEventPageRepository implements EventPageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportSlug(sport: Sport, slug: string): Promise<EventPage | null> {
    const row = await this.prisma.eventPage.findUnique({
      where: { sport_slug: { sport, slug } },
      include: PAGE_INCLUDE,
    });
    return row === null ? null : mapEventPage(row);
  }

  async findActive(sport?: Sport): Promise<EventPage[]> {
    const rows = await this.prisma.eventPage.findMany({
      where: { isActive: true, ...(sport !== undefined && { sport }) },
      include: PAGE_INCLUDE,
      orderBy: [{ sport: 'asc' }, { displayOrder: 'asc' }, { slug: 'asc' }],
    });
    return rows.map(mapEventPage);
  }

  async findOffers(eventPageIds: readonly string[]): Promise<EventPageOffer[]> {
    if (eventPageIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.eventPageOffer.findMany({
      // A disabled setup is left out, as Create contest refuses it.
      where: { eventPageId: { in: [...eventPageIds] }, template: { active: true } },
      include: { template: true, sportLeague: { select: { name: true, displayName: true } } },
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
        status: { in: NOT_OVER_STATUSES },
      },
      select: {
        id: true, name: true, eventYear: true, startDate: true, endDate: true, status: true,
        eventSeries: { select: { sportLeagueId: true, name: true } },
      },
      orderBy: [{ startDate: 'asc' }, { eventYear: 'asc' }],
    });
    return series.map(({ sportLeagueId, eventSeriesName }) => {
      const editions = rows.filter((row) => row.eventSeries.sportLeagueId === sportLeagueId && row.eventSeries.name === eventSeriesName);
      // The edition under way comes first, then the rest soonest first.
      const underWay = editions.filter((row) => row.status === SportEventStatus.IN_PROGRESS);
      const rest = editions.filter((row) => row.status !== SportEventStatus.IN_PROGRESS);
      return [...underWay, ...rest].map((row) => ({
        sportEventId: row.id,
        name: row.name,
        eventYear: row.eventYear,
        startDate: row.startDate,
        endDate: row.endDate,
      }));
    });
  }
}
