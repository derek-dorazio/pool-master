/**
 * Unit tests for the round-schedule admin golf handlers added in pool-master-k6q
 * (plans/124 §4.10/§5.2): adminGetGolfTournamentRounds, adminUpdateGolfTournamentRounds.
 */
import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { GolfRoundScheduleError } from '../../../packages/core-api/src/modules/golf/golf-round-schedule-service';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildRoundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'round-1',
    sportEventId: 'event-1',
    roundNumber: 1,
    scheduledDate: new Date('2026-06-01T00:00:00.000Z'),
    scheduledEndAt: null,
    ...overrides,
  };
}

describe('pool-master-k6q — golf admin round-schedule handlers', () => {
  describe('getTournamentRounds', () => {
    it('pool-master-k6q lists rounds via golfRoundScheduleService and returns the canonical DTO shape', async () => {
      const golfRoundScheduleService = {
        listSportEventRounds: jest.fn().mockResolvedValue([
          buildRoundRow({ roundNumber: 1 }),
          buildRoundRow({ roundNumber: 2, scheduledDate: new Date('2026-06-02T00:00:00.000Z') }),
        ]),
      };
      const handlers = createGolfAdminHandlers({} as any, {} as any, golfRoundScheduleService as any, {} as any, {} as any, {} as any, {} as any);
      const reply = buildReply();

      await handlers.getTournamentRounds({ params: { eventId: 'event-1' } } as any, reply as any);

      expect(golfRoundScheduleService.listSportEventRounds).toHaveBeenCalledWith('event-1');
      expect(reply.send).toHaveBeenCalledWith({
        rounds: [
          { roundNumber: 1, scheduledDate: '2026-06-01T00:00:00.000Z', scheduledEndAt: null },
          { roundNumber: 2, scheduledDate: '2026-06-02T00:00:00.000Z', scheduledEndAt: null },
        ],
      });
    });
  });

  describe('updateTournamentRounds', () => {
    it('pool-master-k6q delegates to golfRoundScheduleService.updateSportEventRounds with parsed Date objects', async () => {
      const golfRoundScheduleService = {
        updateSportEventRounds: jest.fn().mockResolvedValue([
          buildRoundRow({ roundNumber: 1, scheduledDate: new Date('2026-06-05T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-05T20:00:00.000Z') }),
        ]),
      };
      const handlers = createGolfAdminHandlers({} as any, {} as any, golfRoundScheduleService as any, {} as any, {} as any, {} as any, {} as any);
      const reply = buildReply();

      await handlers.updateTournamentRounds({
        params: { eventId: 'event-1' },
        body: {
          rounds: [
            { roundNumber: 1, scheduledDate: '2026-06-05T00:00:00.000Z', scheduledEndAt: '2026-06-05T20:00:00.000Z' },
          ],
        },
      } as any, reply as any);

      expect(golfRoundScheduleService.updateSportEventRounds).toHaveBeenCalledWith('event-1', [
        { roundNumber: 1, scheduledDate: new Date('2026-06-05T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-05T20:00:00.000Z') },
      ]);
      expect(reply.send).toHaveBeenCalledWith({
        rounds: [
          { roundNumber: 1, scheduledDate: '2026-06-05T00:00:00.000Z', scheduledEndAt: '2026-06-05T20:00:00.000Z' },
        ],
      });
    });

    it('pool-master-k6q passes an explicit null scheduledEndAt through, but omits the field entirely when not supplied', async () => {
      const golfRoundScheduleService = {
        updateSportEventRounds: jest.fn().mockResolvedValue([buildRoundRow({ roundNumber: 1 })]),
      };
      const handlers = createGolfAdminHandlers({} as any, {} as any, golfRoundScheduleService as any, {} as any, {} as any, {} as any, {} as any);
      const reply = buildReply();

      await handlers.updateTournamentRounds({
        params: { eventId: 'event-1' },
        body: {
          rounds: [
            { roundNumber: 1, scheduledDate: '2026-06-01T00:00:00.000Z' },
            { roundNumber: 2, scheduledDate: '2026-06-02T00:00:00.000Z', scheduledEndAt: null },
          ],
        },
      } as any, reply as any);

      expect(golfRoundScheduleService.updateSportEventRounds).toHaveBeenCalledWith('event-1', [
        { roundNumber: 1, scheduledDate: new Date('2026-06-01T00:00:00.000Z'), scheduledEndAt: undefined },
        { roundNumber: 2, scheduledDate: new Date('2026-06-02T00:00:00.000Z'), scheduledEndAt: null },
      ]);
    });

    it('pool-master-k6q maps GolfRoundScheduleError to its statusCode/code via sendError', async () => {
      const golfRoundScheduleService = {
        updateSportEventRounds: jest.fn().mockRejectedValue(
          new GolfRoundScheduleError('Sport event event-1 has no SportEventRound for round 7'),
        ),
      };
      const handlers = createGolfAdminHandlers({} as any, {} as any, golfRoundScheduleService as any, {} as any, {} as any, {} as any, {} as any);
      const reply = buildReply();

      await handlers.updateTournamentRounds({
        params: { eventId: 'event-1' },
        body: { rounds: [{ roundNumber: 7, scheduledDate: '2026-06-01T00:00:00.000Z' }] },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'ROUND_NOT_FOUND' }),
      }));
    });

    it('pool-master-k6q rethrows an unrelated error instead of swallowing it', async () => {
      const golfRoundScheduleService = {
        updateSportEventRounds: jest.fn().mockRejectedValue(new Error('unexpected')),
      };
      const handlers = createGolfAdminHandlers({} as any, {} as any, golfRoundScheduleService as any, {} as any, {} as any, {} as any, {} as any);
      const reply = buildReply();

      await expect(
        handlers.updateTournamentRounds({
          params: { eventId: 'event-1' },
          body: { rounds: [{ roundNumber: 1, scheduledDate: '2026-06-01T00:00:00.000Z' }] },
        } as any, reply as any),
      ).rejects.toThrow('unexpected');
    });
  });
});
