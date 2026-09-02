/**
 * Unit tests for the golf field admin handlers added in pool-master-6jk
 * (plans/124 §4.7/§5.2): adminGetGolfTournamentField, adminSeedGolfTournamentField,
 * adminBulkAddGolfFieldEntries, adminUpdateGolfFieldEntries, adminRemoveGolfFieldEntry.
 */
import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { GolfFieldError } from '../../../packages/core-api/src/modules/golf/golf-field-service';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildFieldEntryDto(overrides: Record<string, unknown> = {}) {
  return {
    sportEventParticipantId: 'sep-1',
    participantId: 'p-1',
    participantName: 'Rory McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    isActive: true,
    inactiveReason: null,
    worldRanking: 5,
    oddsToWin: 12.5,
    seedNumber: 3,
    price: null,
    isLeagueRosterMember: true,
    ...overrides,
  };
}

function buildHandlers(golfFieldServiceOverrides: Record<string, unknown> = {}) {
  const golfFieldService = {
    listField: jest.fn().mockResolvedValue([buildFieldEntryDto()]),
    seedFieldFromLeagueRoster: jest.fn().mockResolvedValue({ added: 5, skipped: 1, total: 6, seedNumbersDerived: 5, oddsDerived: 5 }),
    bulkAddFieldEntries: jest.fn().mockResolvedValue({ added: 1, skipped: 0, total: 1 }),
    bulkUpdateFieldEntries: jest.fn().mockResolvedValue([buildFieldEntryDto({ isActive: false })]),
    removeFieldEntry: jest.fn().mockResolvedValue(undefined),
    ...golfFieldServiceOverrides,
  };
  const handlers = createGolfAdminHandlers(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    golfFieldService as any,
  );
  return { handlers, golfFieldService };
}

describe('pool-master-6jk — golf admin field handlers', () => {
  describe('getTournamentField', () => {
    it('pool-master-6jk lists the field via golfFieldService and returns the canonical DTO shape', async () => {
      const { handlers, golfFieldService } = buildHandlers();
      const reply = buildReply();

      await handlers.getTournamentField({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(golfFieldService.listField).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith({ entries: [expect.objectContaining({ sportEventParticipantId: 'sep-1' })] });
    });
  });

  describe('seedTournamentField', () => {
    it('pool-master-6jk delegates to seedFieldFromLeagueRoster and returns the result verbatim', async () => {
      const { handlers, golfFieldService } = buildHandlers();
      const reply = buildReply();

      await handlers.seedTournamentField({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(golfFieldService.seedFieldFromLeagueRoster).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith({ added: 5, skipped: 1, total: 6, seedNumbersDerived: 5, oddsDerived: 5 });
    });

    it('pool-master-6jk maps 409 TOURNAMENT_HAS_NO_SEASON from a GolfFieldError', async () => {
      const { handlers } = buildHandlers({
        seedFieldFromLeagueRoster: jest.fn().mockRejectedValue(
          new GolfFieldError('no season', 'TOURNAMENT_HAS_NO_SEASON', 409),
        ),
      });
      const reply = buildReply();

      await handlers.seedTournamentField({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'TOURNAMENT_HAS_NO_SEASON' }),
      }));
    });
  });

  describe('bulkAddFieldEntries', () => {
    it('pool-master-6jk passes participantIds through and returns the added/skipped/total shape', async () => {
      const { handlers, golfFieldService } = buildHandlers();
      const reply = buildReply();

      await handlers.bulkAddFieldEntries({
        params: { eventId: 'event-1' },
        body: { participantIds: ['p-1', 'p-2'] },
      } as any, reply as any);

      expect(golfFieldService.bulkAddFieldEntries).toHaveBeenCalledWith('event-1', ['p-1', 'p-2']);
      expect(reply.send).toHaveBeenCalledWith({ added: 1, skipped: 0, total: 1 });
    });
  });

  describe('updateFieldEntries', () => {
    it('pool-master-6jk delegates to bulkUpdateFieldEntries and returns the updated DTO list', async () => {
      const { handlers, golfFieldService } = buildHandlers();
      const reply = buildReply();

      await handlers.updateFieldEntries({
        params: { eventId: 'event-1' },
        body: { entries: [{ sportEventParticipantId: 'sep-1', isActive: false }] },
      } as any, reply as any);

      expect(golfFieldService.bulkUpdateFieldEntries).toHaveBeenCalledWith('event-1', [
        { sportEventParticipantId: 'sep-1', isActive: false },
      ]);
      expect(reply.send).toHaveBeenCalledWith({
        entries: [expect.objectContaining({ isActive: false })],
      });
    });

    it('pool-master-6jk maps 404 FIELD_ENTRY_NOT_FOUND from a GolfFieldError', async () => {
      const { handlers } = buildHandlers({
        bulkUpdateFieldEntries: jest.fn().mockRejectedValue(
          new GolfFieldError('not found', 'FIELD_ENTRY_NOT_FOUND', 404),
        ),
      });
      const reply = buildReply();

      await handlers.updateFieldEntries({
        params: { eventId: 'event-1' },
        body: { entries: [{ sportEventParticipantId: 'missing' }] },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe('removeFieldEntry', () => {
    it('pool-master-6jk removes and returns 204', async () => {
      const { handlers, golfFieldService } = buildHandlers();
      const reply = buildReply();

      await handlers.removeFieldEntry({ params: { eventId: 'event-1', sportEventParticipantId: 'sep-1' } } as any, reply as any);

      expect(golfFieldService.removeFieldEntry).toHaveBeenCalledWith('event-1', 'sep-1');
      expect(reply.status).toHaveBeenCalledWith(204);
    });

    it('pool-master-6jk maps 409 FIELD_ENTRY_HAS_PICKS from a GolfFieldError', async () => {
      const { handlers } = buildHandlers({
        removeFieldEntry: jest.fn().mockRejectedValue(
          new GolfFieldError('has picks', 'FIELD_ENTRY_HAS_PICKS', 409),
        ),
      });
      const reply = buildReply();

      await handlers.removeFieldEntry({ params: { eventId: 'event-1', sportEventParticipantId: 'sep-1' } } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'FIELD_ENTRY_HAS_PICKS' }),
      }));
    });
  });
});
