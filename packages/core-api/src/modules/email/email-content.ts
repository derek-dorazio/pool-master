/**
 * Pieces every league email's data is built from: how a reader is named, and the links into the
 * web app. One copy, so every email names people and links to a contest the same way.
 */

import { emailFormatImagePath, sportHeaderImagePath, sportPathSegment, type SelectionType, type Sport, type User } from '@poolmaster/shared/domain';

/** The reader's full name, else their username, else their address. */
export function formatUserName(user: Pick<User, 'firstName' | 'lastName' | 'username' | 'email'>): string {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user.username || user.email;
}

/** The league's home page. */
export function buildLeagueHomeUrl(appBaseUrl: string, leagueCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/league/${encodeURIComponent(leagueCode)}`;
}

/** Where a league invitation is accepted. */
export function buildLeagueInviteUrl(appBaseUrl: string, inviteCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(inviteCode)}`;
}

/** Where a co-owner invitation is accepted. */
export function buildSquadOwnerInviteUrl(appBaseUrl: string, inviteCode: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/team-invite/${encodeURIComponent(inviteCode)}`;
}

/** The contest's page in its league. */
export function buildContestUrl(appBaseUrl: string, leagueCode: string, contestId: string): string {
  return `${buildLeagueHomeUrl(appBaseUrl, leagueCode)}/contests/${encodeURIComponent(contestId)}`;
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
  return `${buildLeagueHomeUrl(appBaseUrl, leagueCode)}/admin/contests`;
}

/** The league's Members and owners page for its commissioners. */
export function buildLeagueMembersAdminUrl(appBaseUrl: string, leagueCode: string): string {
  return `${buildLeagueHomeUrl(appBaseUrl, leagueCode)}/admin/teams`;
}

/** The league's Plan page for its commissioners. */
export function buildLeaguePlanUrl(appBaseUrl: string, leagueCode: string): string {
  return `${buildLeagueHomeUrl(appBaseUrl, leagueCode)}/admin/plan`;
}

/** Create contest, started on one contest template and one event when given. */
export function buildCreateContestUrl(
  appBaseUrl: string,
  leagueCode: string,
  start: { templateId?: string; sportEventId?: string } = {},
): string {
  const url = `${buildLeagueAdminContestsUrl(appBaseUrl, leagueCode)}/new`;
  const query = new URLSearchParams();
  if (start.templateId !== undefined) query.set('template', start.templateId);
  if (start.sportEventId !== undefined) query.set('event', start.sportEventId);
  const search = query.toString();
  return search === '' ? url : `${url}?${search}`;
}

/** The league's contest types page: every way to play its sport leagues offer. */
export function buildLeagueContestTypesUrl(appBaseUrl: string, leagueCode: string): string {
  return `${buildLeagueHomeUrl(appBaseUrl, leagueCode)}/contest-types`;
}

/** A sport's picture at the top of an email about one of its events. */
export function buildEmailSportImageUrl(appBaseUrl: string, sport: Sport): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${sportHeaderImagePath(sport)}`;
}

/** A way to play's How to Play picture, on its contest type tile. */
export function buildEmailFormatImageUrl(appBaseUrl: string, selectionType: SelectionType): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${emailFormatImagePath(selectionType)}`;
}

/** One contest's commissioner page, where it is opened. */
export function buildContestAdminUrl(appBaseUrl: string, leagueCode: string, contestId: string): string {
  return `${buildLeagueAdminContestsUrl(appBaseUrl, leagueCode)}/${encodeURIComponent(contestId)}`;
}

/** A sport event's root admin page, under the sport's Manage pages. */
export function buildSportEventAdminUrl(appBaseUrl: string, sport: Sport, sportEventId: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/manage/sports/${sportPathSegment(sport)}/events/${encodeURIComponent(sportEventId)}`;
}

/** The reader's squad page for one year (#872). */
export function buildSquadYearUrl(appBaseUrl: string, leagueCode: string, year: number): string {
  return `${buildLeagueHomeUrl(appBaseUrl, leagueCode)}/team?year=${String(year)}`;
}

const POINTS_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** Cup and championship points arrive in tenths of a point: 6125 reads "612.5", 6000 reads "600". */
export function formatTenthsOfPoints(tenths: number): string {
  return POINTS_FORMAT.format(tenths / 10);
}

const ORDINAL_SUFFIXES = new Map([[1, 'st'], [2, 'nd'], [3, 'rd']]);

/** A place as a sentence reads it: "6th", or "T2" for a shared 2nd. */
export function formatStandingPlace(row: { position: number; displayPosition: string }): string {
  if (row.displayPosition.startsWith('T')) return row.displayPosition;
  const lastTwo = row.position % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ORDINAL_SUFFIXES.get(row.position % 10) ?? 'th';
  return `${String(row.position)}${suffix}`;
}
