/**
 * Sport mapper — Prisma row → canonical SportDto per plans/117 §12.1.
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
  participantType: string;
  category: string;
  tournamentFormat: string;
  createdAt: Date;
  updatedAt: Date;
}

export function mapSportToDto(row: SportRow): SportDto {
  return {
    id: row.id,
    name: row.name,
    participantType: row.participantType as ParticipantType,
    category: row.category as SportCategory,
    tournamentFormat: row.tournamentFormat as TournamentFormat,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
