import Fastify from 'fastify';
import {
  IngestionJobResponseSchema,
  IngestionProvidersResponseSchema,
  IngestSportOddsResponseSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { ingestionModule } from '../../../packages/core-api/src/modules/ingestion/routes';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import {
  cleanupTestData,
  getApp,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import type {
  ProviderEventResult,
  ProviderHealthStatus,
  ProviderParticipant,
  ProviderRanking,
  ProviderStatEvent,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';

class ContractProvider implements SportDataProvider {
  providerId = 'contract-provider';
  providerName = 'Contract Provider';
  sportsCovered: Sport[] = ['GOLF'];

  async getUpcomingEvents(): Promise<SportEvent[]> { return []; }
  async getEventDetails(): Promise<SportEventDetail | null> { return null; }
  async getParticipants(): Promise<ProviderParticipant[]> { return []; }
  async getRankings(): Promise<ProviderRanking[]> { return []; }
  async getLiveScores(): Promise<ProviderStatEvent[]> { return []; }
  async getEventResults(): Promise<ProviderEventResult | null> { return null; }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      providerId: this.providerId,
      status: 'HEALTHY',
      errorRateLastHour: 0,
      latencyMsP95: 5,
    };
  }
}

describe('API contracts (root admin)', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownIntegrationTests();
  });

  it('ingestion root-admin routes match their DTOs', async () => {
    const app = Fastify({ logger: false });
    const registry = new ProviderRegistry();
    registry.register('GOLF', new ContractProvider(), 'PRIMARY');

    await app.register(ingestionModule, {
      prefix: '/api/v1/admin/ingestion',
      registry,
      scheduler: {
        async syncSport() {
          return {
            jobType: 'SCHEDULE_SYNC',
            providerId: 'contract-provider',
            sport: 'GOLF',
            status: 'COMPLETED',
            startedAt: new Date('2026-04-09T10:00:00.000Z'),
            completedAt: new Date('2026-04-09T10:00:01.000Z'),
            recordsProcessed: 2,
            errors: 0,
            errorLog: [],
          };
        },
        async pollLiveScores() {
          return {
            jobType: 'LIVE_SCORES',
            providerId: 'contract-provider',
            sport: 'GOLF',
            eventExternalId: 'event-1',
            status: 'COMPLETED',
            startedAt: new Date('2026-04-09T10:00:00.000Z'),
            completedAt: new Date('2026-04-09T10:00:01.000Z'),
            recordsProcessed: 1,
            errors: 0,
            errorLog: [],
          };
        },
        async fetchEventResults() {
          return {
            jobType: 'EVENT_RESULTS',
            providerId: 'contract-provider',
            sport: 'GOLF',
            eventExternalId: 'event-1',
            status: 'COMPLETED',
            startedAt: new Date('2026-04-09T10:00:00.000Z'),
            completedAt: new Date('2026-04-09T10:00:01.000Z'),
            recordsProcessed: 1,
            errors: 0,
            errorLog: [],
          };
        },
      } as any,
      oddsAdapter: {
        async getOdds() {
          return [{
            eventId: 'event-1',
            sport: 'GOLF',
            homeTeam: 'Player A',
            awayTeam: 'Player B',
            commenceTime: new Date('2026-04-09T12:00:00.000Z'),
            odds: [],
          }];
        },
      } as any,
    });

    await app.ready();

    const providersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/ingestion/providers',
    });
    expect(providersRes.statusCode).toBe(200);
    expect(IngestionProvidersResponseSchema.safeParse(providersRes.json()).success).toBe(true);

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingestion/sync/GOLF',
    });
    expect(syncRes.statusCode).toBe(200);
    expect(IngestionJobResponseSchema.safeParse(syncRes.json()).success).toBe(true);

    const oddsRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingestion/odds/GOLF',
    });
    expect(oddsRes.statusCode).toBe(200);
    expect(IngestSportOddsResponseSchema.safeParse(oddsRes.json()).success).toBe(true);

    await app.close();
  });

  it('admin routes reject missing root-admin identity with ErrorEnvelopeSchema', async () => {
    const res = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
    });

    expect(res.statusCode).toBe(401);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
  });
});
