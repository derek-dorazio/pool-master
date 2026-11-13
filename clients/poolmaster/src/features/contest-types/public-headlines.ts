/**
 * The headlines of the signed-out pages, kept together because they are one family (#1613,
 * #1699): the sign-in page opens with one and How to Play closes with the other.
 */

/** The signed-out home's headline over the How to Play steps and the sign-in card. */
export const SIGN_IN_HEADLINE = 'Make every game day count.';

/** How to Play's closing block for a signed-out visitor, over its one button. */
export const HOW_TO_PLAY_CLOSING_TITLE = 'Every game day, done right.';

/** The sign-in page's headline on a league invite link. */
export function joinLeagueHeadline(leagueName: string): string {
  return `Join ${leagueName}`;
}

/** The sign-in page's headline on a co-owner invite link. */
export function joinTeamHeadline(teamName: string, leagueName: string): string {
  return `Join ${teamName} in ${leagueName}`;
}
