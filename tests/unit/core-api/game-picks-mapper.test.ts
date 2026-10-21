/**
 * A save request's picks as the prediction service reads them (#792): each says what it predicts,
 * a team or a tie, and the request schema's pairing of the two is checked here, since the
 * published JSON schema cannot carry it.
 */
import { expect } from '@jest/globals';
import { PredictedResult } from '@poolmaster/shared/domain';
import { toGamePickWrites } from '../../../packages/core-api/src/mappers/game-picks.mapper';
import { SelectionError } from '../../../packages/core-api/src/modules/selections/selection-errors';

const GAME = '00000000-0000-4000-8000-000000000001';
const TEAM = '00000000-0000-4000-8000-000000000002';

describe('toGamePickWrites', () => {
  it('reads a team pick with its team and a tie pick with none, an omitted confidence as none', () => {
    expect(toGamePickWrites({
      picks: [
        { sportEventMatchId: GAME, predictedResult: PredictedResult.TEAM, sportEventParticipantId: TEAM, confidence: 2 },
        { sportEventMatchId: GAME, predictedResult: PredictedResult.TIE, sportEventParticipantId: null },
      ],
    })).toEqual([
      { sportEventMatchId: GAME, predictedResult: PredictedResult.TEAM, sportEventParticipantId: TEAM, confidence: 2 },
      { sportEventMatchId: GAME, predictedResult: PredictedResult.TIE, sportEventParticipantId: null, confidence: null },
    ]);
  });

  it.each([
    ['a team pick naming no team', { predictedResult: PredictedResult.TEAM, sportEventParticipantId: null }],
    ['a tie pick naming a team', { predictedResult: PredictedResult.TIE, sportEventParticipantId: TEAM }],
  ])('refuses %s with 400 PREDICTION_PICK_INVALID', (_label, choice) => {
    const read = () => toGamePickWrites({ picks: [{ sportEventMatchId: GAME, ...choice }] });

    expect(read).toThrow(SelectionError);
    expect(read).toThrow(expect.objectContaining({ code: 'PREDICTION_PICK_INVALID', statusCode: 400 }));
  });
});
