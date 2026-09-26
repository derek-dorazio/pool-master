/**
 * #202 step 3.3 — AdminLeagueService.searchLeagues, composed from repository ports.
 *
 * This service had NO tests. It was also one of the four with zero ports, and its
 * `searchLeagues` was a hand-written `prisma.league.findMany` with nested selects — the
 * query shape that let it invent its own row type (§2y). It now composes
 * `LeagueRepository.findAll` with `LeagueMembershipRepository.countActiveByLeagues`, and
 * one remaining raw contest count that slice 3 will replace.
 */
import type { LeagueMembershipRepository, LeagueRepository } from '@poolmaster/shared/db';
import { AdminLeagueService } from '../../../packages/core-api/src/modules/admin/league-service';
import { buildLeague } from '../../factories';
import {
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
} from '../../support/repo-fakes';

function createLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return fakeLeagueRepo({
    ...overrides,
  });
}

function createMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    ...overrides,
  });
}

function createPrisma(contestRows: Array<{ leagueId: string; _count: { _all: number } }> = []) {
  return {
    contest: { groupBy: jest.fn().mockResolvedValue(contestRows) },
  } as any;
}

describe('AdminLeagueService.searchLeagues', () => {
  it('passes the search and isActive filters to the port rather than building a query', async () => {
    const leagueRepo = createLeagueRepo();
    const service = new AdminLeagueService(
      createPrisma(),
      {} as any,
      leagueRepo,
      createMembershipRepo(),
    );

    await service.searchLeagues({ search: '  Ryder  ', isActive: true });

    // Trimmed, and handed over as filters — the service composes, it does not query.
    expect(leagueRepo.findAll).toHaveBeenCalledWith({ search: 'Ryder', isActive: true });
  });

  it('joins member and active-contest counts onto the right leagues', async () => {
    const first = buildLeague({ id: 'league-1', name: 'First' });
    const second = buildLeague({ id: 'league-2', name: 'Second' });
    const leagueRepo = createLeagueRepo({
      findAll: jest.fn().mockResolvedValue([first, second]),
    });
    const membershipRepo = createMembershipRepo({
      countActiveByLeagues: jest.fn().mockResolvedValue(new Map([['league-1', 4]])),
    });
    const service = new AdminLeagueService(
      createPrisma([{ leagueId: 'league-2', _count: { _all: 7 } }]),
      {} as any,
      leagueRepo,
      membershipRepo,
    );

    const result = await service.searchLeagues({});

    expect(membershipRepo.countActiveByLeagues).toHaveBeenCalledWith(['league-1', 'league-2']);
    // Counts land on their own league, and a league absent from a count map reads 0
    // rather than undefined.
    expect(result).toEqual([
      expect.objectContaining({ id: 'league-1', memberCount: 4, activeContestCount: 0 }),
      expect.objectContaining({ id: 'league-2', memberCount: 0, activeContestCount: 7 }),
    ]);
  });

  it('does not query counts when no leagues matched', async () => {
    const membershipRepo = createMembershipRepo();
    const prisma = createPrisma();
    const service = new AdminLeagueService(prisma, {} as any, createLeagueRepo(), membershipRepo);

    await expect(service.searchLeagues({})).resolves.toEqual([]);

    expect(membershipRepo.countActiveByLeagues).toHaveBeenCalledWith([]);
    // An empty `in` list would scan; the contest count is skipped entirely.
    expect(prisma.contest.groupBy).not.toHaveBeenCalled();
  });

  it('returns leagues with no viewer context on them at all (A8)', async () => {
    const leagueRepo = createLeagueRepo({
      findAll: jest.fn().mockResolvedValue([buildLeague({ id: 'league-1' })]),
    });
    const service = new AdminLeagueService(
      createPrisma(),
      {} as any,
      leagueRepo,
      createMembershipRepo(),
    );

    const [row] = await service.searchLeagues({});

    // #202 step 3.4 — A8 landed, so this is now asserted as an absence. The admin list used
    // to hard-code `isRootAdmin: true`, `memberType: null` and an all-false
    // `leagueRelationship` on every row: a caller having to INVENT values for three fields is
    // what proved they were never properties of the league.
    expect(row?.id).toBe('league-1');
    expect(row).not.toHaveProperty('isRootAdmin');
    expect(row).not.toHaveProperty('memberType');
    expect(row).not.toHaveProperty('leagueRelationship');
  });
});
