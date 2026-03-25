import { buildApp } from '@poolmaster/core-api';

describe('GET /health', () => {
  const app = buildApp();

  it('returns ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'core-api' });
  });
});
