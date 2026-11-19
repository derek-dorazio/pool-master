/**
 * The facts to judge which sport events' results are overdue (#1865), for the Sports page's
 * overview and the League page's events read alike: every event neither completed nor cancelled
 * that started long enough ago to be overdue, with its rounds and each round's latest match
 * start. A Clutch Card event plays no rounds of its own, so it takes the rounds of its parent
 * event it covers (#1820). At most three grouped reads, however many events.
 */
import type { PrismaClient } from '@prisma/client';
import {
  overdueStartCutoff,
  SportEventStatus,
  type OverdueEventFacts,
  type OverdueRoundFacts,
} from '@poolmaster/shared/domain';

/** One event to judge, with the series that names its sport league. */
export type OverdueCandidate = OverdueEventFacts & { eventSeriesId: string };

/**
 * Every event that may be overdue at `now`, of every series or only of `eventSeriesIds`. The
 * judging itself is `overdueExpectedEnd`; this reads what it needs.
 */
export async function readOverdueCandidates(
  prisma: PrismaClient,
  now: Date,
  eventSeriesIds?: readonly string[],
): Promise<OverdueCandidate[]> {
  const events = await prisma.sportEvent.findMany({
    where: {
      status: { notIn: [SportEventStatus.COMPLETED, SportEventStatus.CANCELLED] },
      startDate: { lt: overdueStartCutoff(now) },
      ...(eventSeriesIds !== undefined && { eventSeriesId: { in: [...eventSeriesIds] } }),
    },
    select: {
      id: true, name: true, sport: true, status: true, startDate: true, endDate: true, eventSeriesId: true, parentEventId: true, parentRoundNumbers: true,
    },
  });
  if (events.length === 0) return [];

  const roundEventIds = [...new Set(events.map((event) => event.parentEventId ?? event.id))];
  const [rounds, matchStarts] = await Promise.all([
    prisma.sportEventRound.findMany({
      where: { sportEventId: { in: roundEventIds } },
      select: { id: true, sportEventId: true, roundNumber: true, scheduledDate: true, scheduledEndAt: true },
    }),
    prisma.sportEventMatch.groupBy({
      by: ['sportEventRoundId'],
      where: { sportEventId: { in: roundEventIds }, scheduledDate: { not: null } },
      _max: { scheduledDate: true },
    }),
  ]);
  const latestMatchStartByRound = new Map(matchStarts.map((group) => [group.sportEventRoundId, group._max.scheduledDate]));
  const roundsByEvent = new Map<string, (OverdueRoundFacts & { roundNumber: number })[]>();
  for (const round of rounds) {
    const facts = {
      roundNumber: round.roundNumber,
      scheduledDate: round.scheduledDate,
      scheduledEndAt: round.scheduledEndAt,
      latestMatchStart: latestMatchStartByRound.get(round.id) ?? null,
    };
    const eventRounds = roundsByEvent.get(round.sportEventId);
    if (eventRounds === undefined) roundsByEvent.set(round.sportEventId, [facts]);
    else eventRounds.push(facts);
  }

  return events.map((event) => {
    const own = roundsByEvent.get(event.parentEventId ?? event.id) ?? [];
    const covered = event.parentEventId === null ? own : own.filter((round) => event.parentRoundNumbers.includes(round.roundNumber));
    return {
      id: event.id,
      name: event.name,
      sport: event.sport,
      status: event.status,
      startDate: event.startDate,
      endDate: event.endDate,
      eventSeriesId: event.eventSeriesId,
      rounds: covered.map((round) => ({ scheduledDate: round.scheduledDate, scheduledEndAt: round.scheduledEndAt, latestMatchStart: round.latestMatchStart })),
    };
  });
}
