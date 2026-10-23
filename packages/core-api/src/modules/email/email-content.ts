/**
 * Pieces every league email's data is built from: how a reader is named, and the links into the
 * web app. One copy, so every email names people and links to a contest the same way.
 */

import type { User } from '@poolmaster/shared/domain';

/** The reader's full name, else their username, else their address. */
export function formatUserName(user: Pick<User, 'firstName' | 'lastName' | 'username' | 'email'>): string {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user.username || user.email;
}

/** The contest's page in its league. */
export function buildContestUrl(appBaseUrl: string, leagueCode: string, contestId: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}/contests/${encodeURIComponent(contestId)}`;
}

/** One entry's page in its contest. */
export function buildEntryUrl(appBaseUrl: string, leagueCode: string, contestId: string, entryId: string): string {
  return `${buildContestUrl(appBaseUrl, leagueCode, contestId)}/entries/${encodeURIComponent(entryId)}`;
}

/** The contest's leaderboard. */
export function buildLeaderboardUrl(appBaseUrl: string, leagueCode: string, contestId: string): string {
  return `${buildContestUrl(appBaseUrl, leagueCode, contestId)}/leaderboard`;
}

/** The league's contests page for its commissioners. */
export function buildLeagueAdminContestsUrl(appBaseUrl: string, leagueCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}/admin/contests`;
}

/** Create contest, started on one contest template when given. */
export function buildCreateContestUrl(appBaseUrl: string, leagueCode: string, templateId?: string): string {
  const url = `${buildLeagueAdminContestsUrl(appBaseUrl, leagueCode)}/new`;
  return templateId === undefined ? url : `${url}?template=${encodeURIComponent(templateId)}`;
}

/** One contest's commissioner page, where it is opened. */
export function buildContestAdminUrl(appBaseUrl: string, leagueCode: string, contestId: string): string {
  return `${buildLeagueAdminContestsUrl(appBaseUrl, leagueCode)}/${encodeURIComponent(contestId)}`;
}

/** A sport event's root admin page, under the sport's Manage pages. */
export function buildSportEventAdminUrl(appBaseUrl: string, sport: string, sportEventId: string): string {
  const sportSegment = sport.toLowerCase().replace(/_/g, '-');
  return `${appBaseUrl.replace(/\/+$/, '')}/manage/sports/${sportSegment}/events/${encodeURIComponent(sportEventId)}`;
}
