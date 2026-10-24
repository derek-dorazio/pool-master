import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import type { LeagueDto, LeagueMembershipDto } from '@/lib/api';
import { readCookie } from '@/lib/cookies';


export const RECENT_LEAGUE_COOKIE = 'poolmaster_recent_league';

export function buildLeaguePath(leagueCode: string) {
  return `/league/${leagueCode}`;
}

export function buildLeagueTeamPath(leagueCode: string) {
  return `/league/${leagueCode}/team`;
}

export function buildLeagueTeamEditPath(leagueCode: string) {
  return `/league/${leagueCode}/team/edit`;
}

export function buildLeagueTeamHomePath(leagueCode: string, teamId: string) {
  return `/league/${leagueCode}/teams/${teamId}`;
}

export function buildLeagueTeamsPath(leagueCode: string) {
  return `/league/${leagueCode}/teams`;
}

/** All years (#837): every year's champions, under Championships. */
export function buildLeagueHistoryPath(leagueCode: string) {
  return `/league/${leagueCode}/history`;
}

/** Championships (#841, #863): the year's page, which lands on its current tab. */
export function buildLeagueChampionshipsPath(leagueCode: string, year?: number) {
  return year === undefined ? `/league/${leagueCode}/championships` : `/league/${leagueCode}/championships/${year}`;
}

/** The Trophy case: a card per sports league cup of the year. */
export function buildLeagueTrophyCasePath(leagueCode: string, year: number) {
  return `${buildLeagueChampionshipsPath(leagueCode, year)}/trophies`;
}

/** The Points race of one sports league's cup in a year. */
export function buildLeaguePointsRacePath(leagueCode: string, year: number, sportLeagueId: string) {
  return `${buildLeagueChampionshipsPath(leagueCode, year)}/race/${sportLeagueId}`;
}

/** One squad's points in a cup, contest by contest. */
export function buildLeagueCupSquadPath(leagueCode: string, year: number, sportLeagueId: string, squadId: string) {
  return `${buildLeaguePointsRacePath(leagueCode, year, sportLeagueId)}/squads/${squadId}`;
}

/** Every contest type the league could run (#803): with create links for its commissioners. */
export function buildLeagueContestTypesPath(leagueCode: string) {
  return `/league/${leagueCode}/contest-types`;
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

export function buildLeagueAdminPath(leagueCode: string) {
  return `/league/${leagueCode}/admin`;
}

export function buildLeagueAdminContestsPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/contests`;
}

export function buildLeagueAdminContestCreatePath(leagueCode: string) {
  return `/league/${leagueCode}/admin/contests/new`;
}

/** Create contest started on one contest template (#803), as the contest types page links to it. */
export function buildLeagueAdminContestCreateFromTemplatePath(leagueCode: string, templateId: string) {
  return `${buildLeagueAdminContestCreatePath(leagueCode)}?template=${encodeURIComponent(templateId)}`;
}

export function buildLeagueAdminContestPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/admin/contests/${contestId}`;
}

export function buildLeagueAdminContestEditPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/admin/contests/${contestId}/edit`;
}

/** The commissioner's event picker for a contest (#713): which sport events it covers. */
export function buildLeagueAdminContestEventsPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/admin/contests/${contestId}/events`;
}

/** How much one contest counts toward its cup and the league championship (#841). */
export function buildLeagueAdminContestCupWeightPath(leagueCode: string, contestId: string) {
  return `/league/${leagueCode}/admin/contests/${contestId}/cup-weight`;
}

export function buildLeagueAdminTeamsPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/teams`;
}

export function buildLeagueAdminTeamPath(leagueCode: string, teamId: string) {
  return `/league/${leagueCode}/admin/teams/${teamId}`;
}

export function buildLeagueAdminTeamEditPath(leagueCode: string, teamId: string) {
  return `/league/${leagueCode}/admin/teams/${teamId}/edit`;
}

export function buildLeagueAdminInvitesPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/invites`;
}

export function buildLeagueAdminEditPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/edit`;
}

/** The league's championship name and points table (#841, #863). */
export function buildLeagueAdminChampionshipsEditPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/championships/edit`;
}

/** Which sport leagues' upcoming events the league's commissioners are emailed about (#851). */
export function buildLeagueAdminEventEmailsEditPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/event-emails/edit`;
}

/** The league's Plan page (#972): its plan and usage, the plans to move to, and the comparison. */
export function buildLeagueAdminPlanPath(leagueCode: string) {
  return `/league/${leagueCode}/admin/plan`;
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
    .map((part) => part.charAt(0).toUpperCase())
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
          membership.status === LeagueMembershipStatus.ACTIVE && membership.role === LeagueRole.COMMISSIONER,
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
