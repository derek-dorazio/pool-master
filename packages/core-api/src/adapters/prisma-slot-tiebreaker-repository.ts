/**
 * Prisma adapter for an event slot's tiebreaker game (#2048): each slot of an event with its
 * Games, in a fixed number of statements however many slots and Games it has, and the write that
 * names each slot's tiebreaker game.
 */

import type { PrismaClient } from '@prisma/client';
import type { SlotTiebreakerGame, SlotTiebreakerRepository, SlotTiebreakerState, SlotTiebreakerWrite } from '@poolmaster/shared/db';
import { MatchStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import { backgroundJobsInsert } from './prisma-background-job-repository';

export class PrismaSlotTiebreakerRepository implements SlotTiebreakerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySportEvent(sportEventId: string): Promise<SlotTiebreakerState[]> {
    const [slots, games] = await Promise.all([
      this.prisma.sportEventSlot.findMany({
        where: { sportEventId },
        select: {
          id: true,
          sportLeagueSeasonCompetitionSlotId: true,
          tiebreakerGameId: true,
          tiebreakerGameChosenAt: true,
          tiebreakerGameChosenByUserId: true,
          seasonSlot: { select: { sportLeagueId: true } },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.sportEventRoundMatchGame.findMany({
        where: { sportEventId },
        select: {
          id: true,
          sportEventSlotId: true,
          sportEventRoundMatchId: true,
          gameNumber: true,
          scheduledDate: true,
          status: true,
          movedToGameId: true,
          match: { select: { scheduledDate: true, status: true } },
        },
        orderBy: [{ sportEventRoundMatchId: 'asc' }, { gameNumber: 'asc' }],
      }),
    ]);
    const gamesBySlot = new Map<string, SlotTiebreakerGame[]>();
    for (const { sportEventSlotId, match, movedToGameId, ...game } of games) {
      // Until slice 14 rolls status and schedule up from Games (#2013), the schedule sync and the
      // result writers keep a single game's kickoff and cancellation on its match: Game 1 starts
      // when its match does, and a cancelled match cancels its Games.
      const candidate: SlotTiebreakerGame = {
        ...game,
        scheduledDate: game.gameNumber === 1 ? match.scheduledDate : game.scheduledDate,
        status: match.status === MatchStatus.CANCELLED ? MatchStatus.CANCELLED : game.status,
        moved: movedToGameId !== null,
      };
      const slotGames = gamesBySlot.get(sportEventSlotId);
      if (slotGames) slotGames.push(candidate);
      else gamesBySlot.set(sportEventSlotId, [candidate]);
    }
    return slots.map((slot) => ({
      sportEventSlotId: slot.id,
      seasonSlotId: slot.sportLeagueSeasonCompetitionSlotId,
      sportLeagueId: slot.seasonSlot.sportLeagueId,
      tiebreakerGameId: slot.tiebreakerGameId,
      chosen: slot.tiebreakerGameChosenAt === null ? null : { at: slot.tiebreakerGameChosenAt, byUserId: slot.tiebreakerGameChosenByUserId },
      games: gamesBySlot.get(slot.id) ?? [],
    }));
  }

  async saveTiebreakerGames(writes: readonly SlotTiebreakerWrite[], jobs: readonly BackgroundJobRequest[]): Promise<void> {
    if (writes.length === 0) return;
    await this.prisma.$transaction([
      // poolmaster-allow-query-in-loop: one event's slots (per-row values, one transaction)
      ...writes.map(({ sportEventSlotId, tiebreakerGameId, chosen }) => this.prisma.sportEventSlot.update({
        where: { id: sportEventSlotId },
        data: { tiebreakerGameId, tiebreakerGameChosenAt: chosen?.at ?? null, tiebreakerGameChosenByUserId: chosen?.byUserId ?? null },
      })),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }
}
