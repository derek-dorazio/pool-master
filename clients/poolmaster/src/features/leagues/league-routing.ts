import type { ListLeaguesResponses } from '@/lib/api';
import { readCookie } from '@/lib/cookies';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

export const RECENT_LEAGUE_COOKIE = 'poolmaster_recent_league';

export function buildLeaguePath(leagueCode: string) {
  return `/league/${leagueCode}`;
}

export function buildLeagueTeamPath(leagueCode: string) {
  return `/league/${leagueCode}/team`;
}

export function buildLeagueTeamHomePath(leagueCode: string, teamId: string) {
  return `/league/${leagueCode}/teams/${teamId}`;
}

export function buildLeagueTeamsPath(leagueCode: string) {
  return `/league/${leagueCode}/teams`;
}

export function buildLeagueEntriesPath(leagueCode: string) {
  return `/league/${leagueCode}/entries`;
}

export function buildLeagueHistoryPath(leagueCode: string) {
  return `/league/${leagueCode}/history`;
}

export function buildLeagueContestsPath(leagueCode: string) {
  return `/league/${leagueCode}/contests`;
}

export function buildLeagueContestCreatePath(leagueCode: string) {
  return `/league/${leagueCode}/contests/new`;
}

export function buildLeagueContestPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/contests/${contestId}`;
}

export function buildLeagueContestsManagePath(leagueCode: string) {
  return `/league/${leagueCode}/contests/manage`;
}

export function buildLeagueContestManagePath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/contests/${contestId}/manage`;
}

export function buildInvitePath(inviteCode: string) {
  return `/invite/${inviteCode}`;
}

export function buildTeamInvitePath(inviteCode: string) {
  return `/team-invite/${inviteCode}`;
}

export function getRecentLeagueCode() {
  return readCookie(RECENT_LEAGUE_COOKIE);
}

export function setRecentLeagueCode(leagueCode: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${RECENT_LEAGUE_COOKIE}=${encodeURIComponent(leagueCode)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function resolveDefaultLeagueCode(leagues: LeagueSummary[]) {
  if (!leagues.length) {
    return null;
  }

  const recentLeagueCode = getRecentLeagueCode();
  if (recentLeagueCode && leagues.some((league) => league.leagueCode === recentLeagueCode)) {
    return recentLeagueCode;
  }

  return [...leagues]
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTime - leftTime;
    })[0]?.leagueCode ?? null;
}

export function getLeagueInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return 'LG';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getLeagueCreatedAtTime(league: LeagueSummary) {
  return league.createdAt ? Date.parse(league.createdAt) : 0;
}

export function sortLeaguesNewestFirst(leagues: LeagueSummary[]) {
  return [...leagues].sort((left, right) => getLeagueCreatedAtTime(right) - getLeagueCreatedAtTime(left));
}

export function sortLeaguesForOverview(leagues: LeagueSummary[]) {
  return [...leagues].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }

    if (left.role === 'COMMISSIONER' && right.role !== 'COMMISSIONER') {
      return -1;
    }

    if (left.role !== 'COMMISSIONER' && right.role === 'COMMISSIONER') {
      return 1;
    }

    return getLeagueCreatedAtTime(right) - getLeagueCreatedAtTime(left);
  });
}

export function getLeagueSelectorOptions(leagues: LeagueSummary[]) {
  return sortLeaguesNewestFirst(
    leagues.filter((league) => league.isActive || league.role === 'COMMISSIONER'),
  );
}
