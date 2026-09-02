/**
 * Unit tests for the golf player admin handlers added in pool-master-608
 * (plans/124 §4.4a/§5.2): adminListGolfPlayers, adminCreateGolfPlayer,
 * adminGetGolfPlayer, adminUpdateGolfPlayer.
 */
import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { GolfPlayerError } from '../../../packages/core-api/src/modules/golf/golf-player-service';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildPlayerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    name: 'Rory McIlroy',
    firstName: 'Rory',
    lastName: 'McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    position: null,
    teamAffiliation: null,
    externalId: null,
    status: 'ACTIVE',
    providerMappingCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildHandlers(golfPlayerServiceOverrides: Record<string, unknown> = {}) {
  const golfPlayerService = {
    listPlayers: jest.fn().mockResolvedValue([buildPlayerRow()]),
    createPlayer: jest.fn().mockResolvedValue(buildPlayerRow()),
    getPlayer: jest.fn().mockResolvedValue({ ...buildPlayerRow(), providerMappings: [] }),
    updatePlayer: jest.fn().mockResolvedValue({ ...buildPlayerRow({ status: 'INACTIVE' }), providerMappings: [] }),
    ...golfPlayerServiceOverrides,
  };
  const handlers = createGolfAdminHandlers(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    golfPlayerService as any,
    {} as any,
    {} as any,
  );
  return { handlers, golfPlayerService };
}

describe('pool-master-608 — golf admin player handlers', () => {
  describe('listPlayers', () => {
    it('pool-master-608 forwards status/search and returns the DTO list', async () => {
      const { handlers, golfPlayerService } = buildHandlers();
      const reply = buildReply();

      await handlers.listPlayers({ query: { status: 'ACTIVE', search: 'rory' } } as any, reply as any);

      expect(golfPlayerService.listPlayers).toHaveBeenCalledWith({ status: 'ACTIVE', search: 'rory' });
      expect(reply.send).toHaveBeenCalledWith({ players: [expect.objectContaining({ id: 'p-1' })] });
    });
  });

  describe('createPlayer', () => {
    it('pool-master-608 creates via golfPlayerService and returns 201 with an empty providerMappings list', async () => {
      const { handlers, golfPlayerService } = buildHandlers();
      const reply = buildReply();

      await handlers.createPlayer({ body: { name: 'Rory McIlroy' } } as any, reply as any);

      expect(golfPlayerService.createPlayer).toHaveBeenCalledWith({ name: 'Rory McIlroy' });
      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.send).toHaveBeenCalledWith({
        player: expect.objectContaining({ id: 'p-1', providerMappings: [] }),
      });
    });
  });

  describe('getPlayer', () => {
    it('pool-master-608 returns the detail DTO including providerMappings', async () => {
      const { handlers, golfPlayerService } = buildHandlers();
      const reply = buildReply();

      await handlers.getPlayer({ params: { participantId: 'p-1' } } as any, reply as any);

      expect(golfPlayerService.getPlayer).toHaveBeenCalledWith('p-1');
      expect(reply.send).toHaveBeenCalledWith({ player: expect.objectContaining({ id: 'p-1' }) });
    });

    it('pool-master-608 returns 404 PLAYER_NOT_FOUND when the service returns null', async () => {
      const { handlers } = buildHandlers({ getPlayer: jest.fn().mockResolvedValue(null) });
      const reply = buildReply();

      await handlers.getPlayer({ params: { participantId: 'missing' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'PLAYER_NOT_FOUND' }),
      }));
    });
  });

  describe('updatePlayer', () => {
    it('pool-master-608 delegates to updatePlayer and returns the updated detail DTO', async () => {
      const { handlers, golfPlayerService } = buildHandlers();
      const reply = buildReply();

      await handlers.updatePlayer({
        params: { participantId: 'p-1' },
        body: { status: 'INACTIVE' },
      } as any, reply as any);

      expect(golfPlayerService.updatePlayer).toHaveBeenCalledWith('p-1', { status: 'INACTIVE' });
      expect(reply.send).toHaveBeenCalledWith({
        player: expect.objectContaining({ status: 'INACTIVE' }),
      });
    });

    it('pool-master-608 maps a 404 GolfPlayerError from the service', async () => {
      const { handlers } = buildHandlers({
        updatePlayer: jest.fn().mockRejectedValue(new GolfPlayerError('not found', 'PLAYER_NOT_FOUND', 404)),
      });
      const reply = buildReply();

      await handlers.updatePlayer({
        params: { participantId: 'missing' },
        body: {},
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'PLAYER_NOT_FOUND' }),
      }));
    });
  });
});
