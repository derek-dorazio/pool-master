/**
 * #856 — `request.ip`, which the per-address rate limits key on, is the caller behind CloudFront
 * and the ALB rather than a proxy, and neither a forged X-Forwarded-For entry nor a connection
 * from outside the VPC can choose it. That the ALB admits CloudFront alone is Terraform's part
 * (infrastructure/terraform/main.tf).
 */
import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { readTrustProxy } from '../../../packages/core-api/src/core/config';

const DEPLOYED = { TRUSTED_PROXY_HOPS: '2', TRUSTED_PROXY_NETWORK: '10.0.0.0/16' };
const ALB_ADDRESS = '10.0.1.20';
const CLOUDFRONT_EDGE = '130.176.0.1';
const CALLER = '198.51.100.7';
const FORGED = '203.0.113.99';

async function ipSeen(
  env: { TRUSTED_PROXY_HOPS?: string; TRUSTED_PROXY_NETWORK?: string },
  remoteAddress: string,
  forwardedFor: string,
): Promise<string> {
  const app = Fastify({ trustProxy: readTrustProxy(env) });
  app.get('/ip', (request) => ({ ip: request.ip }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    return response.json<{ ip: string }>().ip;
  } finally {
    await app.close();
  }
}

describe('readTrustProxy', () => {
  it('trusts no proxy when neither setting is present', () => {
    expect(readTrustProxy({})).toBe(false);
  });

  it('refuses to start with only one of the two settings', () => {
    expect(() => readTrustProxy({ TRUSTED_PROXY_HOPS: '2' })).toThrow('must be set together');
    expect(() => readTrustProxy({ TRUSTED_PROXY_NETWORK: '10.0.0.0/16' })).toThrow('must be set together');
  });

  it('refuses to start on a hop count that is not a whole number from 1 to 5', () => {
    for (const hops of ['two', '1.5', '0', '6']) {
      expect(() => readTrustProxy({ ...DEPLOYED, TRUSTED_PROXY_HOPS: hops })).toThrow('TRUSTED_PROXY_HOPS');
    }
  });

  it('refuses to start on a network that is not an IPv4 CIDR', () => {
    for (const network of ['10.0.0.0', '10.0.0.0/33', 'vpc/16', '::1/128']) {
      expect(() => readTrustProxy({ ...DEPLOYED, TRUSTED_PROXY_NETWORK: network })).toThrow('TRUSTED_PROXY_NETWORK');
    }
  });
});

describe('request.ip behind CloudFront and the ALB', () => {
  it('is the caller CloudFront saw, not the CloudFront edge or the ALB', async () => {
    await expect(ipSeen(DEPLOYED, ALB_ADDRESS, `${CALLER}, ${CLOUDFRONT_EDGE}`)).resolves.toBe(CALLER);
  });

  it('ignores an entry the caller forged in front of the real ones', async () => {
    await expect(ipSeen(DEPLOYED, ALB_ADDRESS, `${FORGED}, ${CALLER}, ${CLOUDFRONT_EDGE}`)).resolves.toBe(CALLER);
  });

  it('trusts no header from a connection outside the VPC, so a direct caller cannot pick an address', async () => {
    await expect(ipSeen(DEPLOYED, CALLER, `${FORGED}, ${FORGED}`)).resolves.toBe(CALLER);
  });

  it('recognises the ALB when the socket reports it as an IPv4-mapped IPv6 address', async () => {
    await expect(ipSeen(DEPLOYED, `::ffff:${ALB_ADDRESS}`, `${CALLER}, ${CLOUDFRONT_EDGE}`)).resolves.toBe(CALLER);
  });

  it('is the connecting address when no proxy is configured, whatever the header says', async () => {
    await expect(ipSeen({}, ALB_ADDRESS, FORGED)).resolves.toBe(ALB_ADDRESS);
  });
});
