import type { Participant } from '@poolmaster/shared/domain';
import { mapParticipantToDto } from './participants.mapper';

function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function mapSearchParticipantsResponseToDto(result: {
  participants: Participant[];
  total: number;
  facets: {
    positions: Array<{ value: string; count: number }>;
    teams: Array<{ value: string; count: number }>;
    nationalities: Array<{ value: string; count: number }>;
    rankingDistribution: {
      top10: number;
      top25: number;
      top50: number;
      top100: number;
      unranked: number;
    };
  };
}) {
  return {
    participants: result.participants.map(mapParticipantToDto),
    total: result.total,
    facets: result.facets,
  };
}

export function mapDiscoverableLeagueToDto(league: Record<string, unknown>) {
  return {
    id: String(league.id),
    name: String(league.name),
    description: league.description == null ? undefined : String(league.description),
    sport: Array.isArray(league.sports) ? String(league.sports[0] ?? '') : undefined,
    memberCount: Number(league.memberCount ?? 0),
    visibility: String(league.visibility ?? 'PUBLIC'),
    createdAt: league.createdAt instanceof Date ? toIso(league.createdAt) : undefined,
  };
}

export function mapDiscoverableContestToDto(contest: Record<string, unknown>) {
  return {
    id: String(contest.id),
    contestName: String(contest.contestName),
    sport: contest.sport == null ? undefined : String(contest.sport),
    status: String(contest.status),
    memberCount: Number(contest.memberCount ?? 0),
    prizePool: contest.prizePool == null ? undefined : Number(contest.prizePool),
    lockTime: contest.lockTime instanceof Date ? toIso(contest.lockTime) : undefined,
  };
}
