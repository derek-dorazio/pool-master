import request from 'supertest';
import { app } from '@poolmaster/core-api';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'core-api' });
  });
});
