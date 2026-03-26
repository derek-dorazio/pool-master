/**
 * Prisma adapter for ParticipantSeasonRecordRepository port.
 */

import type { PrismaClient } from '@prisma/client';
import type { ParticipantSeasonRecordRepository } from '@poolmaster/shared/db';
import type { ParticipantSeasonRecord, SeasonRanking } from '@poolmaster/shared/domain';
import type { Sport, FormTrend } from '@poolmaster/shared/domain';
import type { Decimal } from '@prisma/client/runtime/library';

export class PrismaParticipantSeasonRecordRepository implements ParticipantSeasonRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByParticipantAndSeason(
    participantId: string,
    season: string,
  ): Promise<ParticipantSeasonRecord | null> {
    const row = await this.prisma.participantSeasonRecord.findUnique({
      where: { participantId_season: { participantId, season } },
    });
    return row ? mapToSeasonRecord(row) : null;
  }

  async findByParticipant(participantId: string): Promise<ParticipantSeasonRecord[]> {
    const rows = await this.prisma.participantSeasonRecord.findMany({
      where: { participantId },
      orderBy: { season: 'desc' },
    });
    return rows.map(mapToSeasonRecord);
  }

  async findBySportAndSeason(sport: Sport, season: string): Promise<ParticipantSeasonRecord[]> {
    const rows = await this.prisma.participantSeasonRecord.findMany({
      where: { sport, season },
      orderBy: { budgetPrice: 'desc' },
    });
    return rows.map(mapToSeasonRecord);
  }

  async upsert(
    record: Omit<ParticipantSeasonRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantSeasonRecord> {
    const data = {
      sport: record.sport,
      rankings: record.rankings as object,
      budgetPrice: record.budgetPrice,
      priceTier: record.priceTier,
      priceUpdatedAt: record.priceUpdatedAt,
      eventsEntered: record.eventsEntered,
      eventsCompleted: record.eventsCompleted,
      wins: record.wins,
      top5Finishes: record.top5Finishes,
      top10Finishes: record.top10Finishes,
      top25Finishes: record.top25Finishes,
      seasonStats: record.seasonStats as object,
      formRating: record.formRating,
      formTrend: record.formTrend,
      lastUpdated: record.lastUpdated,
    };

    const row = await this.prisma.participantSeasonRecord.upsert({
      where: {
        participantId_season: {
          participantId: record.participantId,
          season: record.season,
        },
      },
      create: {
        participantId: record.participantId,
        season: record.season,
        ...data,
      },
      update: data,
    });
    return mapToSeasonRecord(row);
  }
}

function mapToSeasonRecord(row: {
  id: string;
  participantId: string;
  sport: string;
  season: string;
  rankings: unknown;
  budgetPrice: number;
  priceTier: string | null;
  priceUpdatedAt: Date | null;
  eventsEntered: number;
  eventsCompleted: number;
  wins: number;
  top5Finishes: number;
  top10Finishes: number;
  top25Finishes: number;
  seasonStats: unknown;
  formRating: Decimal;
  formTrend: string;
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}): ParticipantSeasonRecord {
  return {
    id: row.id,
    participantId: row.participantId,
    sport: row.sport as Sport,
    season: row.season,
    rankings: (row.rankings ?? []) as SeasonRanking[],
    budgetPrice: row.budgetPrice,
    priceTier: row.priceTier ?? undefined,
    priceUpdatedAt: row.priceUpdatedAt ?? undefined,
    eventsEntered: row.eventsEntered,
    eventsCompleted: row.eventsCompleted,
    wins: row.wins,
    top5Finishes: row.top5Finishes,
    top10Finishes: row.top10Finishes,
    top25Finishes: row.top25Finishes,
    seasonStats: (row.seasonStats ?? {}) as Record<string, number>,
    formRating: Number(row.formRating),
    formTrend: row.formTrend as FormTrend,
    lastUpdated: row.lastUpdated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
