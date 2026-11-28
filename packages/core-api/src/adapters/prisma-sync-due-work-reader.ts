/**
 * The sync tick's reads (#2009), on Prisma: the Seasons that tell whether each synced league is in
 * season, the slots each plays next, and the linked events whose Games are due or in play. Neither reads an event's status. Each is a fixed few
 * statements however many leagues, slots and Games there are.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { LiveEventView, OverdueGameView, SeasonSpanView, SyncDueWorkReader, SyncedLeagueRef } from '@poolmaster/shared/db';
import { MatchFormat, MatchStatus, overdueStartCutoff, ProviderSyncKind, ProviderSyncRunStatus, type FieldWindowSlot } from '@poolmaster/shared/domain';
import { gameInPlayWhere } from './prisma-game-in-play';

/** An event of one of the leagues, linked under the league's provider mapping. */
function linkedEventOf(leagues: readonly SyncedLeagueRef[]): Prisma.SportEventWhereInput {
  return {
    OR: leagues.map((league) => ({
      sportLeagueId: league.sportLeagueId,
      providerMappings: { some: { sportLeagueProviderMappingId: league.sportLeagueProviderMappingId } },
    })),
  };
}

export class PrismaSyncDueWorkReader implements SyncDueWorkReader {
  constructor(private readonly prisma: Pick<PrismaClient, 'sportLeagueSeason' | 'sportLeagueSeasonCompetitionSlot' | 'sportEventRoundMatchGame' | 'providerSyncRun' | 'sportLeaguePositionProviderMapping'>) {}

  async findSeasonSpans(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<SeasonSpanView[]> {
    if (input.leagues.length === 0) return [];
    return this.prisma.sportLeagueSeason.findMany({
      where: { sportLeagueId: { in: input.leagues.map((league) => league.sportLeagueId) }, endsAt: { gte: input.now } },
      select: { sportLeagueId: true, startsAt: true, endsAt: true },
      orderBy: [{ sportLeagueId: 'asc' }, { startsAt: 'asc' }],
    });
  }

  async findRosteredLeagueIds(input: { leagues: readonly SyncedLeagueRef[] }): Promise<Set<string>> {
    if (input.leagues.length === 0) return new Set();
    const rows = await this.prisma.sportLeaguePositionProviderMapping.findMany({
      where: { sportLeagueProviderMappingId: { in: input.leagues.map((league) => league.sportLeagueProviderMappingId) } },
      select: { sportLeagueId: true },
      distinct: ['sportLeagueId'],
    });
    return new Set(rows.map((row) => row.sportLeagueId));
  }

  async findNextSlots(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<FieldWindowSlot[]> {
    if (input.leagues.length === 0) return [];
    // A synced slot starting after now whose event is linked under its league's provider mapping.
    const unstarted: Prisma.SportLeagueSeasonCompetitionSlotWhereInput = {
      isTestData: false,
      startsAt: { gt: input.now },
      eventSlot: { is: { sportEvent: linkedEventOf(input.leagues) } },
    };
    const firsts = await this.prisma.sportLeagueSeasonCompetitionSlot.groupBy({
      by: ['sportLeagueId'],
      where: unstarted,
      _min: { startsAt: true },
    });
    const nextStarts = firsts.flatMap((first) => (first._min.startsAt === null ? [] : [{ sportLeagueId: first.sportLeagueId, startsAt: first._min.startsAt }]));
    if (nextStarts.length === 0) return [];
    const rows = await this.prisma.sportLeagueSeasonCompetitionSlot.findMany({
      where: { AND: [unstarted, { OR: nextStarts }] },
      select: { sportLeagueId: true, startsAt: true, eventSlot: { select: { sportEventId: true } } },
      orderBy: [{ sportLeagueId: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) => (row.startsAt === null || row.eventSlot === null
      ? []
      : [{ sportLeagueId: row.sportLeagueId, startsAt: row.startsAt, sportEventId: row.eventSlot.sportEventId }]));
  }

  async findLiveEvents(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<LiveEventView[]> {
    if (input.leagues.length === 0) return [];
    const games = await this.prisma.sportEventRoundMatchGame.findMany({
      where: { ...gameInPlayWhere(input.now), eventSlot: { sportEvent: linkedEventOf(input.leagues) } },
      select: {
        sportEventId: true,
        status: true,
        scheduledDate: true,
        lastProviderNotificationAt: true,
        eventSlot: {
          select: {
            seasonSlot: { select: { definition: { select: { matchFormat: true } } } },
            sportEvent: { select: { sportLeagueId: true } },
          },
        },
      },
      orderBy: [{ sportEventId: 'asc' }, { id: 'asc' }],
    });
    const events = new Map<string, LiveEventView & { games: LiveEventView['games'][number][] }>();
    for (const game of games) {
      const { sportEvent, seasonSlot } = game.eventSlot;
      const event = events.get(game.sportEventId) ?? {
        sportEventId: game.sportEventId,
        sportLeagueId: sportEvent.sportLeagueId,
        games: [],
        lastHeardAt: null,
        lastScoresChangedAt: null,
      };
      event.games.push({ status: game.status, scheduledDate: game.scheduledDate, playedAsField: seasonSlot.definition.matchFormat === MatchFormat.FIELD });
      event.lastHeardAt = latest([event.lastHeardAt, game.lastProviderNotificationAt]);
      events.set(game.sportEventId, event);
    }
    if (events.size === 0) return [];
    // Each live event's latest scores sync that changed something, on the (event, kind, created at) index.
    const changed = await this.prisma.providerSyncRun.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...events.keys()] }, kind: ProviderSyncKind.SCORES, status: ProviderSyncRunStatus.COMPLETED, changedCount: { gt: 0 } },
      _max: { createdAt: true },
    });
    const changedAt = new Map(changed.map((group) => [group.sportEventId, group._max.createdAt]));
    for (const event of events.values()) event.lastScoresChangedAt = changedAt.get(event.sportEventId) ?? null;
    return [...events.values()];
  }

  async findOverdueGames(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<OverdueGameView[]> {
    if (input.leagues.length === 0) return [];
    const games = await this.prisma.sportEventRoundMatchGame.findMany({
      where: {
        status: { in: [MatchStatus.SCHEDULED, MatchStatus.IN_PROGRESS] },
        scheduledDate: { lt: overdueStartCutoff(input.now) },
        movedToGameId: null,
        eventSlot: { sportEvent: linkedEventOf(input.leagues) },
      },
      select: {
        sportEventId: true,
        status: true,
        scheduledDate: true,
        eventSlot: { select: { sportEvent: { select: { sportLeagueId: true } } } },
        providerMappings: { select: { externalId: true, provider: { select: { code: true } } }, orderBy: { providerId: 'asc' } },
      },
      orderBy: [{ sportEventId: 'asc' }, { id: 'asc' }],
    });
    return games.map((game) => ({
      sportEventId: game.sportEventId,
      sportLeagueId: game.eventSlot.sportEvent.sportLeagueId,
      status: game.status,
      scheduledDate: game.scheduledDate,
      providerGameIds: game.providerMappings.map((mapping) => ({ providerCode: mapping.provider.code, externalId: mapping.externalId })),
    }));
  }
}

/** The latest of the times given, or null when none is set. */
function latest(times: ReadonlyArray<Date | null>): Date | null {
  const set = times.filter((time): time is Date => time !== null).map((time) => time.getTime());
  return set.length === 0 ? null : new Date(Math.max(...set));
}
