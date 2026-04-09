import type { EventSummaryDto } from '@poolmaster/shared/dto/events.dto';

interface EventRow {
  id: string;
  sport: string;
  name: string;
  venue: string | null;
  location: string | null;
  status: string;
  startDate: Date;
  endDate: Date | null;
  participantCount: number | null;
  fieldLocked: boolean;
}

export function toEventSummaryDto(event: EventRow): EventSummaryDto {
  return {
    id: event.id,
    sport: event.sport,
    name: event.name,
    venue: event.venue ?? null,
    location: event.location ?? null,
    status: event.status,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    participantCount: event.participantCount ?? null,
    fieldLocked: event.fieldLocked,
  };
}

export function toEventListResponse(events: EventRow[]): { events: EventSummaryDto[] } {
  return {
    events: events.map(toEventSummaryDto),
  };
}
