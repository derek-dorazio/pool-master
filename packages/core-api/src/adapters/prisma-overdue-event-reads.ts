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

/** One event to judge, with its sport league, read through its Season (#2004). */
export type OverdueCandidate = OverdueEventFacts & { sportLeagueId: string };

/**
 * Every event that may be overdue at `now`, of every sport league or only of `sportLeagueId`, and
 * only `eventIds` when given (the Event page's one event, #1889). The judging itself is
 * `overdueExpectedEnd`; this reads what it needs.
 */
export async function readOverdueCandidates(
  prisma: PrismaClient,
  now: Date,
  sportLeagueId?: string,
  eventIds?: readonly string[],
): Promise<OverdueCandidate[]> {
  const events = await prisma.sportEvent.findMany({
    where: {
      status: { notIn: [...NEVER_OVERDUE_STATUSES] },
      startDate: { lt: overdueStartCutoff(now) },
      ...(sportLeagueId !== undefined && { sportLeagueSeason: { sportLeagueId } }),
      ...(eventIds !== undefined && { id: { in: [...eventIds] } }),
    },
    select: {
      id: true, name: true, status: true, startDate: true, endDate: true,
      // The event's league, and its sport, are its Season's (#2004, #2042).
      sportLeagueSeason: { select: { sportLeagueId: true, sportLeague: { select: { sport: { select: { sport: true } } } } } },
    },
  });
  if (events.length === 0) return [];

  const roundEventIds = events.map((event) => event.id);
  const leagueIds = [...new Set(events.map((event) => event.sportLeagueSeason.sportLeagueId))];
  const [rounds, matchStarts, mappings] = await Promise.all([
    prisma.sportEventRound.findMany({
      where: { sportEventId: { in: roundEventIds } },
      select: { id: true, sportEventId: true, scheduledDate: true, scheduledEndAt: true },
    }),
    prisma.sportEventRoundMatch.groupBy({
      by: ['sportEventRoundId'],
      where: { sportEventId: { in: roundEventIds }, scheduledDate: { not: null } },
      _max: { scheduledDate: true },
    }),
    prisma.providerLeague.findMany({
      where: { sportLeagues: { some: { selectedBy: { is: { id: { in: leagueIds } } } } } },
      select: { typicalGameMinutes: true, sportLeagues: { where: { selectedBy: { isNot: null } }, select: { sportLeagueId: true } } },
    }),
  ]);
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
      sport: event.sportLeagueSeason.sportLeague.sport.sport,
      status: event.status,
      startDate: event.startDate,
      endDate: event.endDate,
      sportLeagueId: event.sportLeagueSeason.sportLeagueId,
      typicalGameMinutes: minutesByLeague.get(event.sportLeagueSeason.sportLeagueId) ?? null,
      rounds: scheduled.map((round) => ({ scheduledDate: round.scheduledDate, scheduledEndAt: round.scheduledEndAt, latestMatchStart: round.latestMatchStart })),
    };
  });
}
