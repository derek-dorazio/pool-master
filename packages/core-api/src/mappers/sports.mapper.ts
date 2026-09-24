/**
 * Sport mapper — Prisma row → canonical SportDto.
 *
 * Pure projection: the row shape mirrors the schema exactly, INCLUDING its enum
 * columns. `Sport.participantType`, `.category` and `.tournamentFormat` are enums
 * in schema.prisma, so widening them to `string` here and casting back at the DTO
 * boundary discarded the one guarantee the schema already provides (#86).
 */

import type {
  ParticipantType,
  SportCategory,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import type { SportDto } from '@poolmaster/shared/dto/events.dto';

export interface SportRow {
  id: string;
  name: string;
  participantType: ParticipantType;
  category: SportCategory;
  tournamentFormat: TournamentFormat;
  createdAt: Date;
  updatedAt: Date;
}

export function mapSportToDto(row: SportRow): SportDto {
  return {
    id: row.id,
    name: row.name,
    participantType: row.participantType,
    category: row.category,
    tournamentFormat: row.tournamentFormat,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
