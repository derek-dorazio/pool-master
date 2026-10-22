/**
 * #856 — deployed, every request reaches core-api through CloudFront and then the ALB, so the
 * connecting address is always the ALB's. The per-address rate limits must key on the caller
 * CloudFront saw, or one caller's burst gives every other caller a 429. This boots the real app
 * (`buildApp`) with the deployed proxy settings and sends reset requests from different callers
 * through one ALB address.
 */
import { expect } from '@jest/globals';
import type { FastifyInstance } from 'fastify';

const ALB_ADDRESS = '10.0.1.20';
const CLOUDFRONT_EDGE = '130.176.0.1';
const RESET_REQUESTS_PER_MINUTE = 5;

const savedEnv = { ...process.env };
let app: FastifyInstance;

beforeEach(async () => {
  Object.assign(process.env, {
    JWT_SECRET: process.env.JWT_SECRET ?? 'integration-trusted-proxy-secret',
    POOLMASTER_ENVIRONMENT: 'test',
    APP_BASE_URL: 'http://localhost:5173',
    AUTO_START_SCHEDULER: 'false',
    TRUSTED_PROXY_HOPS: '2',
    TRUSTED_PROXY_NETWORK: '10.0.0.0/16',
    // Importing the entry point would otherwise start a listening server.
    POOLMASTER_DISABLE_AUTO_START: 'true',
  });
  // Imported only now: the env above must be in place before the entry point loads.
  const { buildApp } = await import('../../../packages/core-api/src/index');
  app = buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  process.env = { ...savedEnv };
});

function requestResetFrom(caller: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/password-reset/request',
    remoteAddress: ALB_ADDRESS,
    headers: { 'x-forwarded-for': `${caller}, ${CLOUDFRONT_EDGE}` },
    payload: { identifier: `nobody-${caller}@example.test` },
  });
}

describe('per-address rate limits behind CloudFront and the ALB', () => {
  it('gives each caller their own reset-request limit, so other callers through the same ALB are never refused', async () => {
    const statuses: number[] = [];
    for (let caller = 1; caller <= RESET_REQUESTS_PER_MINUTE + 1; caller += 1) {
      statuses.push((await requestResetFrom(`198.51.100.${caller}`)).statusCode);
    }

    expect(statuses).toEqual(Array(RESET_REQUESTS_PER_MINUTE + 1).fill(202));
  });

  it('still refuses one caller who goes over the limit', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= RESET_REQUESTS_PER_MINUTE; attempt += 1) {
      statuses.push((await requestResetFrom('203.0.113.50')).statusCode);
    }

    expect(statuses.slice(0, RESET_REQUESTS_PER_MINUTE)).toEqual(Array(RESET_REQUESTS_PER_MINUTE).fill(202));
    expect(statuses[RESET_REQUESTS_PER_MINUTE]).toBe(429);
  });
});
