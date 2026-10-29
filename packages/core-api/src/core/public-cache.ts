/**
 * The public reads CloudFront and browsers may keep (#1181): a named list of anonymous GETs that
 * answer every visitor alike (the event pages, How to Play's templates and sport leagues, the
 * Plans page). A visitor with no session gets `public` with 5 minutes in the browser and 1 hour
 * at CloudFront; every other GET, and these same reads when the request carries a session, must
 * be revalidated and are never stored by a shared cache.
 *
 * CloudFront keys these paths on the query string, the Authorization header and the access
 * cookie (infrastructure/terraform/cloudfront.tf), so every visitor without a session shares one
 * copy and a signed-in request never does. An admin save calls `CdnInvalidator` with the
 * `PublicReadPath` it changed, so its effect shows without waiting out the hour.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { readCacheTtlMs } from './read-cache';
import { readAccessCookie } from './session-cookies';

/** 5 minutes in the browser, 1 hour at CloudFront, and a minute more served while it refetches. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=60';

/** The seconds `PUBLIC_CACHE_CONTROL` lets a copy be served: an hour, then a minute while it refetches. */
const PUBLIC_CACHE_SECONDS = 3600 + 60;
const BROWSER_SECONDS = 300;

/** Anything with user data, or a public read asked for with a session: revalidate, never shared. */
export const PRIVATE_CACHE_CONTROL = 'private, no-cache';

/**
 * The CloudFront path pattern of each public read, which is also what an admin save invalidates.
 * cloudfront.tf has one cache behavior per value, ahead of `/api/*`; a unit test holds them equal.
 */
export const PublicReadPath = {
  EVENT_PAGES: '/api/v1/event-pages*',
  SPORT_LEAGUES: '/api/v1/sport-leagues*',
  CONTEST_CONFIG_TEMPLATES: '/api/v1/contest-config-templates*',
  PLANS: '/api/v1/plans*',
} as const;
export type PublicReadPath = (typeof PublicReadPath)[keyof typeof PublicReadPath];

/** The routes, as registered, whose anonymous 200 answers are public. Each is also public in the auth guard. */
export const PUBLIC_CACHED_READS: ReadonlySet<string> = new Set([
  '/api/v1/event-pages',
  '/api/v1/event-pages/:sport/:pageSlug',
  '/api/v1/sport-leagues',
  '/api/v1/contest-config-templates',
  '/api/v1/plans',
]);

/** A route registered at its prefix root answers at `/x` and `/x/`; both are the one route. */
function withoutTrailingSlash(url: string): string {
  return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
}

/** Whether the request carries a session: a Bearer or other Authorization header, or the access cookie. */
function hasSession(request: FastifyRequest): boolean {
  return request.headers.authorization !== undefined || readAccessCookie(request.headers.cookie) !== undefined;
}

const changesAt = new WeakMap<FastifyReply, Date>();

/**
 * Says this public answer shows as it does only until `at` (an event page's offer closes then),
 * so no copy of it is served past that moment. Null leaves the hour.
 */
export function keepPublicUntil(reply: FastifyReply, at: Date | null): void {
  if (at === null) changesAt.delete(reply);
  else changesAt.set(reply, at);
}

/** The public header for an answer that changes in `seconds`: no copy outlives it. */
function publicFor(seconds: number): string {
  if (seconds >= PUBLIC_CACHE_SECONDS) return PUBLIC_CACHE_CONTROL;
  if (seconds <= 0) return PRIVATE_CACHE_CONTROL;
  return `public, max-age=${Math.min(BROWSER_SECONDS, seconds)}, s-maxage=${seconds}`;
}

/** The Cache-Control a GET answer gets, as of `now`. */
export function cacheControlFor(request: FastifyRequest, reply: FastifyReply, now: Date = new Date()): string {
  const route = request.routeOptions.url;
  const isPublicRead = route !== undefined && PUBLIC_CACHED_READS.has(withoutTrailingSlash(route));
  if (!isPublicRead || reply.statusCode !== 200 || hasSession(request)) {
    return PRIVATE_CACHE_CONTROL;
  }
  const at = changesAt.get(reply);
  return at === undefined
    ? PUBLIC_CACHE_CONTROL
    : publicFor(Math.floor((at.getTime() - now.getTime()) / 1000));
}

/**
 * The TTL from `PUBLIC_READ_CACHE_TTL_MS`, in milliseconds, else 30 seconds; see `readCacheTtlMs`.
 * How long each API task keeps a public read it computed, which signed-in viewers and CloudFront's
 * refills share.
 */
export function readPublicReadCacheTtlMs(env: NodeJS.ProcessEnv): number {
  return readCacheTtlMs(env, 'PUBLIC_READ_CACHE_TTL_MS');
}
