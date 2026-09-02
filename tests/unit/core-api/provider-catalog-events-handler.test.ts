/**
 * Unit tests for the sync-lane adminListProviderCatalogEvents handler added
 * in pool-master-753 (plans/124 §3.4/§4.4/§5.1).
 */
import { createProviderHandlers } from '../../../packages/core-api/src/modules/admin/provider-handler';
import { EventScoreSourceError } from '../../../packages/core-api/src/modules/events/event-score-source-service';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildCatalogEventRow(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'ext-1',
    name: 'The Masters',
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: new Date('2027-04-11T00:00:00.000Z'),
    status: 'SCHEDULED',
    ...overrides,
  };
}

function buildHandlers(eventScoreSourceOverrides: Record<string, unknown> = {}) {
  const eventScoreSourceService = {
    listCandidateEvents: jest.fn().mockResolvedValue([buildCatalogEventRow()]),
    ...eventScoreSourceOverrides,
  };
  const providerService = {} as any;
  const handlers = createProviderHandlers(providerService, eventScoreSourceService as any);
  return { handlers, eventScoreSourceService };
}

describe('pool-master-753 — adminListProviderCatalogEvents handler', () => {
  it('parses the query, delegates to EventScoreSourceService, and returns the canonical DTO shape', async () => {
    const { handlers, eventScoreSourceService } = buildHandlers();
    const reply = buildReply();

    await handlers.listProviderCatalogEvents({
      params: { providerId: 'mock-golf' },
      query: {
        sport: 'GOLF',
        sportLeagueId: 'league-1',
        from: '2027-04-05T00:00:00.000Z',
        to: '2027-04-14T00:00:00.000Z',
        search: 'masters',
      },
    } as any, reply as any);

    expect(eventScoreSourceService.listCandidateEvents).toHaveBeenCalledWith('mock-golf', 'GOLF', {
      sportLeagueId: 'league-1',
      from: new Date('2027-04-05T00:00:00.000Z'),
      to: new Date('2027-04-14T00:00:00.000Z'),
      search: 'masters',
    });
    expect(reply.send).toHaveBeenCalledWith({
      events: [{
        externalId: 'ext-1',
        name: 'The Masters',
        startDate: '2027-04-08T00:00:00.000Z',
        endDate: '2027-04-11T00:00:00.000Z',
        status: 'SCHEDULED',
      }],
    });
  });

  it('pool-master-753 leaves from/to/search/sportLeagueId undefined when the query omits them', async () => {
    const { handlers, eventScoreSourceService } = buildHandlers();
    const reply = buildReply();

    await handlers.listProviderCatalogEvents({
      params: { providerId: 'mock-golf' },
      query: { sport: 'GOLF' },
    } as any, reply as any);

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

    await handlers.listProviderCatalogEvents({
      params: { providerId: 'unknown' },
      query: { sport: 'GOLF' },
    } as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' }),
    }));
  });
});
