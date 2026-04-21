import { StandingsService, StandingsError } from '../../../packages/core-api/src/modules/standings/service';

describe('StandingsService', () => {
  it('returns standings page with normalized pagination and rank order', async () => {
    const prisma = {
      contestEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            name: 'Alpha',
            totalScore: 98,
            standingsPosition: 1,
            isEliminated: false,
            createdAt: new Date('2026-04-01T10:00:00Z'),
            updatedAt: new Date('2026-04-01T10:05:00Z'),
            squad: {
              name: 'Alpha Squad',
              memberships: [
                {
                  user: {
                    id: 'user-1',
                    firstName: 'Alice',
                    lastName: 'Adams',
                  },
                },
              ],
            },
          },
          {
            id: 'entry-2',
            name: 'Beta',
            totalScore: 91,
            standingsPosition: 2,
            isEliminated: false,
            createdAt: new Date('2026-04-01T10:01:00Z'),
            updatedAt: new Date('2026-04-01T10:06:00Z'),
            squad: {
              name: 'Beta Squad',
              memberships: [
                {
                  user: {
                    id: 'user-2',
                    firstName: 'Bob',
                    lastName: 'Baker',
                  },
                },
              ],
            },
          },
        ]),
      },
    } as any;

    const service = new StandingsService(prisma);

    const result = await service.getStandings('contest-1', { page: 0, pageSize: 200, sortBy: 'rank' });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
    expect(result.total).toBe(2);
    expect(result.standings.map((entry) => entry.entryId)).toEqual(['entry-1', 'entry-2']);
  });

  it('throws STANDINGS_UNAVAILABLE when no contest entries exist', async () => {
    const prisma = {
      contestEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const service = new StandingsService(prisma);

    await expect(service.getStandings('contest-1')).rejects.toMatchObject<Partial<StandingsError>>({
      code: 'STANDINGS_UNAVAILABLE',
      statusCode: 409,
    });
  });

  it('throws ENTRY_NOT_FOUND when the user has no standings entry', async () => {
    const prisma = {
      contestEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            name: 'Alpha',
            totalScore: 98,
            standingsPosition: 1,
            isEliminated: false,
            createdAt: new Date('2026-04-01T10:00:00Z'),
            updatedAt: new Date('2026-04-01T10:05:00Z'),
            squad: {
              name: 'Alpha Squad',
              memberships: [
                {
                  user: {
                    id: 'user-1',
                    firstName: 'Alice',
                    lastName: 'Adams',
                  },
                },
              ],
            },
          },
        ]),
      },
    } as any;

    const service = new StandingsService(prisma);

    await expect(service.getMyEntry('contest-1', 'user-missing')).rejects.toMatchObject<Partial<StandingsError>>({
      code: 'ENTRY_NOT_FOUND',
      statusCode: 404,
    });
  });
});
