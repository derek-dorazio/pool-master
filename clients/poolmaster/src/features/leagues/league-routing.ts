import type { ListLeaguesResponses } from '@/lib/api';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

export const RECENT_LEAGUE_COOKIE = 'poolmaster_recent_league';

export function buildLeaguePath(leagueCode: string) {
  return `/league/${leagueCode}`;
}

export function buildInvitePath(inviteCode: string) {
  return `/invite/${inviteCode}`;
}

export function getRecentLeagueCode() {
  if (typeof document === 'undefined') {
    return null;
  }

  const raw = document.cookie
    .split('; ')
    .find((value) => value.startsWith(`${RECENT_LEAGUE_COOKIE}=`))
    ?.split('=')
    .slice(1)
    .join('=');

  return raw ? decodeURIComponent(raw) : null;
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
