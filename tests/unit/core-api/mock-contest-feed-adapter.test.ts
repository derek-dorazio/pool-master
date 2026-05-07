import { Sport } from '../../../packages/shared/domain';
import { MockContestFeedAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter';

const scenarioResponse = {
  scenarios: [{ scenarioId: 'golf-major-2026', sport: 'GOLF' }],
};

const eventListResponse = {
  scenarioId: 'golf-major-2026',
  events: [
    {
      eventId: 'golf-masters-2026',
      name: 'Masters Tournament 2026',
      status: 'field_announced',
      startsAt: '2026-04-09T14:00:00.000Z',
      endsAt: '2026-04-12T22:00:00.000Z',
      releaseAt: '2026-04-06T12:00:00.000Z',
      fieldLocksAt: '2026-04-08T12:00:00.000Z',
      venueName: 'Augusta National',
      fieldStatus: 'announced',
      contestantCount: 2,
    },
  ],
};

const eventDetailResponse = {
  scenarioId: 'golf-major-2026',
  sport: 'GOLF',
  season: {
    seasonId: 'pga-2026',
    name: 'PGA Tour 2026',
    year: 2026,
  },
  event: {
    eventId: 'golf-masters-2026',
    name: 'Masters Tournament 2026',
    status: 'field_announced',
    schedule: {
      startsAt: '2026-04-09T14:00:00.000Z',
      endsAt: '2026-04-12T22:00:00.000Z',
      releaseAt: '2026-04-06T12:00:00.000Z',
      fieldLocksAt: '2026-04-08T12:00:00.000Z',
    },
    venue: {
      name: 'Augusta National',
      city: 'Augusta',
      region: 'GA',
      countryCode: 'US',
    },
    metadata: {
      eventType: 'MAJOR',
      tour: 'PGA',
      externalEventId: 'golf-masters-2026',
    },
    field: {
      asOf: '2026-04-07T12:00:00.000Z',
      status: 'announced',
      contestants: [
        {
          contestantId: 'scottie-scheffler',
          name: 'Scottie Scheffler',
          countryCode: 'US',
          ranking: 1,
        },
        {
          contestantId: 'rory-mcilroy',
          name: 'Rory McIlroy',
          countryCode: 'GB',
          ranking: 2,
        },
      ],
    },
    feeds: {
      odds: {
        asOf: '2026-04-07T12:00:00.000Z',
        contestants: [
          { contestantId: 'scottie-scheffler', odds: 6.5 },
          { contestantId: 'rory-mcilroy', odds: 8.0 },
        ],
      },
      rankings: {
        asOf: '2026-04-07T12:00:00.000Z',
        contestants: [
          { contestantId: 'scottie-scheffler', ranking: 1 },
          { contestantId: 'rory-mcilroy', ranking: 2 },
        ],
      },
      results: {
        asOf: '2026-04-10T22:00:00.000Z',
        contestants: [
          { contestantId: 'scottie-scheffler', score: -4 },
          { contestantId: 'rory-mcilroy', score: -2 },
        ],
      },
    },
  },
};

describe('MockContestFeedAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('maps mock provider schedule, participants, rankings, scores, and results', async () => {
    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return okJson({ status: 'ok' });
      }
      if (url.endsWith('/v1/scenarios')) {
        return okJson(scenarioResponse);
      }
      if (url.endsWith('/v1/scenarios/golf-major-2026/events')) {
        return okJson(eventListResponse);
      }
      if (url.endsWith('/v1/scenarios/golf-major-2026/events/golf-masters-2026/detail')) {
        return okJson(eventDetailResponse);
      }
      if (url.endsWith('/v1/scenarios/golf-major-2026/events/golf-masters-2026/scores')) {
        return okJson({
          asOf: '2026-04-10T22:30:00.000Z',
          contestants: [
            { contestantId: 'scottie-scheffler', score: -4 },
            { contestantId: 'rory-mcilroy', score: -5 },
          ],
        });
      }
      if (url.endsWith('/v1/scenarios/golf-major-2026/events/golf-masters-2026/results')) {
        return okJson({
          contestants: [
            { contestantId: 'scottie-scheffler', score: -4 },
            { contestantId: 'rory-mcilroy', score: -5 },
          ],
        });
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    }) as typeof fetch;

    const adapter = new MockContestFeedAdapter('http://mock-contest-feed-provider.qa.poolmaster.internal:3105');

    const events = await adapter.getUpcomingEvents(Sport.GOLF, {
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-30T00:00:00.000Z'),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.externalId).toBe('golf-masters-2026');
    expect(events[0]?.sport).toBe(Sport.GOLF);

    const detail = await adapter.getEventDetails('golf-masters-2026');
    expect(detail?.participants).toHaveLength(2);

    const rankings = await adapter.getRankings(Sport.GOLF, 'OWGR');
    expect(rankings.map((ranking) => ranking.rank)).toEqual([1, 2]);

    // pool-master-rop.78.3 — the typed LiveScoreResult contract replaced
    // the legacy ProviderStatEvent[] shape. plans/117 §10.2.
    const liveScores = await adapter.getLiveScores('golf-masters-2026');
    expect(liveScores.category).toBe('GOLF');
    if (liveScores.category === 'GOLF') {
      expect(liveScores.rounds).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            participantExternalId: 'rory-mcilroy',
            scoreToPar: -5,
            round: 1,
            status: 'IN_PROGRESS',
          }),
        ]),
      );
    }

    const results = await adapter.getEventResults('golf-masters-2026');
    expect(results?.results[0]?.participantExternalId).toBe('rory-mcilroy');

    const health = await adapter.healthCheck();
    expect(health.status).toBe('HEALTHY');
  });

  it('pool-master-s4y: resolves historical relative manual-test event details after provider list rolls forward', async () => {
    const historicalEventId = 'golf-relative-manual-test-20260426t214000z';
    const relativeScenarioResponse = {
      scenarios: [{ scenarioId: 'golf-relative-today', sport: 'GOLF' }],
    };
    const rolledEventListResponse = {
      scenarioId: 'golf-relative-today',
      events: [
        {
          eventId: 'golf-relative-manual-test-20260426t230500z',
          name: 'Manual Test Golf Tournament for 2026-04-26T23:05:00.000Z',
          status: 'field_announced',
          startsAt: '2026-04-26T23:05:00.000Z',
          endsAt: '2026-04-26T23:25:00.000Z',
          releaseAt: '2026-04-26T22:20:00.000Z',
          fieldLocksAt: '2026-04-26T22:45:00.000Z',
          fieldStatus: 'announced',
          contestantCount: 2,
        },
      ],
    };
    const historicalDetailResponse = {
      ...eventDetailResponse,
      scenarioId: 'golf-relative-today',
      event: {
        ...eventDetailResponse.event,
        eventId: historicalEventId,
        name: 'Manual Test Golf Tournament for 2026-04-26T21:40:00.000Z',
        metadata: {
          ...eventDetailResponse.event.metadata,
          eventType: 'relative-manual-test',
          externalEventId: historicalEventId,
        },
      },
    };

    global.fetch = jest.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.endsWith('/v1/scenarios')) {
        return okJson(relativeScenarioResponse);
      }
      if (url.endsWith('/v1/scenarios/golf-relative-today/events')) {
        return okJson(rolledEventListResponse);
      }
      if (url.endsWith(`/v1/scenarios/golf-relative-today/events/${historicalEventId}/detail`)) {
        return okJson(historicalDetailResponse);
      }

      throw new Error(`Unhandled fetch URL: ${url}`);
    }) as typeof fetch;

    const adapter = new MockContestFeedAdapter('http://mock-contest-feed-provider.qa.poolmaster.internal:3105');

    const detail = await adapter.getEventDetails(historicalEventId);

    expect(detail?.externalId).toBe(historicalEventId);
    expect(detail?.participants).toHaveLength(2);
  });
});

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}
