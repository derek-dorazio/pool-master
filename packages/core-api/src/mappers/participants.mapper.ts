import type {
  Participant,
  ParticipantSeasonRecord,
  SeasonRanking,
} from '@poolmaster/shared/domain';

function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function mapParticipantToDto(participant: Participant) {
  return {
    id: participant.id,
    sportId: participant.sportId,
    name: participant.name,
    participantType: participant.participantType,
    externalId: participant.externalId,
    metadata: participant.metadata,
    firstName: participant.firstName,
    lastName: participant.lastName,
    shortName: participant.shortName,
    nationality: participant.nationality,
    position: participant.position,
    teamAffiliation: participant.teamAffiliation,
    status: participant.status,
    injuryStatus: {
      status: participant.injuryStatus.status,
      detail: participant.injuryStatus.detail,
      expectedReturn: toIso(participant.injuryStatus.expectedReturn),
      updatedAt: toIso(participant.injuryStatus.updatedAt),
      source: participant.injuryStatus.source,
    },
    photoUrl: participant.photoUrl,
    photoLastUpdated: toIso(participant.photoLastUpdated),
    externalIds: participant.externalIds,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
  };
}

function mapSeasonRankingToDto(ranking: SeasonRanking) {
  return {
    rankingType: ranking.rankingType,
    rank: ranking.rank,
    points: ranking.points,
    asOfDate: ranking.asOfDate.toISOString(),
  };
}

export function mapParticipantSeasonRecordToDto(record: ParticipantSeasonRecord) {
  return {
    id: record.id,
    participantId: record.participantId,
    sport: record.sport,
    season: record.season,
    rankings: record.rankings.map(mapSeasonRankingToDto),
    budgetPrice: record.budgetPrice,
    priceTier: record.priceTier,
    priceUpdatedAt: toIso(record.priceUpdatedAt),
    eventsEntered: record.eventsEntered,
    eventsCompleted: record.eventsCompleted,
    wins: record.wins,
    top5Finishes: record.top5Finishes,
    top10Finishes: record.top10Finishes,
    top25Finishes: record.top25Finishes,
    seasonStats: record.seasonStats,
    formRating: record.formRating,
    formTrend: record.formTrend,
    lastUpdated: record.lastUpdated.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
