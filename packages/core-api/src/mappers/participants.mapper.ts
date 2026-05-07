import type { Participant } from '@poolmaster/shared/domain';

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
