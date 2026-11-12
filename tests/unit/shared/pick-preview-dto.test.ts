/**
 * #1612 — a pick preview's request takes each golfer, and each game, once: a repeated trial pick
 * is refused before it reaches the room.
 */
import { expect } from '@jest/globals';
import { PickEmMode, PredictedResult, SelectionType } from '@poolmaster/shared/domain';
import { GamePickPreviewRequestSchema, RosterPickPreviewRequestSchema } from '@poolmaster/shared/dto';

const EVENT = '00000000-0000-4000-8000-000000000001';
const ROW = '00000000-0000-4000-8000-000000000002';
const OTHER_ROW = '00000000-0000-4000-8000-000000000003';
const TIERED = { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 };
const pick = (team: string) => ({ sportEventMatchId: ROW, predictedResult: PredictedResult.TEAM, sportEventParticipantId: team });

describe('RosterPickPreviewRequestSchema', () => {
  it('takes distinct golfers and refuses the same golfer twice', () => {
    expect(RosterPickPreviewRequestSchema.safeParse({ sportEventId: EVENT, rules: TIERED, sportEventParticipantIds: [ROW, OTHER_ROW] }).success).toBe(true);
    expect(RosterPickPreviewRequestSchema.safeParse({ sportEventId: EVENT, rules: TIERED, sportEventParticipantIds: [ROW, ROW] }).success).toBe(false);
  });
});

describe('GamePickPreviewRequestSchema', () => {
  const rules = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false };

  it('takes one pick a game and refuses two on the same game', () => {
    expect(GamePickPreviewRequestSchema.safeParse({ sportEventId: EVENT, rules, picks: [pick(OTHER_ROW)] }).success).toBe(true);
    expect(GamePickPreviewRequestSchema.safeParse({ sportEventId: EVENT, rules, picks: [pick(OTHER_ROW), pick(OTHER_ROW)] }).success).toBe(false);
  });
});
