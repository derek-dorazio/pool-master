import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { etagPlugin } from '../../../packages/core-api/src/plugins/etag-support';
import {
  PRIVATE_CACHE_CONTROL,
  PUBLIC_CACHE_CONTROL,
  PUBLIC_CACHED_READS,
  PublicReadPath,
  readPublicReadCacheTtlMs,
} from '../../../packages/core-api/src/core/public-cache';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;

// #1181 — which GET answers CloudFront and the browser may keep. Stand-in routes at the public
// reads' real addresses, behind the real auth guard and ETag plugin, as index.ts registers them.

const TERRAFORM = readFileSync(join(__dirname, '../../../infrastructure/terraform/cloudfront.tf'), 'utf8');

function accessToken(): string {
  return jwt.sign({ sub: 'user-1', email: 'user-1@example.test', isRootAdmin: false }, JWT_SECRET, { expiresIn: '15m' });
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(etagPlugin);
  await app.register(authGuard);
  const prefixRoot = (prefix: string) => (scope: FastifyInstance) => {
    scope.get('/', async () => ({ read: prefix }));
  };
  for (const prefix of ['/api/v1/sport-leagues', '/api/v1/contest-config-templates', '/api/v1/plans', '/api/v1/leagues']) {
    await app.register(prefixRoot(prefix), { prefix });
  }
  await app.register((scope) => {
    scope.get('/', async () => ({ eventPages: [] }));
    scope.get('/:sport/:pageSlug', async (request, reply) => {
      const { pageSlug } = request.params as { pageSlug: string };
      return pageSlug === 'missing' ? reply.status(404).send({ code: 'EVENT_PAGE_NOT_FOUND' }) : { pageSlug };
    });
  }, { prefix: '/api/v1/event-pages' });
  await app.ready();
  return app;
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(() => app.close());

describe('Cache-Control on GET answers (#1181)', () => {
  it.each([
    '/api/v1/event-pages',
    '/api/v1/event-pages?sport=AMERICAN_FOOTBALL',
    '/api/v1/event-pages/AMERICAN_FOOTBALL/championship-weekend',
    '/api/v1/sport-leagues',
    '/api/v1/sport-leagues/',
    '/api/v1/contest-config-templates?active=true',
    '/api/v1/plans/',
  ])('gives a visitor with no session %s as public: 5 minutes in the browser, 1 hour at CloudFront', async (url) => {
    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    expect(PUBLIC_CACHE_CONTROL).toBe('public, max-age=300, s-maxage=3600, stale-while-revalidate=60');
  });

  it('keeps a public read private when it is asked for with the session cookie, so no shared cache stores a signed-in answer', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/sport-leagues', headers: { cookie: `poolmaster_access=${accessToken()}` } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('keeps a public read private when it is asked for with an Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/plans', headers: { authorization: `Bearer ${accessToken()}` } });

    expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('keeps a public read\'s 404 private, so an address that later gets a page is not cached as missing for an hour', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/event-pages/AMERICAN_FOOTBALL/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('gives a signed-in read of league data private, no-cache', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/leagues', headers: { authorization: `Bearer ${accessToken()}` } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });

  it('keeps the public header on a 304 revalidation of a public read', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/v1/plans' });
    const etag = first.headers.etag as string;

    const revalidated = await app.inject({ method: 'GET', url: '/api/v1/plans', headers: { 'if-none-match': etag } });

    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
  });
});

describe('the public read list stays in step with the auth guard and CloudFront (#1181)', () => {
  it('lists only routes the auth guard serves without a session', () => {
    // Each listed route answers 200 above with no session; a route the guard protects would be 401.
    expect([...PUBLIC_CACHED_READS].sort()).toEqual([
      '/api/v1/contest-config-templates',
      '/api/v1/event-pages',
      '/api/v1/event-pages/:sport/:pageSlug',
      '/api/v1/plans',
      '/api/v1/sport-leagues',
    ]);
  });

  it('puts every public read under a PublicReadPath, the pattern its admin saves invalidate', () => {
    const patterns = Object.values(PublicReadPath).map((pattern) => pattern.replace(/\*$/, ''));
    for (const route of PUBLIC_CACHED_READS) {
      expect(patterns.some((prefix) => route.startsWith(prefix))).toBe(true);
    }
  });

  it('gives CloudFront exactly one behavior per PublicReadPath, ahead of the uncached /api/* behavior', () => {
    const list = /public_api_paths = \[([^\]]*)\]/.exec(TERRAFORM)?.[1] ?? '';
    const terraformPaths = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(terraformPaths.sort()).toEqual(Object.values(PublicReadPath).sort());
    const webapp = TERRAFORM.slice(TERRAFORM.indexOf('resource "aws_cloudfront_distribution" "webapp"'));
    expect(webapp.indexOf('for_each = local.public_api_paths')).toBeGreaterThan(0);
    expect(webapp.indexOf('for_each = local.public_api_paths')).toBeLessThan(webapp.indexOf('path_pattern           = "/api/*"'));
  });

  it('keys CloudFront\'s copy on the Authorization header and the access cookie, so a session never shares one', () => {
    const policy = TERRAFORM.slice(TERRAFORM.indexOf('resource "aws_cloudfront_cache_policy" "public_api"'));
    const body = policy.slice(0, policy.indexOf('\n}\n'));

    expect(body).toContain('items = ["poolmaster_access"]');
    expect(body).toContain('items = ["Authorization"]');
    expect(body).toContain('max_ttl     = 3600');
  });
});

describe('PUBLIC_READ_CACHE_TTL_MS', () => {
  it('keeps a public read 30 seconds in each API task unless the environment says otherwise, and none at 0', () => {
    expect(readPublicReadCacheTtlMs({})).toBe(30_000);
    expect(readPublicReadCacheTtlMs({ PUBLIC_READ_CACHE_TTL_MS: '0' })).toBe(0);
    expect(() => readPublicReadCacheTtlMs({ PUBLIC_READ_CACHE_TTL_MS: 'soon' })).toThrow('PUBLIC_READ_CACHE_TTL_MS must be a whole number');
  });
});
