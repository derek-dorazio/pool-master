import Fastify from 'fastify';
import { healthPlugin } from '../../../packages/core-api/src/plugins/health';

describe('GET /health', () => {
  const app = Fastify();
  app.register(healthPlugin);

  it('returns ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'core-api' });
  });
});
