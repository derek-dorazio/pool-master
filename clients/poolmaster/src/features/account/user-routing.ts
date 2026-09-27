/**
 * #202 — `me` is the User routes' alias for the authenticated caller, resolved server-side by
 * `createUserHandlers`. Self-service surfaces address themselves with it rather than reading an
 * id out of the cached session, so a self-service call and a root-admin call on the same user
 * reach the same operation by the same path.
 */
export const SELF_USER_ID = 'me';

export function buildUserPath(userId: string) {
  return `/users/${userId}`;
}
