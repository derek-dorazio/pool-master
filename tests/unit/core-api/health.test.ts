import Fastify from 'fastify';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import { healthPlugin } from '../../../packages/core-api/src/plugins/health';

describe('GET /health', () => {
  const app = Fastify({ ajv: FASTIFY_AJV_OPTIONS });
  app.register(healthPlugin);

  it('returns ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'core-api' });
  });
});
