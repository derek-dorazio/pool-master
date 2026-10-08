import Fastify from 'fastify';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import jwt from 'jsonwebtoken';
import { requireRootAdmin } from '../../../packages/core-api/src/core/root-admin-guard';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;

// The root-admin write guard (#236) runs at `onRequest`, before validation and before the
// global auth guard's preHandler, so it reads the token itself. These cases pin both halves:
// a real root admin gets through with the auth guard registered as the app registers it, and
// a non-admin is refused with 403 even when the request would fail validation.

function bearer(isRootAdmin: boolean): Record<string, string> {
  const token = jwt.sign({ sub: 'user-1', email: 'user-1@example.test', isRootAdmin }, JWT_SECRET, { expiresIn: '15m' });
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function buildApp() {
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  app.setErrorHandler(globalErrorHandler);
  await app.register(authGuard);
  app.post('/things/:id', {
    onRequest: requireRootAdmin,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (request) => ({ isRootAdmin: request.authUser?.isRootAdmin }));
  await app.ready();
  return app;
}

describe('requireRootAdmin', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('lets a root admin through, and the auth guard still sets the user for the handler', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: `/things/${id}`, headers: bearer(true), payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isRootAdmin: true });
    await app.close();
  });

  it('refuses a signed-in caller without the claim with 403, before a malformed request is validated', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/things/not-a-uuid', headers: bearer(false), payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED' } });
    await app.close();
  });

  it('answers 401 without a token and for an invalid one', async () => {
    const app = await buildApp();
    const none = await app.inject({ method: 'POST', url: `/things/${id}`, payload: {} });
    const bad = await app.inject({ method: 'POST', url: `/things/${id}`, headers: { authorization: 'Bearer nope' }, payload: {} });
    expect(none.statusCode).toBe(401);
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toMatchObject({ error: { code: 'AUTH_ACCESS_TOKEN_INVALID' } });
    await app.close();
  });
});
