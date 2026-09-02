/**
 * Unit tests for the golf round-score admin handlers added in pool-master-blj
 * (plans/124 §5.2): adminGetGolfRoundScores, adminPreviewGolfRoundScores,
 * adminApplyGolfRoundScores, adminUpdateGolfRoundScore.
 */
import { createGolfAdminHandlers } from '../../../packages/core-api/src/modules/admin/golf/handler';
import { GolfScoreError } from '../../../packages/core-api/src/modules/golf/golf-score-service';

function buildReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function buildScoreRow(overrides: Record<string, unknown> = {}) {
  return {
    sportEventParticipantId: 'sep-1',
    participantId: 'p-1',
    participantName: 'Rory McIlroy',
    strokes: 68,
    scoreToPar: -4,
    thru: 18,
    status: 'COMPLETED',
    completedAt: null,
    standing: null,
    ...overrides,
  };
}

function buildHandlers(golfScoreServiceOverrides: Record<string, unknown> = {}) {
  const golfScoreService = {
    getRoundScores: jest.fn().mockResolvedValue([buildScoreRow()]),
    previewRoundScores: jest.fn().mockResolvedValue([{
      row: { participantId: 'p-1', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
      resolution: 'MATCHED',
      sportEventParticipantId: 'sep-1',
      participantName: 'Rory McIlroy',
      change: 'CREATE',
      before: null,
      after: { strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
    }]),
    applyRoundScores: jest.fn().mockResolvedValue([buildScoreRow()]),
    updateRoundScore: jest.fn().mockResolvedValue(buildScoreRow({ strokes: 70 })),
    ...golfScoreServiceOverrides,
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
    {} as any,
    {} as any,
    golfScoreService as any,
  );
  return { handlers, golfScoreService };
}

describe('pool-master-blj — golf admin round-score handlers', () => {
  describe('getRoundScores', () => {
    it('reads the round number from params and returns the mapped row list', async () => {
      const { handlers, golfScoreService } = buildHandlers();
      const reply = buildReply();

      await handlers.getRoundScores({ params: { eventId: 'event-1', round: 2 } } as any, reply as any);

      expect(golfScoreService.getRoundScores).toHaveBeenCalledWith('event-1', 2);
      expect(reply.send).toHaveBeenCalledWith({ rows: [expect.objectContaining({ sportEventParticipantId: 'sep-1' })] });
    });
  });

  describe('previewRoundScores', () => {
    it('forwards the uploaded rows and returns the rollup response', async () => {
      const { handlers, golfScoreService } = buildHandlers();
      const reply = buildReply();

      await handlers.previewRoundScores({
        params: { eventId: 'event-1', round: 1 },
        body: { rows: [{ participantId: 'p-1', strokes: 68, scoreToPar: -4, status: 'COMPLETED' }] },
      } as any, reply as any);

      expect(golfScoreService.previewRoundScores).toHaveBeenCalledWith(
        'event-1',
        1,
        [{ participantId: 'p-1', strokes: 68, scoreToPar: -4, status: 'COMPLETED' }],
      );
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        rows: [expect.objectContaining({ resolution: 'MATCHED' })],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      }));
    });
  });

  describe('applyRoundScores', () => {
    it('applies the uploaded rows and returns the refreshed row list', async () => {
      const { handlers, golfScoreService } = buildHandlers();
      const reply = buildReply();

      await handlers.applyRoundScores({
        params: { eventId: 'event-1', round: 1 },
        body: { rows: [{ participantId: 'p-1', strokes: 68, scoreToPar: -4, status: 'COMPLETED' }] },
      } as any, reply as any);

      expect(golfScoreService.applyRoundScores).toHaveBeenCalledWith(
        'event-1',
        1,
        [{ participantId: 'p-1', strokes: 68, scoreToPar: -4, status: 'COMPLETED' }],
      );
      expect(reply.send).toHaveBeenCalledWith({ rows: [expect.objectContaining({ sportEventParticipantId: 'sep-1' })] });
    });

    it('maps a 422 GolfScoreError from the service', async () => {
      const { handlers } = buildHandlers({
        applyRoundScores: jest.fn().mockRejectedValue(
          new GolfScoreError('unresolved rows', 'ROUND_SCORE_ROWS_UNRESOLVED', 422),
        ),
      });
      const reply = buildReply();

      await handlers.applyRoundScores({
        params: { eventId: 'event-1', round: 1 },
        body: { rows: [{ playerName: 'Nobody', strokes: 68, scoreToPar: -4, status: 'COMPLETED' }] },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(422);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'ROUND_SCORE_ROWS_UNRESOLVED' }),
      }));
    });
  });

  describe('updateRoundScore', () => {
    it('patches one participant\'s round score and returns the refreshed row', async () => {
      const { handlers, golfScoreService } = buildHandlers();
      const reply = buildReply();

      await handlers.updateRoundScore({
        params: { eventId: 'event-1', round: 1, sportEventParticipantId: 'sep-1' },
        body: { strokes: 70 },
      } as any, reply as any);

      expect(golfScoreService.updateRoundScore).toHaveBeenCalledWith('event-1', 1, 'sep-1', { strokes: 70 });
      expect(reply.send).toHaveBeenCalledWith({ row: expect.objectContaining({ strokes: 70 }) });
    });

    it('maps a 404 GolfScoreError from the service', async () => {
      const { handlers } = buildHandlers({
        updateRoundScore: jest.fn().mockRejectedValue(
          new GolfScoreError('not found', 'FIELD_ENTRY_NOT_FOUND', 404),
        ),
      });
      const reply = buildReply();

      await handlers.updateRoundScore({
        params: { eventId: 'event-1', round: 1, sportEventParticipantId: 'missing' },
        body: { strokes: 70 },
      } as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'FIELD_ENTRY_NOT_FOUND' }),
      }));
    });
  });
});
