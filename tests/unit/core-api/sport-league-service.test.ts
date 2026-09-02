import { Sport } from '@poolmaster/shared/domain';
import {
  SportLeagueService,
} from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';

function buildLeagueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'league-1',
    sportId: 'sport-1',
    name: 'PGA Tour',
    matchKeyword: 'PGA',
    currentSeasonId: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('SportLeagueService.listLeagues / createLeague / updateLeague', () => {
  it('pool-master-2re lists leagues scoped to the resolved Sport row with roster/season counts', async () => {
    const prisma = {
      sport: { findUnique: jest.fn().mockResolvedValue({ id: 'sport-1' }) },
      sportLeague: {
        findMany: jest.fn().mockResolvedValue([
          { ...buildLeagueRow(), _count: { affiliations: 144, seasons: 3 } },
        ]),
      },
    };
    const service = new SportLeagueService(prisma as any);

    const result = await service.listLeagues(Sport.GOLF, { isActive: true });

    expect(prisma.sport.findUnique).toHaveBeenCalledWith({ where: { name: Sport.GOLF } });
    expect(prisma.sportLeague.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sportId: 'sport-1', isActive: true } }),
    );
    expect(result).toEqual([expect.objectContaining({ name: 'PGA Tour', rosterSize: 144, seasonCount: 3 })]);
  });

  it('pool-master-2re throws SPORT_NOT_FOUND when no Sport row exists yet', async () => {
    const prisma = { sport: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new SportLeagueService(prisma as any);

    await expect(service.listLeagues(Sport.GOLF)).rejects.toMatchObject({
      code: 'SPORT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('pool-master-2re creates a league, e.g. adding Champions Tour is one call, not a migration', async () => {
    const prisma = {
      sport: { findUnique: jest.fn().mockResolvedValue({ id: 'sport-1' }) },
      sportLeague: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(buildLeagueRow({ name: 'Champions Tour', matchKeyword: undefined })),
      },
    };
    const service = new SportLeagueService(prisma as any);

    await service.createLeague(Sport.GOLF, { name: 'Champions Tour' });

    expect(prisma.sportLeague.create).toHaveBeenCalledWith({
      data: { sportId: 'sport-1', name: 'Champions Tour', matchKeyword: null },
    });
  });

  it('pool-master-2re rejects creating a league with a name already used for the sport', async () => {
    const prisma = {
      sport: { findUnique: jest.fn().mockResolvedValue({ id: 'sport-1' }) },
      sportLeague: { findUnique: jest.fn().mockResolvedValue(buildLeagueRow()) },
    };
    const service = new SportLeagueService(prisma as any);

    await expect(service.createLeague(Sport.GOLF, { name: 'PGA Tour' })).rejects.toMatchObject({
      code: 'SPORT_LEAGUE_NAME_ALREADY_EXISTS',
      statusCode: 409,
    });
  });

  it('pool-master-2re updates only the provided fields (rename/matchKeyword/deactivate)', async () => {
    const update = jest.fn().mockResolvedValue(buildLeagueRow({ isActive: false }));
    const prisma = { sportLeague: { update } };
    const service = new SportLeagueService(prisma as any);

    await service.updateLeague('league-1', { isActive: false });

    expect(update).toHaveBeenCalledWith({ where: { id: 'league-1' }, data: { isActive: false } });
  });
});

describe('SportLeagueService roster CRUD', () => {
  it('pool-master-2re adds a roster entry, rejecting a duplicate affiliation', async () => {
    const prisma = {
      participantLeagueAffiliation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          participantId: 'p-1',
          worldRanking: null,
          participant: { name: 'Scottie Scheffler', shortName: null, nationality: 'US', status: 'ACTIVE' },
        }),
      },
    };
    const service = new SportLeagueService(prisma as any);

    const entry = await service.addRosterEntry('league-1', 'p-1');

    expect(entry).toEqual(expect.objectContaining({ participantId: 'p-1', name: 'Scottie Scheffler' }));

    prisma.participantLeagueAffiliation.findUnique.mockResolvedValue({ participantId: 'p-1' });
    await expect(service.addRosterEntry('league-1', 'p-1')).rejects.toMatchObject({
      code: 'LEAGUE_ROSTER_ENTRY_ALREADY_EXISTS',
      statusCode: 409,
    });
  });

  it('pool-master-2re removes a roster entry (leaving the tour) distinct from retiring', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const prisma = { participantLeagueAffiliation: { delete: del } };
    const service = new SportLeagueService(prisma as any);

    await service.removeRosterEntry('league-1', 'p-1');

    expect(del).toHaveBeenCalledWith({
      where: { participantId_sportLeagueId: { participantId: 'p-1', sportLeagueId: 'league-1' } },
    });
  });

  it('pool-master-2re bulk-patches worldRanking for multiple roster entries in one transaction', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      participantLeagueAffiliation: { update, findMany },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new SportLeagueService(prisma as any);

    await service.bulkUpdateRoster('league-1', [
      { participantId: 'p-1', worldRanking: 3 },
      { participantId: 'p-2', worldRanking: 7 },
    ]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { participantId_sportLeagueId: { participantId: 'p-1', sportLeagueId: 'league-1' } },
      data: { worldRanking: 3 },
    });
  });
});

describe('SportLeagueService roster upload preview/apply', () => {
  it('pool-master-2re resolves by participantId first, without a DB name/externalId lookup', async () => {
    const prisma = {
      sportLeague: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportId: 'sport-1' }) },
      participant: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1', name: 'Scottie Scheffler' }) },
    };
    const service = new SportLeagueService(prisma as any);

    const preview = await service.previewRosterUpload('league-1', [{ participantId: 'p-1' }]);

    expect(preview).toEqual([
      { row: { participantId: 'p-1' }, resolution: 'MATCHED', participantId: 'p-1', participantName: 'Scottie Scheffler' },
    ]);
    expect(prisma.participant.findFirst).toHaveBeenCalledWith({ where: { id: 'p-1', sportId: 'sport-1' } });
  });

  it('pool-master-2re falls back to externalId, then to an exact case-insensitive playerName match', async () => {
    const prisma = {
      sportLeague: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportId: 'sport-1' }) },
      participant: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 'p-2', name: 'Rory McIlroy' }]) // externalId lookup
          .mockResolvedValueOnce([{ id: 'p-3', name: 'Jon Rahm' }]), // playerName lookup
      },
    };
    const service = new SportLeagueService(prisma as any);

    const preview = await service.previewRosterUpload('league-1', [
      { externalId: 'ext-2' },
      { playerName: 'jon rahm' },
    ]);

    expect(preview[0]).toMatchObject({ resolution: 'MATCHED', participantId: 'p-2' });
    expect(preview[1]).toMatchObject({ resolution: 'MATCHED', participantId: 'p-3' });
    expect(prisma.participant.findMany).toHaveBeenNthCalledWith(2, {
      where: { sportId: 'sport-1', name: { equals: 'jon rahm', mode: 'insensitive' } },
    });
  });

  it('pool-master-2re marks a row AMBIGUOUS when more than one Participant matches, UNRESOLVED when none do', async () => {
    const prisma = {
      sportLeague: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportId: 'sport-1' }) },
      participant: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 'p-4' }, { id: 'p-5' }]) // ambiguous
          .mockResolvedValueOnce([]), // unresolved
      },
    };
    const service = new SportLeagueService(prisma as any);

    const preview = await service.previewRosterUpload('league-1', [
      { playerName: 'John Smith' },
      { playerName: 'Nobody Real' },
    ]);

    expect(preview[0].resolution).toBe('AMBIGUOUS');
    expect(preview[1].resolution).toBe('UNRESOLVED');
  });

  it('pool-master-2re never creates a Participant from an upload row — a row with no identifier is UNRESOLVED', async () => {
    const prisma = { sportLeague: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportId: 'sport-1' }) } };
    const service = new SportLeagueService(prisma as any);

    const preview = await service.previewRosterUpload('league-1', [{ worldRanking: 5 }]);

    expect(preview).toEqual([{ row: { worldRanking: 5 }, resolution: 'UNRESOLVED', participantId: null, participantName: null }]);
  });

  it('pool-master-2re rejects apply with 422 when any row is unresolved, writing nothing', async () => {
    const upsert = jest.fn();
    const prisma = {
      sportLeague: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportId: 'sport-1' }) },
      participant: { findFirst: jest.fn().mockResolvedValue(null) },
      participantLeagueAffiliation: { upsert },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new SportLeagueService(prisma as any);

    await expect(service.applyRosterUpload('league-1', [{ participantId: 'missing' }])).rejects.toMatchObject({
      code: 'LEAGUE_ROSTER_UPLOAD_UNRESOLVED_ROWS',
      statusCode: 422,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('pool-master-2re applies a fully-resolved upload, upserting each affiliation', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      sportLeague: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sportId: 'sport-1' }) },
      participant: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1', name: 'Scottie Scheffler' }) },
      participantLeagueAffiliation: {
        upsert,
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new SportLeagueService(prisma as any);

    await service.applyRosterUpload('league-1', [{ participantId: 'p-1', worldRanking: 3 }]);

    expect(upsert).toHaveBeenCalledWith({
      where: { participantId_sportLeagueId: { participantId: 'p-1', sportLeagueId: 'league-1' } },
      create: { participantId: 'p-1', sportLeagueId: 'league-1', worldRanking: 3 },
      update: { worldRanking: 3 },
    });
  });
});
