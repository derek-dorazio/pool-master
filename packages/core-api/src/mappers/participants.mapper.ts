import type { Participant, ParticipantProviderMapping } from '@poolmaster/shared/domain';
import type { ParticipantProviderMappingDto } from '@poolmaster/shared/dto/participants.dto';

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
    firstName: participant.firstName,
    lastName: participant.lastName,
    shortName: participant.shortName,
    nationality: participant.nationality,
    role: participant.role,
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

export function mapParticipantProviderMappingToDto(mapping: ParticipantProviderMapping): ParticipantProviderMappingDto {
  return {
    id: mapping.id,
    participantId: mapping.participantId,
    providerId: mapping.providerId,
    externalId: mapping.externalId,
    confidence: mapping.confidence,
    mappedAt: mapping.mappedAt.toISOString(),
  };
}
