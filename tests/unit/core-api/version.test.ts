import { expect } from '@jest/globals';
import Fastify from 'fastify';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import { ServiceVersionResponseSchema, type ServiceVersionResponse } from '../../../packages/shared/dto';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { AppEnvironment } from '../../../packages/core-api/src/core/config';
import type { VersionInfo } from '../../../packages/core-api/src/core/version-info';
import { versionModule } from '../../../packages/core-api/src/modules/version/routes';
import { VersionService } from '../../../packages/core-api/src/modules/version/service';

/** What the build wrote into version-info.json for this image. */
const BUILD: VersionInfo = {
  schemaVersion: 1,
  buildTimeUtc: '2026-04-27T14:05:30.000Z',
  gitRef: 'main',
  service: {
    name: '@poolmaster/core-api',
    version: '2026.04.27+abcdef',
    gitSha: 'abcdef1234567890',
    buildNumber: '2468',
  },
};

function serviceFor(build: VersionInfo): VersionService {
  return new VersionService(build, AppEnvironment.QA, 'v24.21.0');
}

describe('service version metadata', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    // auth-guard registers in the second case; its bootstrap throws if JWT_SECRET is unset.
    process.env.JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('serves the build identity from version-info.json and the runtime environment from /api/v1/version', async () => {
    const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });

    app.register(versionModule, { prefix: '/api/v1/version', versionService: serviceFor(BUILD) });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/v1/version' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ServiceVersionResponse>();
    expect(ServiceVersionResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      schemaVersion: 1,
      environment: 'qa',
      buildTimeUtc: '2026-04-27T14:05:30.000Z',
      gitRef: 'main',
      service: BUILD.service,
      runtime: { nodeVersion: 'v24.21.0' },
    });

    await app.close();
  });

  it('keeps /version public when the auth guard is registered before the route', async () => {
    const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });

    app.register(authGuard);
    app.register(versionModule, {
      prefix: '/version',
      operationId: 'getRootVersion',
      versionService: serviceFor(BUILD),
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/version' });

    expect(response.statusCode).toBe(200);
    expect(response.json<ServiceVersionResponse>().service.version).toBe('2026.04.27+abcdef');

    await app.close();
  });

  it('reports a build with no git ref or build number as null, never a made-up value', () => {
    const version = serviceFor({
      ...BUILD,
      gitRef: null,
      service: { ...BUILD.service, gitSha: null, buildNumber: null },
    }).getVersion();

    expect(version.gitRef).toBeNull();
    expect(version.service.gitSha).toBeNull();
    expect(version.service.buildNumber).toBeNull();
  });
});
