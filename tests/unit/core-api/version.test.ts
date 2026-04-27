import Fastify from 'fastify';
import { ServiceVersionResponseSchema } from '../../../packages/shared/dto';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { versionModule } from '../../../packages/core-api/src/modules/version/routes';

describe('pool-master-htw service version metadata', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      POOLMASTER_ENVIRONMENT: 'qa',
      POOLMASTER_SERVICE_VERSION: '2026.04.27+abcdef',
      POOLMASTER_SERVICE_GIT_SHA: 'abcdef1234567890',
      POOLMASTER_BUILD_NUMBER: '2468',
      POOLMASTER_BUILD_TIME_UTC: '2026-04-27T14:05:30.000Z',
      POOLMASTER_GIT_REF: 'main',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns public service build metadata from /api/v1/version', async () => {
    const app = Fastify({ logger: false });

    app.register(versionModule, { prefix: '/api/v1/version' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/version',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(ServiceVersionResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      schemaVersion: 1,
      environment: 'qa',
      buildTimeUtc: '2026-04-27T14:05:30.000Z',
      gitRef: 'main',
      service: {
        name: '@poolmaster/core-api',
        version: '2026.04.27+abcdef',
        gitSha: 'abcdef1234567890',
        buildNumber: '2468',
      },
      runtime: {
        nodeVersion: expect.stringMatching(/^v\d+\./),
      },
    });

    await app.close();
  });

  it('keeps /version public when the auth guard is registered before the route', async () => {
    const app = Fastify({ logger: false });

    app.register(authGuard);
    app.register(versionModule, { prefix: '/version', operationId: 'getRootVersion' });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/version',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().service.version).toBe('2026.04.27+abcdef');

    await app.close();
  });
});
