/**
 * Unit tests for GolfPlayerService (pool-master-608 / plans/124 §4.4a/§5.2).
 *
 * Coverage:
 *   - listPlayers: resolves Sport.GOLF's Sport row, defaults to ACTIVE status,
 *     forwards search, and projects providerMappingCount per participant.
 *   - createPlayer: resolves the Sport row and forwards sportId +
 *     participantType=INDIVIDUAL to ParticipantService.create.
 *   - getPlayer: null when missing or when the participant belongs to a
 *     different sport; detail + providerMappings when found.
 *   - updatePlayer: 404 GolfPlayerError when missing/wrong-sport up front,
 *     and when ParticipantService.update itself throws ParticipantNotFoundError.
 */
import { GolfPlayerService, GolfPlayerError } from '../../../packages/core-api/src/modules/golf/golf-player-service';
import { ParticipantNotFoundError } from '../../../packages/core-api/src/modules/participants/service';

function buildParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    sportId: 'sport-golf',
    name: 'Rory McIlroy',
    participantType: 'INDIVIDUAL',
    firstName: 'Rory',
    lastName: 'McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    position: null,
    teamAffiliation: null,
    externalId: null,
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    externalIds: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  return {
    prisma: {
      sport: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sport-golf' }),
      },
      participantProviderMapping: {
        groupBy: jest.fn().mockResolvedValue([{ participantId: 'p-1', _count: { _all: 2 } }]),
      },
    },
    participantService: {
      search: jest.fn().mockResolvedValue({ participants: [buildParticipant()], total: 1 }),
      create: jest.fn().mockResolvedValue(buildParticipant()),
      findById: jest.fn().mockResolvedValue(buildParticipant()),
      update: jest.fn().mockResolvedValue(buildParticipant({ status: 'INACTIVE' })),
      getProviderMappings: jest.fn().mockResolvedValue([
        { providerId: 'mock-contest-feed', externalId: 'ext-1', confidence: 'EXACT' },
      ]),
    },
    ...overrides,
  };
}

describe('GolfPlayerService.listPlayers', () => {
  it('pool-master-608 resolves the golf Sport row, defaults to ACTIVE status, and projects providerMappingCount', async () => {
    const deps = buildDeps();
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    const result = await service.listPlayers({ search: 'rory' });

    expect(deps.prisma.sport.findUnique).toHaveBeenCalledWith({ where: { name: 'GOLF' } });
    expect(deps.participantService.search).toHaveBeenCalledWith({
      query: 'rory',
      filters: { sportId: 'sport-golf', status: ['ACTIVE'] },
      limit: 200,
    });
    expect(result).toEqual([expect.objectContaining({ id: 'p-1', providerMappingCount: 2 })]);
  });

  it('pool-master-608 forwards an explicit status filter instead of the ACTIVE default', async () => {
    const deps = buildDeps();
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    await service.listPlayers({ status: 'INACTIVE' as any });

    expect(deps.participantService.search).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { sportId: 'sport-golf', status: ['INACTIVE'] } }),
    );
  });

  it('pool-master-608 returns providerMappingCount 0 for a participant with no mapping rows', async () => {
    const deps = buildDeps({
      prisma: {
        sport: { findUnique: jest.fn().mockResolvedValue({ id: 'sport-golf' }) },
        participantProviderMapping: { groupBy: jest.fn().mockResolvedValue([]) },
      },
    });
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    const result = await service.listPlayers();

    expect(result).toEqual([expect.objectContaining({ providerMappingCount: 0 })]);
  });
});

describe('GolfPlayerService.createPlayer', () => {
  it('pool-master-608 forwards the resolved sportId and participantType=INDIVIDUAL', async () => {
    const deps = buildDeps();
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    const result = await service.createPlayer({ name: 'Rory McIlroy' });

    expect(deps.participantService.create).toHaveBeenCalledWith({
      sportId: 'sport-golf',
      participantType: 'INDIVIDUAL',
      name: 'Rory McIlroy',
    });
    expect(result).toEqual(expect.objectContaining({ id: 'p-1', providerMappingCount: 0 }));
  });
});

describe('GolfPlayerService.getPlayer', () => {
  it('pool-master-608 returns null when the participant does not exist', async () => {
    const deps = buildDeps({ participantService: { findById: jest.fn().mockResolvedValue(null) } });
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    expect(await service.getPlayer('missing')).toBeNull();
  });

  it('pool-master-608 returns null when the participant belongs to a different sport', async () => {
    const deps = buildDeps({
      participantService: { findById: jest.fn().mockResolvedValue(buildParticipant({ sportId: 'sport-basketball' })) },
    });
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    expect(await service.getPlayer('p-1')).toBeNull();
  });

  it('pool-master-608 returns detail with providerMappings when found', async () => {
    const deps = buildDeps();
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    const result = await service.getPlayer('p-1');

    expect(result).toEqual(expect.objectContaining({
      id: 'p-1',
      providerMappingCount: 1,
      providerMappings: [{ providerId: 'mock-contest-feed', externalId: 'ext-1', confidence: 'EXACT' }],
    }));
  });
});

describe('GolfPlayerService.updatePlayer', () => {
  it('pool-master-608 throws 404 GolfPlayerError when the participant does not exist', async () => {
    const deps = buildDeps({ participantService: { findById: jest.fn().mockResolvedValue(null) } });
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    await expect(service.updatePlayer('missing', { status: 'INACTIVE' as any }))
      .rejects.toThrow(GolfPlayerError);
  });

  it('pool-master-608 throws 404 GolfPlayerError when the participant belongs to a different sport', async () => {
    const deps = buildDeps({
      participantService: {
        findById: jest.fn().mockResolvedValue(buildParticipant({ sportId: 'sport-basketball' })),
      },
    });
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    await expect(service.updatePlayer('p-1', {})).rejects.toThrow(GolfPlayerError);
  });

  it('pool-master-608 updates and returns the detail shape with refreshed provider mappings', async () => {
    const deps = buildDeps();
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    const result = await service.updatePlayer('p-1', { status: 'INACTIVE' as any });

    expect(deps.participantService.update).toHaveBeenCalledWith('p-1', { status: 'INACTIVE' });
    expect(result).toEqual(expect.objectContaining({ status: 'INACTIVE', providerMappingCount: 1 }));
  });

  it('pool-master-608 maps a ParticipantNotFoundError from ParticipantService.update to a 404 GolfPlayerError', async () => {
    const deps = buildDeps({
      participantService: {
        findById: jest.fn().mockResolvedValue(buildParticipant()),
        update: jest.fn().mockRejectedValue(new ParticipantNotFoundError('p-1')),
        getProviderMappings: jest.fn().mockResolvedValue([]),
      },
    });
    const service = new GolfPlayerService(deps.prisma as any, deps.participantService as any);

    await expect(service.updatePlayer('p-1', {})).rejects.toThrow(GolfPlayerError);
  });
});
