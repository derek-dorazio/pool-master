/**
 * A Game in play at a time (#2009): `isGameScoresDue` as a Prisma filter. One in progress, or one
 * scheduled whose start has come but not more than the overdue wait ago. The sync tick
 * reads the live events through it, and an event's own notification is recorded on the Games it
 * picks (#2008), so the quiet check and the notification agree on which Games are in play.
 */
import type { Prisma } from '@prisma/client';
import { MatchStatus, scoresDueSince } from '@poolmaster/shared/domain';

export function gameInPlayWhere(now: Date): Prisma.SportEventRoundMatchGameWhereInput {
  return {
    OR: [
      { status: MatchStatus.IN_PROGRESS },
      { status: MatchStatus.SCHEDULED, scheduledDate: { lte: now, gte: scoresDueSince(now) } },
    ],
  };
}
