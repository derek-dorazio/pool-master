import { readCookie } from '@/lib/cookies';

/**
 * Which account this browser was last signed in as (#658).
 *
 * When a session lapses on a page, the member guard sends the visitor to sign-in with that
 * page as the return path. The return path belongs to the account that was looking at it, so
 * the guard stamps it with this id and sign-in honours it only for the same account. Without
 * it, a tab left on one account's league returned whoever signed in next to that league.
 *
 * Kept across a lapsed session on purpose; forgotten on an explicit sign-out. The page that
 * sign-out leaves is stamped by the guard itself, from the account it had let in, since this
 * cookie is already gone by the time the guard sees the session end.
 */
const SIGNED_IN_USER_COOKIE = 'poolmaster_signed_in_user';

export function getLastSignedInUserId() {
  return readCookie(SIGNED_IN_USER_COOKIE);
}

export function rememberSignedInUserId(userId: string) {
  document.cookie = `${SIGNED_IN_USER_COOKIE}=${encodeURIComponent(userId)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function forgetSignedInUserId() {
  document.cookie = `${SIGNED_IN_USER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
