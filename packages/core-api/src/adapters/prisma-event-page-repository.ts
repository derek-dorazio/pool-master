/**
 * Prisma adapter for the EventPageRepository port (#1007).
 */
import type { PrismaClient } from '@prisma/client';
import type { EventPageRepository } from '@poolmaster/shared/db';
import {
  SportEventStatus,
  type EventPage,
  type EventPageAddress,
  type EventPageNextSlot,
  type EventPageOffer,
  type Sport,
  NOT_OVER_SPORT_EVENT_STATUSES,
} from '@poolmaster/shared/domain';
import { mapContestConfigTemplate, TEMPLATE_INCLUDE } from './prisma-contest-management-repositories';

/** A page's address reads its sport's stored URL segment (#2042). */
const ADDRESS_SELECT = { sport: true, urlSegment: true, sportConfig: { select: { urlSegment: true } } } as const;
const PAGE_INCLUDE = { sportConfig: { select: { urlSegment: true } }, redirectTo: { select: ADDRESS_SELECT }, sportLeague: { select: { name: true } } } as const;

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
  sportLeagueId: string;
  sportLeagueCompetitionSlotId: string;
  sportLeague: { name: string };
}): EventPage {
  return {
    id: row.id,
    ...mapAddress(row),
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    redirectTo: row.redirectTo === null ? null : mapAddress(row.redirectTo),
    sportLeagueId: row.sportLeagueId,
    sportLeagueName: row.sportLeague.name,
    sportLeagueCompetitionSlotId: row.sportLeagueCompetitionSlotId,
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
      where: { eventPageId: { in: [...eventPageIds] }, template: { active: true }, eventPage: { sportLeague: { isActive: true } } },
      include: { template: { include: TEMPLATE_INCLUDE } },
      orderBy: [{ eventPageId: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      eventPageId: row.eventPageId,
      template: mapContestConfigTemplate(row.template),
      sortOrder: row.sortOrder,
      isPrimary: row.isPrimary,
    }));
  }

  async findSlotsNotOver(sportLeagueCompetitionSlotIds: readonly string[]): Promise<EventPageNextSlot[][]> {
    if (sportLeagueCompetitionSlotIds.length === 0) return [];
    // A Season slot is shown through the event that owns it (#2010); one no event owns yet is left out.
    const rows = await this.prisma.sportEventSlot.findMany({
      where: {
        seasonSlot: { sportLeagueCompetitionSlotId: { in: [...new Set(sportLeagueCompetitionSlotIds)] } },
        sportEvent: { status: { in: [...NOT_OVER_SPORT_EVENT_STATUSES] } },
      },
      select: {
        sportLeagueSeasonCompetitionSlotId: true,
        seasonSlot: { select: { sportLeagueCompetitionSlotId: true, season: { select: { championshipYear: true } } } },
        sportEvent: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
      },
      orderBy: [{ sportEvent: { startDate: 'asc' } }, { id: 'asc' }],
    });
    return sportLeagueCompetitionSlotIds.map((definitionId) => {
      const slots = rows.filter((row) => row.seasonSlot.sportLeagueCompetitionSlotId === definitionId);
      // The slot under way comes first, then the rest soonest first.
      const underWay = slots.filter((row) => row.sportEvent.status === SportEventStatus.IN_PROGRESS);
      const rest = slots.filter((row) => row.sportEvent.status !== SportEventStatus.IN_PROGRESS);
      return [...underWay, ...rest].map((row) => ({
        seasonSlotId: row.sportLeagueSeasonCompetitionSlotId,
        sportEventId: row.sportEvent.id,
        name: row.sportEvent.name,
        championshipYear: row.seasonSlot.season.championshipYear,
        startDate: row.sportEvent.startDate,
        endDate: row.sportEvent.endDate,
      }));
    });
  }
}
