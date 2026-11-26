import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  getSportDefinition,
  MatchStatus,
  providerCodeOfSourceId,
  providerSourceIdOf,
  SportEventStatus,
  TournamentFormat,
  type ProviderCode,
  type Sport,
} from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './provider-registry';
import type { IngestionScheduledEventReader, LiveScoreEventRef } from './ingestion-scheduler';
import type { EventSyncFeed } from './sync-orchestrator';
import { sportEventSportWhere } from '../../../adapters/sport-of';

/** How many upcoming events per provider a field sync pass loads. */
const FIELD_EVENTS_PER_PROVIDER = 2;

/** How long a round with no recorded end is taken to be under way after it starts (#1499). */
export const ROUND_WITHOUT_END_UNDERWAY_MS = 14 * 60 * 60 * 1000;

export interface ScheduledEventReaderDependencies {
  prisma: Pick<PrismaClient, 'sportEvent' | 'sport' | 'sportEventRoundMatchGame'>;
  registry: Pick<ProviderRegistry, 'all'>;
  logger?: FastifyBaseLogger;
}

export function createScheduledEventReader({
  prisma,
  registry,
  logger,
}: ScheduledEventReaderDependencies): IngestionScheduledEventReader {
  return {
    async listEventsForFeed({ sport, feed, from, now, to }) {
      logger?.debug({
        sport,
        feed,
        from: from?.toISOString() ?? null,
        now: now.toISOString(),
        to: to?.toISOString() ?? null,
      }, 'Listing sport events for scheduled ingestion feed');

      // Each running provider syncs the events of the leagues whose selected mapping names it (#2073).
      const providerIds = servingProviderIds(sport, feed);
      // Each provider loads the fields of its own next two events, so one provider's earlier
      // events never hold another's back.
      const rows = (await Promise.all(providerIds.map(async (providerId) => {
        // Events and leagues name a provider by its row (#1997, #2004); a provider with none syncs no event.
        const code = providerCodeOfSourceId(providerId);
        if (code === undefined) return [];
        // poolmaster-allow-query-in-loop: once per running provider, one or two
        const events = await prisma.sportEvent.findMany({
          where: {
            providerMappings: { some: { provider: { code } } },
            // A field loads while the event is a draft or released and not yet started (#431).
            status: { in: [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED] },
            startDate: {
              gte: from ?? now,
              ...(to ? { lte: to } : {}),
            },
            // The sport's events (#2042), of a synced league only: its sync names this provider
            // (ADR 0011, #1726, #2086). Both through the event's Season (#2004), in one clause, so
            // neither filter replaces the other.
            sportLeagueSeason: {
              sportLeague: {
                sport: { sport },
                isActive: true,
                selectedProviderMapping: { is: { providerLeague: { provider: { code } } } },
              },
            },
          },
          orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
          take: FIELD_EVENTS_PER_PROVIDER,
          select: { providerMappings: { where: { provider: { code } }, select: { externalId: true } } },
        });
        return events.flatMap((event) => event.providerMappings.map((mapping) => ({ providerId, externalId: mapping.externalId })));
      }))).flat();
      logger?.debug({
        sport,
        feed,
        providerIds,
        eventCount: rows.length,
        events: rows,
      }, 'Listed sport events for scheduled ingestion feed');
      return rows;
    },

    async listLiveScoreEvents({ sport, now }) {
      const feed = 'EVENTLIVESCORES';
      const providerIds = servingProviderIds(sport, feed);
      if (providerIds.length === 0) return [];
      const codes = providerIds.flatMap((providerId) => {
        const code = providerCodeOfSourceId(providerId);
        return code === undefined ? [] : [code];
      });
      if (codes.length === 0) return [];
      // Scores poll every in-progress event at once, by each running provider's id for it.
      const where = {
        ...sportEventSportWhere(sport),
        providerMappings: { some: { provider: { code: { in: codes } } } },
        status: SportEventStatus.IN_PROGRESS,
        sportEventParticipants: { some: {} },
      };
      const identity = {
        id: true,
        providerMappings: {
          where: { provider: { code: { in: codes } } },
          select: { externalId: true, provider: { select: { code: true } }, sportLeagueProviderMapping: { select: { providerLeague: { select: { code: true } } } } },
        },
      } as const;
      // A sport played in matches is in play during a match: the one in progress longest. One
      // played without them, such as golf, is in play during a round: the round started last,
      // the one under way if any is.
      const playedInRounds = getSportDefinition(sport).tournamentFormat !== TournamentFormat.MATCHES;
      const events: LiveScoreEventRef[] = playedInRounds
        ? (await prisma.sportEvent.findMany({
            where,
            select: {
              ...identity,
              // An event played in rounds hears of its rounds on the event itself (a golf round's notification).
              lastProviderNotificationAt: true,
              roundSchedule: {
                where: { scheduledDate: { lte: now } },
                orderBy: { roundNumber: 'desc' },
                take: 1,
                select: { scheduledDate: true, scheduledEndAt: true },
              },
            },
          })).flatMap(({ id: _id, roundSchedule, providerMappings, ...event }) => refsOf(providerMappings).map((ref) => ({ ...event, ...ref, playedInRounds, playUnderwaySince: roundUnderwaySince(roundSchedule, now) })))
        : await matchEventRefs(await prisma.sportEvent.findMany({
            where,
            select: {
              ...identity,
              matches: {
                where: { status: MatchStatus.IN_PROGRESS },
                orderBy: { scheduledDate: { sort: 'asc', nulls: 'last' } },
                take: 1,
                select: { scheduledDate: true },
              },
            },
          }));
      logger?.debug({ sport, feed, providerIds, eventCount: events.length, events }, 'Listed sport events for scheduled ingestion feed');
      return events;
    },

    async listSyncedSports({ providerCodes }) {
      const rows = await prisma.sport.findMany({
        where: {
          sportLeagues: {
            some: { isActive: true, selectedProviderMapping: { is: { providerLeague: { provider: { code: { in: [...providerCodes] } } } } } },
          },
        },
        select: { sport: true },
        orderBy: { displayOrder: 'asc' },
      });
      return rows.map((row) => row.sport);
    },
  };

  /**
   * Each event played in matches with its ids, when play got under way, and when a provider last
   * sent a notification about any of its Games (#2007): one read of the Games for every event.
   */
  async function matchEventRefs(rows: ReadonlyArray<{
    id: string;
    providerMappings: Parameters<typeof refsOf>[0];
    matches: Array<{ scheduledDate: Date | null }>;
  }>): Promise<LiveScoreEventRef[]> {
    const heard = rows.length === 0 ? [] : await prisma.sportEventRoundMatchGame.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: rows.map((row) => row.id) } },
      _max: { lastProviderNotificationAt: true },
    });
    const lastHeardOf = new Map(heard.map((row) => [row.sportEventId, row._max.lastProviderNotificationAt]));
    return rows.flatMap(({ id, matches, providerMappings }) => refsOf(providerMappings).map((ref) => ({
      ...ref,
      lastProviderNotificationAt: lastHeardOf.get(id) ?? null,
      playedInRounds: false,
      playUnderwaySince: matchUnderwaySince(matches),
    })));
  }

  /** The running providers' ids, as their feeds name them: each syncs only the leagues that select it. */
  function servingProviderIds(sport: Sport, feed: EventSyncFeed): string[] {
    const providerIds = registry.all().map((provider) => provider.providerId);
    if (providerIds.length === 0) {
      logger?.warn({ sport, feed }, 'Skipping scheduled event feed because no provider is running');
    }
    return providerIds;
  }
}

/** An event's ids at the providers serving its sport, as the adapters key them, with the provider league each is under. */
function refsOf(mappings: ReadonlyArray<{
  externalId: string;
  provider: { code: ProviderCode };
  sportLeagueProviderMapping: { providerLeague: { code: string } };
}>): Array<{ providerId: string; externalId: string; providerLeagueCode: string }> {
  return mappings.map((mapping) => ({
    providerId: providerSourceIdOf(mapping.provider.code),
    externalId: mapping.externalId,
    providerLeagueCode: mapping.sportLeagueProviderMapping.providerLeague.code,
  }));
}

/**
 * When the round now under way began (#1499), or null when none is: the latest started round,
 * until its scheduled end, or `ROUND_WITHOUT_END_UNDERWAY_MS` after its start with none recorded.
 */
function roundUnderwaySince(rounds: { scheduledDate: Date; scheduledEndAt: Date | null }[], now: Date): Date | null {
  // poolmaster-allow-position: the query takes the one latest started round (roundNumber desc, take 1)
  const round = rounds.at(0);
  if (round === undefined) return null;
  const endsAt = round.scheduledEndAt ?? new Date(round.scheduledDate.getTime() + ROUND_WITHOUT_END_UNDERWAY_MS);
  return now < endsAt ? round.scheduledDate : null;
}

/**
 * When the match in progress longest began (#1499): its scheduled start. Null when no match is in
 * progress, or none has a scheduled start, since a row's last change is not when play began.
 */
function matchUnderwaySince(matches: { scheduledDate: Date | null }[]): Date | null {
  // poolmaster-allow-position: the query takes the one match in progress longest (scheduledDate asc, take 1)
  const match = matches.at(0);
  return match?.scheduledDate ?? null;
}
