/**
 * Unit tests for the golf tier/price admin handlers added in pool-master-piv
 * (plans/124 §4.5/§4.7a/§5.2): adminGetGolfTournamentTiers,
 * adminReplaceGolfTournamentTiers, adminAutoAssignGolfTiers,
 * adminReplaceGolfTierAssignments, adminAutoAssignGolfPrices.
 */
import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { GolfTierError } from '../../../packages/core-api/src/modules/golf/golf-tier-service';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildTierGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tier-1',
    tierKey: 'tier-1',
    label: 'Tier 1',
    tierNumber: 1,
    defaultPickCount: 1,
    participants: [],
    ...overrides,
  };
}

function buildHandlers(golfTierServiceOverrides: Record<string, unknown> = {}) {
  const golfTierService = {
    getEffectiveTiersForSportEvent: jest.fn().mockResolvedValue([buildTierGroup()]),
    replaceGolfTournamentTiers: jest.fn().mockResolvedValue([buildTierGroup()]),
    autoAssignGolfTiers: jest.fn().mockResolvedValue([buildTierGroup()]),
    replaceGolfTierAssignments: jest.fn().mockResolvedValue([buildTierGroup()]),
    autoAssignGolfPrices: jest.fn().mockResolvedValue([]),
    ...golfTierServiceOverrides,
  };
  const handlers = createGolfAdminHandlers(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    golfTierService as any,
    {} as any,
  );
  return { handlers, golfTierService };
}

describe('pool-master-piv — golf admin tier/price handlers', () => {
  describe('getTournamentTiers', () => {
    it('pool-master-piv lists effective tiers for the sport event and returns the canonical DTO shape', async () => {
      const { handlers, golfTierService } = buildHandlers();
      const reply = buildReply();

      await handlers.getTournamentTiers({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(golfTierService.getEffectiveTiersForSportEvent).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith({ tiers: [expect.objectContaining({ tierKey: 'tier-1' })] });
    });
  });

  describe('replaceTournamentTiers', () => {
    it('pool-master-piv passes the body through including reassignOrphansTo', async () => {
      const { handlers, golfTierService } = buildHandlers();
      const reply = buildReply();

      await handlers.replaceTournamentTiers({
        params: { eventId: 'event-1' },
        body: { tiers: [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, defaultPickCount: 1 }], reassignOrphansTo: 'tier-1' },
      } as any, reply as any);

      expect(golfTierService.replaceGolfTournamentTiers).toHaveBeenCalledWith({
        sportEventId: 'event-1',
        tiers: [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, defaultPickCount: 1 }],
        reassignOrphansTo: 'tier-1',
      });
    });

    it('pool-master-piv maps 409 TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS from a GolfTierError', async () => {
      const { handlers } = buildHandlers({
        replaceGolfTournamentTiers: jest.fn().mockRejectedValue(
          new GolfTierError('would orphan', 'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS', 409),
        ),
      });
      const reply = buildReply();

      await handlers.replaceTournamentTiers({
        params: { eventId: 'event-1' },
        body: { tiers: [{ tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, defaultPickCount: 1 }] },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS' }),
      }));
    });
  });

  describe('autoAssignTournamentTiers', () => {
    it('pool-master-piv passes source and tierSize through', async () => {
      const { handlers, golfTierService } = buildHandlers();
      const reply = buildReply();

      await handlers.autoAssignTournamentTiers({
        params: { eventId: 'event-1' },
        body: { source: 'ODDS', tierSize: 12 },
      } as any, reply as any);

      expect(golfTierService.autoAssignGolfTiers).toHaveBeenCalledWith({
        sportEventId: 'event-1',
        source: 'ODDS',
        tierSize: 12,
      });
    });
  });

  describe('replaceTournamentTierAssignments', () => {
    it('pool-master-piv passes assignments through', async () => {
      const { handlers, golfTierService } = buildHandlers();
      const reply = buildReply();

      await handlers.replaceTournamentTierAssignments({
        params: { eventId: 'event-1' },
        body: { assignments: [{ sportEventParticipantId: 'sep-1', tierKey: 'tier-1', tierOrderIndex: 1 }] },
      } as any, reply as any);

      expect(golfTierService.replaceGolfTierAssignments).toHaveBeenCalledWith({
        sportEventId: 'event-1',
        assignments: [{ sportEventParticipantId: 'sep-1', tierKey: 'tier-1', tierOrderIndex: 1 }],
      });
    });

    it('pool-master-piv maps 404 FIELD_ENTRY_NOT_FOUND from a GolfTierError', async () => {
      const { handlers } = buildHandlers({
        replaceGolfTierAssignments: jest.fn().mockRejectedValue(
          new GolfTierError('not found', 'FIELD_ENTRY_NOT_FOUND', 404),
        ),
      });
      const reply = buildReply();

      await handlers.replaceTournamentTierAssignments({
        params: { eventId: 'event-1' },
        body: { assignments: [{ sportEventParticipantId: 'sep-1', tierKey: 'tier-1', tierOrderIndex: 1 }] },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe('autoAssignTournamentPrices', () => {
    it('pool-master-piv auto-assigns prices then re-reads the effective tiers to return the full picture', async () => {
      const { handlers, golfTierService } = buildHandlers();
      const reply = buildReply();

      await handlers.autoAssignTournamentPrices({
        params: { eventId: 'event-1' },
        body: { minPrice: 10, maxPrice: 50 },
      } as any, reply as any);

      expect(golfTierService.autoAssignGolfPrices).toHaveBeenCalledWith({
        sportEventId: 'event-1',
        minPrice: 10,
        maxPrice: 50,
      });
      expect(golfTierService.getEffectiveTiersForSportEvent).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith({ tiers: [expect.objectContaining({ tierKey: 'tier-1' })] });
    });
  });
});
