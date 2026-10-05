import { LeagueRole } from '@poolmaster/shared/domain';
import type { LeagueDto, LeagueMembershipDto } from '@/lib/api';
import { readCookie } from '@/lib/cookies';


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

export function buildLeagueHistoryPath(leagueCode: string) {
  return `/league/${leagueCode}/history`;
}

export function buildLeagueContestsPath(leagueCode: string) {
  return `/league/${leagueCode}/contests`;
}

export function buildLeagueMyContestsPath(leagueCode: string) {
  return `/league/${leagueCode}/contests?filter=my-entries`;
}

export function buildLeagueContestHistoryPath(leagueCode: string) {
  return `/league/${leagueCode}/contests/history`;
}

export function buildLeagueContestCreatePath(leagueCode: string) {
  return `/league/${leagueCode}/contests/new`;
}

export function buildLeagueContestPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/contests/${contestId}`;
}

export function buildLeagueContestLeaderboardPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/contests/${contestId}/leaderboard`;
}

export function buildLeagueContestEntryPath(leagueCode: string, contestId: string, entryId: string) {
  return `/league/${leagueCode}/contests/${contestId}/entries/${entryId}`;
}

export function buildContestEntryPath(contestId: string, entryId: string) {
  return `/contests/${contestId}/entries/${entryId}`;
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

// Keep this signal fresh from league-scoped route entry points (selector, League Home,
// Contest Board, contest management, My Team, joins) so deep links retain context.
export function rememberRecentLeagueCode(leagueCode: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${RECENT_LEAGUE_COOKIE}=${encodeURIComponent(leagueCode)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function resolveDefaultLeagueCode(leagues: LeagueDto[]) {
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

function getLeagueCreatedAtTime(league: LeagueDto) {
  return league.createdAt ? Date.parse(league.createdAt) : 0;
}

export function sortLeaguesNewestFirst(leagues: LeagueDto[]) {
  return [...leagues].sort((left, right) => getLeagueCreatedAtTime(right) - getLeagueCreatedAtTime(left));
}

/**
 * #202 (A8) — the leagues list is the one surface where the viewer's context arrives as a SET
 * rather than once per entity. `LeagueListResponse` carries `{ leagues, memberships }`: the
 * leagues, then the viewer's own memberships among them, once. The viewer's role in a league is
 * read out of that set here, where it used to be a `leagueRelationship` block stamped onto
 * every league row.
 */
export function getCommissionerLeagueIds(
  memberships: LeagueMembershipDto[],
): ReadonlySet<string> {
  return new Set(
    memberships
      .filter(
        (membership) =>
          membership.status === 'ACTIVE' && membership.role === LeagueRole.COMMISSIONER,
      )
      .map((membership) => membership.leagueId),
  );
}

// An inactive league stays in the selector for its commissioner, who is the one who can act
// on it; for everyone else it drops out.
export function getLeagueSelectorOptions(
  leagues: LeagueDto[],
  commissionerLeagueIds: ReadonlySet<string>,
) {
  return sortLeaguesNewestFirst(
    leagues.filter((league) => league.isActive || commissionerLeagueIds.has(league.id)),
  );
}
