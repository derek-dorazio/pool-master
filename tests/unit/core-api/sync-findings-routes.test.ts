import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import {
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  Sport,
  type ProviderSyncFinding,
} from '@poolmaster/shared/domain';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import { syncFindingsModule } from '../../../packages/core-api/src/modules/ingestion/findings/routes';
import type { ProviderSyncFindingService } from '../../../packages/core-api/src/modules/ingestion/findings/provider-sync-finding-service';

// The sync findings routes (#1999) over a scripted finding service: what reaches the service,
// and that a failure the routes do not own goes to the app's error handler. The real service and
// its refusals are covered against Postgres in sync-findings.integration.ts.

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;
const FINDING_ID = '00000000-0000-4000-8000-0000000000f1';

const finding: ProviderSyncFinding = {
  id: FINDING_ID,
  kind: ProviderSyncFindingKind.SEASON_MISSING,
  severity: ProviderSyncFindingSeverity.ERROR,
  status: ProviderSyncFindingStatus.RESOLVED,
  sportLeague: { id: 'league-1', name: 'League', sport: Sport.GOLF },
  sportEvent: null,
  provider: null,
  providerValue: null,
  providerValueName: null,
  syncKind: null,
  waiveNote: null,
  firstSeenAt: new Date('2026-11-01T00:00:00.000Z'),
  lastSeenAt: new Date('2026-11-02T00:00:00.000Z'),
  seenCount: 2,
  statusChangedAt: new Date('2026-11-03T00:00:00.000Z'),
  statusChangedBy: null,
};

const get = jest.fn<ReturnType<ProviderSyncFindingService['get']>, Parameters<ProviderSyncFindingService['get']>>();
const changeStatus = jest.fn<ReturnType<ProviderSyncFindingService['changeStatus']>, Parameters<ProviderSyncFindingService['changeStatus']>>();
let app: FastifyInstance;

const headers = {
  authorization: `Bearer ${jwt.sign({ sub: 'root-1', email: 'root-1@example.test', isRootAdmin: true }, JWT_SECRET, { expiresIn: '15m' })}`,
};

beforeEach(async () => {
  get.mockReset();
  changeStatus.mockReset();
  app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  app.decorate('prisma', {} as unknown as PrismaClient);
  app.setErrorHandler(globalErrorHandler);
  await app.register(authGuard);
  await app.register(syncFindingsModule, { syncFindings: { get, changeStatus } as unknown as ProviderSyncFindingService });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('sync findings routes', () => {
  it('passes no waive note to the service when a status change sends none, naming the admin who made it', async () => {
    changeStatus.mockResolvedValue(finding);

    const response = await app.inject({ method: 'POST', url: `/${FINDING_ID}/status`, headers, payload: { action: 'RESOLVE' } });

    expect(response.statusCode).toBe(200);
    expect(changeStatus).toHaveBeenCalledWith(FINDING_ID, { action: 'RESOLVE', waiveNote: null, userId: 'root-1' });
  });

  it('leaves a failure that is not a finding or participant refusal to the app error handler as a 500', async () => {
    get.mockRejectedValue(new Error('database down'));

    const response = await app.inject({ method: 'GET', url: `/${FINDING_ID}`, headers });

    expect(response.statusCode).toBe(500);
  });
});
