import type { Sport } from '@poolmaster/shared/domain';
import type {
  EventReadinessReasonDto,
  EventReadinessStatusDto,
  EventStatusDto,
  EventSummaryDto,
} from '@poolmaster/shared/dto/events.dto';
import { evaluateEventOperationalState } from '../modules/events/operational-timing';

type EventStatus = EventStatusDto;

interface EventRow {
  id: string;
  externalId: string;
  sport: Sport;
  name: string;
  venue: string | null;
  location: string | null;
  status: EventStatus;
  startDate: Date;
  endDate: Date | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  participantCount: number | null;
  loadedParticipantCount?: number | null;
  providerFieldLocked: boolean;
}

export function toEventSummaryDto(event: EventRow): EventSummaryDto {
  const operationalState = evaluateEventOperationalState({
    participantCount: event.loadedParticipantCount ?? event.participantCount,
    releaseAt: event.releaseAt,
    fieldLocksAt: event.fieldLocksAt,
    providerFieldLocked: event.providerFieldLocked,
  });

  return {
    id: event.id,
    externalId: event.externalId,
    sport: event.sport,
    name: event.name,
    venue: event.venue ?? null,
    location: event.location ?? null,
    status: event.status,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    releaseAt: event.releaseAt.toISOString(),
    fieldLocksAt: event.fieldLocksAt.toISOString(),
    participantCount: event.participantCount ?? null,
    fieldLocked: operationalState.fieldLocked,
    readinessStatus: operationalState.readinessStatus as EventReadinessStatusDto,
    readinessReasons: operationalState.readinessReasons as EventReadinessReasonDto[],
    contestEligible: operationalState.contestEligible,
  };
}

export function toEventListResponse(events: EventRow[]): { events: EventSummaryDto[] } {
  return {
    events: events.map(toEventSummaryDto),
  };
}
