/**
 * Unit tests for the listProviderCatalogEvents handler (pool-master-753, plans/124
 * §3.4/§4.4/§5.1; moved to the ingestion module and given the provider-event shape by #205).
 */
import { expect } from '@jest/globals';
import { createIngestionHandlers } from '../../../packages/core-api/src/modules/ingestion/handler';
import {
  EventScoreSourceError,
  EventScoreSourceService,
} from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { asFastifyReply, asFastifyRequest } from '../../support/fastify-doubles';
import { stubInstance } from '../../support/stub-instance';

type Handlers = ReturnType<typeof createIngestionHandlers>;
type CatalogEventsRequest = Parameters<Handlers['listProviderCatalogEvents']>[0];

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildCatalogEventRow(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'ext-1',
    providerId: 'mock-golf',
    sport: 'GOLF',
    name: 'The Masters',
    venue: 'Augusta National',
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: new Date('2027-04-11T00:00:00.000Z'),
    status: 'SCHEDULED',
    fieldLocked: false,
    metadata: {},
    ...overrides,
  };
}

function buildHandlers(eventScoreSourceOverrides: Partial<EventScoreSourceService> = {}) {
  const eventScoreSourceService = stubInstance(EventScoreSourceService, {
    listCandidateEvents: jest.fn().mockResolvedValue([buildCatalogEventRow()]),
    ...eventScoreSourceOverrides,
  });
  const handlers = createIngestionHandlers(stubInstance(IngestionService, {}), eventScoreSourceService);
  return { handlers, eventScoreSourceService };
}

describe('pool-master-753 — listProviderCatalogEvents handler', () => {
  it('parses the query, delegates to EventScoreSourceService, and returns each event as a provider event', async () => {
    const { handlers, eventScoreSourceService } = buildHandlers();
    const reply = buildReply();

    await handlers.listProviderCatalogEvents(asFastifyRequest<CatalogEventsRequest>({
      params: { providerId: 'mock-golf' },
      query: {
        sport: 'GOLF',
        sportLeagueId: 'league-1',
        from: '2027-04-05T00:00:00.000Z',
        to: '2027-04-14T00:00:00.000Z',
        search: 'masters',
      },
    }), asFastifyReply(reply));

    expect(eventScoreSourceService.listCandidateEvents).toHaveBeenCalledWith('mock-golf', 'GOLF', {
      sportLeagueId: 'league-1',
      from: new Date('2027-04-05T00:00:00.000Z'),
      to: new Date('2027-04-14T00:00:00.000Z'),
      search: 'masters',
    });
    expect(reply.send).toHaveBeenCalledWith({
      events: [{
        externalId: 'ext-1',
        providerId: 'mock-golf',
        sport: 'GOLF',
        name: 'The Masters',
        venue: 'Augusta National',
        location: null,
        startDate: '2027-04-08T00:00:00.000Z',
        endDate: '2027-04-11T00:00:00.000Z',
        status: 'SCHEDULED',
        rounds: null,
        participantCount: null,
        fieldLocked: false,
        metadata: {},
      }],
    });
  });

  it('pool-master-753 leaves from/to/search/sportLeagueId undefined when the query omits them', async () => {
    const { handlers, eventScoreSourceService } = buildHandlers();
    const reply = buildReply();

    await handlers.listProviderCatalogEvents(asFastifyRequest<CatalogEventsRequest>({
      params: { providerId: 'mock-golf' },
      query: { sport: 'GOLF' },
    }), asFastifyReply(reply));

    expect(eventScoreSourceService.listCandidateEvents).toHaveBeenCalledWith('mock-golf', 'GOLF', {
      sportLeagueId: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
    });
  });

  it('pool-master-753 maps an EventScoreSourceError to its statusCode/code', async () => {
    const { handlers } = buildHandlers({
      listCandidateEvents: jest.fn().mockRejectedValue(
        new EventScoreSourceError('Provider unknown was not found.', 'PROVIDER_NOT_FOUND', 404),
      ),
    });
    const reply = buildReply();

    await handlers.listProviderCatalogEvents(asFastifyRequest<CatalogEventsRequest>({
      params: { providerId: 'unknown' },
      query: { sport: 'GOLF' },
    }), asFastifyReply(reply));

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' }),
    }));
  });
});
