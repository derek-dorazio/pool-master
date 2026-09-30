/**
 * The event's participants as the golf leaderboard and golf settlement both read
 * them: core standing and rounds with their golf extensions, flattened into one
 * row per golfer. One loader for both, so the two cannot drift apart.
 */
import type { PrismaClient } from '@prisma/client';
import type { GolfLeaderboardParticipantRow } from '../../mappers/contests.mapper';
import { buildGolfRoundColumns, mapGolfLeaderboardStatus } from './golf-leaderboard-calculator';

export async function loadGolfLeaderboardParticipants(
  prisma: PrismaClient,
  sportEventId: string,
): Promise<GolfLeaderboardParticipantRow[]> {
const rows = await prisma.sportEventParticipant.findMany({
    where: { sportEventId },
    select: {
      id: true,
      participantId: true,
      isActive: true,
      inactiveReason: true,
      ranking: true,
      oddsToWin: true,
      seedNumber: true,
      participant: {
        select: {
          id: true,
          name: true,
          shortName: true,
        },
      },
      standing: {
        select: {
          currentRound: true,
          status: true,
          position: true,
          displayPosition: true,
          asOf: true,
          golf: { select: { eventScoreToPar: true, eventStrokes: true, currentRoundThru: true } },
        },
      },
      rounds: {
        select: {
          status: true,
          sportEventRound: { select: { roundNumber: true } },
          golf: { select: { strokes: true, scoreToPar: true, thru: true } },
        },
        orderBy: { sportEventRound: { roundNumber: 'asc' } },
      },
    },
    orderBy: [
      { seedNumber: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  return rows.map((row) => {
    const standing = row.standing;
    const golfStanding = standing?.golf ?? null;
    const normalizedStatus = standing
      ? mapGolfLeaderboardStatus(String(standing.status))
      : 'active';
    return {
      sportEventParticipantId: row.id,
      participantId: row.participantId,
      name: row.participant.name,
      shortName: row.participant.shortName ?? null,
      isActive: row.isActive,
      inactiveReason: row.inactiveReason,
      ranking: row.ranking ?? null,
      oddsToWin: decimalToNumber(row.oddsToWin),
      seedNumber: row.seedNumber ?? null,
      totalScoreToPar: golfStanding?.eventScoreToPar ?? null,
      totalStrokes: golfStanding?.eventStrokes ?? null,
      thru: normalizedStatus === 'in-progress'
        ? golfStanding?.currentRoundThru ?? null
        : null,
      currentRound: standing?.currentRound ?? null,
      status: normalizedStatus,
      position: standing?.position ?? null,
      displayPosition: standing?.displayPosition ?? null,
      asOf: standing?.asOf ?? null,
      rounds: buildGolfRoundColumns(
        row.rounds.flatMap((round) => (round.golf
          ? [{ ...round.golf, status: round.status, round: round.sportEventRound.roundNumber }]
          : [])),
      ),
    };
  });
}

function decimalToNumber(value: { toNumber: () => number } | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : value.toNumber();
}
