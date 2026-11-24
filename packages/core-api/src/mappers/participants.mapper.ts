import type { Participant, ParticipantProviderMapping } from '@poolmaster/shared/domain';
import type {
  ParticipantProviderMappingDto,
  UpdateParticipantRequest,
} from '@poolmaster/shared/dto/participants.dto';
import type { UpdateParticipantInput } from '../modules/participants/service';

function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function mapParticipantToDto(participant: Participant) {
  return {
    id: participant.id,
    sportLeagueId: participant.sportLeagueId,
    ranking: participant.ranking,
    name: participant.name,
    participantType: participant.participantType,
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
    // Deprecated and always empty (#2040): kept so the response keeps its shape.
    externalIds: {},
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
  };
}

export function mapParticipantProviderMappingToDto(mapping: ParticipantProviderMapping): ParticipantProviderMappingDto {
  return {
    id: mapping.id,
    participantId: mapping.participantId,
    sportLeagueId: mapping.sportLeagueId,
    participantType: mapping.participantType,
    providerId: mapping.providerId,
    providerName: mapping.providerName,
    externalId: mapping.externalId,
    mappedAt: mapping.mappedAt.toISOString(),
  };
}

export function toUpdateParticipantInput(request: UpdateParticipantRequest): UpdateParticipantInput {
  const { injuryStatus, ...fields } = request;
  if (!injuryStatus) {
    return fields;
  }
  const { expectedReturn, updatedAt, ...injuryFields } = injuryStatus;
  return {
    ...fields,
    injuryStatus: {
      ...injuryFields,
      ...(expectedReturn !== undefined && { expectedReturn: new Date(expectedReturn) }),
      ...(updatedAt !== undefined && { updatedAt: new Date(updatedAt) }),
    },
  };
}
