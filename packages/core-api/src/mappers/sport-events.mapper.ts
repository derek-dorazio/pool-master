/**
 * SportEvent mapper — Prisma row → canonical SportEventDto per plans/117
 * §4.1 / §12.1.
 *
 * Pure projection: no operational-state derivation, no business logic.
 * The legacy `events.mapper.ts:toEventSummaryDto` still computes derived
 * fields (`readinessStatus`, `readinessReasons`, `contestEligible`) for
 * the legacy `/events` list response — that path is kept separate so the
 * persistence-aware DTO stays uncontaminated by API-shape concerns.
 */

import type { Sport } from '@poolmaster/shared/domain';
import type {
  EventStatusDto,
  SportEventDto,
} from '@poolmaster/shared/dto/events.dto';

export interface SportEventRow {
  id: string;
  externalId: string;
  providerId: string;
  sport: Sport;
  name: string;
  venue: string | null;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  status: EventStatusDto;
  rounds: number | null;
  participantCount: number | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function mapSportEventToDto(row: SportEventRow): SportEventDto {
  return {
    id: row.id,
    externalId: row.externalId,
    providerId: row.providerId,
    sport: row.sport,
    name: row.name,
    venue: row.venue,
    location: row.location,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    status: row.status,
    rounds: row.rounds,
    participantCount: row.participantCount,
    releaseAt: row.releaseAt.toISOString(),
    fieldLocksAt: row.fieldLocksAt.toISOString(),
    fieldLocked: row.fieldLocked,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
