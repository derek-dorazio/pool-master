/**
 * Prisma adapter for Season slot status (#2013): each slot of an event with its Matches' statuses,
 * in two statements however many slots and Matches it has, and the guarded write that moves a
 * slot's status.
 */

import type { PrismaClient } from '@prisma/client';
import type { SlotStatusRepository, SlotStatusState } from '@poolmaster/shared/db';
import type { BackgroundJobRequest, MatchStatus, SeasonSlotStatus } from '@poolmaster/shared/domain';
import { insertBackgroundJobs } from './prisma-background-job-repository';

export class PrismaSlotStatusRepository implements SlotStatusRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<SlotStatusState[]> {
    const [slots, matches] = await Promise.all([
      this.prisma.sportEventSlot.findMany({
        where: { sportEventId },
        select: { id: true, sportLeagueSeasonCompetitionSlotId: true, feedFinalAt: true, seasonSlot: { select: { status: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.sportEventRoundMatch.findMany({
        where: { sportEventRound: { sportEventId } },
        select: { status: true, sportEventRound: { select: { sportEventSlotId: true } } },
      }),
    ]);
    const statusesBySlot = new Map<string, MatchStatus[]>();
    for (const { status, sportEventRound } of matches) {
      const statuses = statusesBySlot.get(sportEventRound.sportEventSlotId);
      if (statuses) statuses.push(status);
      else statusesBySlot.set(sportEventRound.sportEventSlotId, [status]);
    }
    return slots.map((slot) => ({
      seasonSlotId: slot.sportLeagueSeasonCompetitionSlotId,
      status: slot.seasonSlot.status,
      feedFinal: slot.feedFinalAt !== null,
      matchStatuses: statusesBySlot.get(slot.id) ?? [],
    }));
  }

  async transitionStatus(seasonSlotId: string, { from, to }: { from: SeasonSlotStatus; to: SeasonSlotStatus }, jobs: readonly BackgroundJobRequest[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.sportLeagueSeasonCompetitionSlot.updateMany({ where: { id: seasonSlotId, status: from }, data: { status: to } });
      if (moved.count === 0) return false;
      await insertBackgroundJobs(tx, jobs);
      return true;
    });
  }
}
