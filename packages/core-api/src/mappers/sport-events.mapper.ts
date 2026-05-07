/**
 * SportEvent mapper — Prisma row → canonical SportEventDto per plans/117 §12.1.
 *
 * Functionally extends `events.mapper.ts:toEventSummaryDto` with the metadata
 * field. The two share the operational-state derivation; this mapper exists
 * separately so consumers reach for the §12.1-named DTO directly.
 */

import type { SportEventDto } from '@poolmaster/shared/dto/events.dto';
import { toEventSummaryDto } from './events.mapper';
import type { Sport } from '@poolmaster/shared/domain';
import type {
  EventReadinessReasonDto,
  EventReadinessStatusDto,
  EventStatusDto,
} from '@poolmaster/shared/dto/events.dto';

export interface SportEventRow {
  id: string;
  externalId: string;
  sport: Sport;
  name: string;
  venue: string | null;
  location: string | null;
  status: EventStatusDto;
  startDate: Date;
  endDate: Date | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  participantCount: number | null;
  loadedParticipantCount?: number | null;
  providerFieldLocked: boolean;
  metadata: unknown;
}

export function mapSportEventToDto(row: SportEventRow): SportEventDto {
  const summary = toEventSummaryDto({
    id: row.id,
    externalId: row.externalId,
    sport: row.sport,
    name: row.name,
    venue: row.venue,
    location: row.location,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    releaseAt: row.releaseAt,
    fieldLocksAt: row.fieldLocksAt,
    participantCount: row.participantCount,
    loadedParticipantCount: row.loadedParticipantCount,
    providerFieldLocked: row.providerFieldLocked,
  });

  return {
    ...summary,
    readinessStatus: summary.readinessStatus as EventReadinessStatusDto,
    readinessReasons: summary.readinessReasons as EventReadinessReasonDto[],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}
