/**
 * The write permission on shared catalog objects (#236): a route-level `onRequest` hook
 * that lets a request through only when its access token carries the root-admin claim
 * (access rule A10). Reads of the same objects need only a signed-in user. One guard for
 * every such write, rather than a check per handler.
 *
 * `onRequest`, not `preHandler`: Fastify validates params and body between the two, so a
 * preHandler guard would answer a malformed request from a non-admin with 400 — telling
 * them the operation's shape — instead of 403, as the `/admin` routes these writes came
 * from did. The global auth guard is itself a preHandler, so `authUser` is not set yet
 * here: the guard verifies the token itself, with the same helpers. The auth guard still
 * runs afterwards and applies its own checks (the CSRF check on cookie sessions).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { readRequestAccessToken, verifyAccessToken, type AuthUser } from '../plugins/auth-guard';
import { readJwtSecret } from './config';
import { sendError } from './error-handler';

export async function requireRootAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const accessToken = readRequestAccessToken(request);
  if (!accessToken) {
    await sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    return;
  }
  let user: AuthUser;
  try {
    user = verifyAccessToken(accessToken, readJwtSecret());
  } catch {
    await sendError(reply, 401, 'AUTH_ACCESS_TOKEN_INVALID', 'Invalid or expired access token');
    return;
  }
  if (user.isRootAdmin) {
    return;
  }
  (request.contextLogger ?? request.log).warn(
    { action: 'rootAdmin.write.forbidden', data: { method: request.method, route: request.routeOptions.url } },
    'Rejected a root-admin write from a caller without the claim',
  );
  await sendError(reply, 403, 'ROOT_ADMIN_ACCESS_REQUIRED', 'Root-admin access is required');
}
