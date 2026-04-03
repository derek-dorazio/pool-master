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
    maxMembers: league.maxMembers == null ? null : Number(league.maxMembers),
    activeContestCount: Number(league.activeContestCount ?? 0),
    activityLevel: String(league.activityLevel ?? 'LOW'),
    joinPolicy: String(league.joinPolicy ?? 'OPEN'),
    commissionerName: league.commissionerName == null ? undefined : String(league.commissionerName),
    visibility: String(league.visibility ?? 'PUBLIC'),
    createdAt: league.createdAt instanceof Date ? toIso(league.createdAt) : undefined,
  };
}

export function mapDiscoverableContestToDto(contest: Record<string, unknown>) {
  return {
    id: String(contest.id),
    leagueName: contest.leagueName == null ? undefined : String(contest.leagueName),
    contestName: String(contest.contestName),
    sport: contest.sport == null ? undefined : String(contest.sport),
    eventName: contest.eventName == null ? undefined : String(contest.eventName),
    draftType: contest.draftType == null ? undefined : String(contest.draftType),
    status: String(contest.status),
    memberCount: Number(contest.memberCount ?? 0),
    maxMembers: contest.maxMembers == null ? null : Number(contest.maxMembers),
    entryFee: contest.entryFee == null ? null : Number(contest.entryFee),
    prizePool: contest.prizePool == null ? undefined : Number(contest.prizePool),
    draftStart: contest.draftStart instanceof Date ? toIso(contest.draftStart) : undefined,
    lockTime: contest.lockTime instanceof Date ? toIso(contest.lockTime) : undefined,
  };
}
