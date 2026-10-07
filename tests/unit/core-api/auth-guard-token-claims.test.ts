import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { authGuard, requireAuthUser } from '../../../packages/core-api/src/plugins/auth-guard';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;

// #153 — a signature-valid token is not enough: the user it names must be readable from it.
// The guard used to cast the payload to `{ sub: string; email: string }` without checking, so a
// token missing `sub` produced an authenticated request whose user id was `undefined`, which
// Prisma reads as "omit this filter". These cases pin the 401 that must happen instead.

function bearer(payload: object): Record<string, string> {
  return { authorization: `Bearer ${jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' })}` };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler(globalErrorHandler);
  await app.register(authGuard);
  app.get('/whoami', async (request) => ({ userId: requireAuthUser(request).userId }));
  // A route the guard skips, so the handler runs with no user: the case `requireAuthUser` covers.
  app.get('/health/whoami', async (request) => ({ userId: requireAuthUser(request).userId }));
  await app.ready();
  return app;
}

describe('auth guard token claims (#153)', () => {
  it('signs in a token carrying sub and email, and the handler reads that user', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: bearer({ sub: 'user-1', email: 'u@example.test' }) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'user-1' });
    await app.close();
  });

  it('refuses a signature-valid token with no sub with 401, never reaching the handler', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: bearer({ email: 'u@example.test' }) });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTH_ACCESS_TOKEN_INVALID' } });
    await app.close();
  });

  it('refuses a signature-valid token with an empty sub with 401', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: bearer({ sub: '', email: 'u@example.test' }) });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('refuses a signature-valid token with no email with 401', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: bearer({ sub: 'user-1' }) });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTH_ACCESS_TOKEN_INVALID' } });
    await app.close();
  });

  it('answers 401 AUTH_SESSION_REQUIRED, not a 500, when a handler requires a user the request does not have', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health/whoami' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTH_SESSION_REQUIRED' } });
    await app.close();
  });
});
