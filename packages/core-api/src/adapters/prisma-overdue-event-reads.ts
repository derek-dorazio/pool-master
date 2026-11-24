/**
 * The facts to judge which sport events' results are overdue (#1865), for the Sports page's
 * overview and the League page's events read alike: every released event neither completed nor
 * cancelled that started long enough ago to be overdue, with its rounds and each round's latest match
 * start, and its sport league's typical game length from the league's selected provider league
 * (#1997). At most four grouped reads, however many events.
 */
import type { PrismaClient } from '@prisma/client';
import {
  NEVER_OVERDUE_STATUSES,
  overdueStartCutoff,
  type OverdueEventFacts,
  type OverdueRoundFacts,
} from '@poolmaster/shared/domain';

/** One event to judge, with the series that names its sport league. */
export type OverdueCandidate = OverdueEventFacts & { eventSeriesId: string };

/**
 * Every event that may be overdue at `now`, of every series or only of `eventSeriesIds`, and only
 * `eventIds` when given (the Event page's one event, #1889). The judging itself is
 * `overdueExpectedEnd`; this reads what it needs.
 */
export async function readOverdueCandidates(
  prisma: PrismaClient,
  now: Date,
  eventSeriesIds?: readonly string[],
  eventIds?: readonly string[],
): Promise<OverdueCandidate[]> {
  const events = await prisma.sportEvent.findMany({
    where: {
      status: { notIn: [...NEVER_OVERDUE_STATUSES] },
      startDate: { lt: overdueStartCutoff(now) },
      ...(eventSeriesIds !== undefined && { eventSeriesId: { in: [...eventSeriesIds] } }),
      ...(eventIds !== undefined && { id: { in: [...eventIds] } }),
    },
    select: {
      id: true, name: true, sport: true, status: true, startDate: true, endDate: true, eventSeriesId: true,
    },
  });
  if (events.length === 0) return [];

  const roundEventIds = events.map((event) => event.id);
  const seriesIds = [...new Set(events.map((event) => event.eventSeriesId))];
  const [rounds, matchStarts, series, mappings] = await Promise.all([
    prisma.sportEventRound.findMany({
      where: { sportEventId: { in: roundEventIds } },
      select: { id: true, sportEventId: true, scheduledDate: true, scheduledEndAt: true },
    }),
    prisma.sportEventRoundMatch.groupBy({
      by: ['sportEventRoundId'],
      where: { sportEventId: { in: roundEventIds }, scheduledDate: { not: null } },
      _max: { scheduledDate: true },
    }),
    prisma.eventSeries.findMany({ where: { id: { in: seriesIds } }, select: { id: true, sportLeagueId: true } }),
    prisma.providerLeague.findMany({
      where: { sportLeagues: { some: { selectedBy: { is: { eventSeries: { some: { id: { in: seriesIds } } } } } } } },
      select: { typicalGameMinutes: true, sportLeagues: { where: { selectedBy: { isNot: null } }, select: { sportLeagueId: true } } },
    }),
  ]);
  const leagueOfSeries = new Map(series.map((each) => [each.id, each.sportLeagueId]));
  const minutesByLeague = new Map(mappings.flatMap((league) => league.sportLeagues.map((mapping) => [mapping.sportLeagueId, league.typicalGameMinutes] as const)));
  const latestMatchStartByRound = new Map(matchStarts.map((group) => [group.sportEventRoundId, group._max.scheduledDate]));
  const roundsByEvent = new Map<string, OverdueRoundFacts[]>();
  for (const round of rounds) {
    const facts = {
      scheduledDate: round.scheduledDate,
      scheduledEndAt: round.scheduledEndAt,
      latestMatchStart: latestMatchStartByRound.get(round.id) ?? null,
    };
    const eventRounds = roundsByEvent.get(round.sportEventId);
    if (eventRounds === undefined) roundsByEvent.set(round.sportEventId, [facts]);
    else eventRounds.push(facts);
  }

  return events.map((event) => {
    const scheduled = roundsByEvent.get(event.id) ?? [];
    return {
      id: event.id,
      name: event.name,
      sport: event.sport,
      status: event.status,
      startDate: event.startDate,
      endDate: event.endDate,
      eventSeriesId: event.eventSeriesId,
      typicalGameMinutes: minutesByLeague.get(leagueOfSeries.get(event.eventSeriesId) ?? '') ?? null,
      rounds: scheduled.map((round) => ({ scheduledDate: round.scheduledDate, scheduledEndAt: round.scheduledEndAt, latestMatchStart: round.latestMatchStart })),
    };
  });
}
