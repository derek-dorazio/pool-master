/**
 * Fastify onResponse hook that automatically logs mutating admin API calls.
 *
 * Captures POST, PUT, PATCH, and DELETE requests to /api/v1/admin/* that
 * return a 2xx status. GET/HEAD/OPTIONS are skipped since reads do not
 * need auditing. Failed requests (non-2xx) are also skipped.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logAdminAction } from '../modules/admin/admin-audit-service';

/** HTTP methods that never mutate data. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Admin route prefix to match. */
const ADMIN_PREFIX = '/api/v1/admin';

/** Routes that should not be auto-logged (they are read-only despite being under admin). */
const SKIP_ROUTES = new Set([
  '/api/v1/admin/audit-log',
  '/api/v1/admin/audit-log/export',
]);

/**
 * Derives the admin action name from the HTTP method and URL path.
 *
 * Examples:
 *   POST /api/v1/admin/providers/manual-ingestion -> "providers.manual-ingestion"
 *   PUT  /api/v1/admin/config/poll-intervals      -> "config.poll-intervals"
 *   DELETE /api/v1/admin/users/:id                -> "users.delete"
 */
function deriveAction(method: string, url: string): string {
  const path = url.split('?')[0];
  const segments = path.replace(ADMIN_PREFIX + '/', '').split('/');
  const resource = segments[0] ?? 'unknown';
  const subAction = segments.length > 2 ? segments[segments.length - 1] : undefined;
  if (subAction) {
    return `${resource}.${subAction}`;
  }
  const verbMap: Record<string, string> = {
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
  };
  return `${resource}.${verbMap[method] ?? 'action'}`;
}

/**
 * Extracts the resource type and ID from the URL path.
 *
 * Examples:
 *   /api/v1/admin/providers/pga/manual-ingestion -> { type: "PROVIDERS", id: "pga" }
 *   /api/v1/admin/users/usr-456                  -> { type: "USER", id: "usr-456" }
 */
function deriveResource(url: string): { type: string; id: string } {
  const path = url.split('?')[0];
  const segments = path.replace(ADMIN_PREFIX + '/', '').split('/');
  const type = (segments[0] ?? 'UNKNOWN').toUpperCase().replace(/-/g, '_');
  const id = segments[1] ?? 'unknown';
  return { type, id };
}

/** Checks whether a status code represents a successful response. */
function isSuccessStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/**
 * Registers the admin audit hook on the Fastify instance.
 *
 * Usage: await app.register(adminAuditHook);
 */
export async function adminAuditHook(app: FastifyInstance): Promise<void> {
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (READ_ONLY_METHODS.has(request.method)) return;
    if (!request.url.startsWith(ADMIN_PREFIX)) return;
    if (!isSuccessStatus(reply.statusCode)) return;
    const basePath = request.url.split('?')[0];
    if (SKIP_ROUTES.has(basePath)) return;
    const adminUserId = request.adminContext?.adminUser.id ?? 'unknown';
    const adminUserEmail = request.adminContext?.adminUser.email ?? 'unknown';
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'] ?? 'unknown';
    const action = deriveAction(request.method, request.url);
    const resource = deriveResource(request.url);
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action,
      resourceType: resource.type,
      resourceId: resource.id,
      description: `${request.method} ${request.url} — ${reply.statusCode}`,
      ipAddress,
      userAgent,
    });
  });
}
