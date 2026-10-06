import { expect } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import { MockContestFeedAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter';
import { startMockContestFeedProvider, type RunningMockContestFeedProvider } from '../mock-contest-feed-provider-helper';

// #383 — the real mock serves the PGA TOUR and LPGA season slates through the same adapter
// calls PoolMaster's catalog browse and field load use. No database is involved.

let mockProvider: RunningMockContestFeedProvider;

beforeAll(async () => {
  mockProvider = await startMockContestFeedProvider();
});

afterAll(async () => {
  await mockProvider.close();
});

describe('mock contest feed tour seeds through the adapter', () => {
  it('lists the 2027 Masters from the PGA TOUR 2027 slate with its tour name and linking id', async () => {
    const adapter = new MockContestFeedAdapter(mockProvider.baseUrl);

    const events = await adapter.getUpcomingEvents(Sport.GOLF, {
      from: new Date('2027-04-05T00:00:00.000Z'),
      to: new Date('2027-04-11T23:59:59.000Z'),
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalId: 'pga-tour-2027-masters-tournament',
        name: 'Masters Tournament',
        metadata: expect.objectContaining({ tour: 'PGA TOUR', scenarioId: 'pga-tour-2027' }),
      }),
    ]));
    expect(events.every((event) => event.startDate >= new Date('2027-04-05T00:00:00.000Z'))).toBe(true);
  });

  it('loads a seeded LPGA event\'s field: the LPGA Tour\'s ranked players, led by the world number one', async () => {
    const adapter = new MockContestFeedAdapter(mockProvider.baseUrl);

    const detail = await adapter.getEventDetails('lpga-tour-2026-the-chevron-championship');

    expect(detail).not.toBeNull();
    expect(detail!.participants.length).toBeGreaterThanOrEqual(140);
    expect(detail!.participants.every((participant) => participant.externalId.startsWith('lpga-tour-'))).toBe(true);
    expect(detail!.participants.map((participant) => participant.name)).toContain('Nelly Korda');
  });
});
