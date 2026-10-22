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
