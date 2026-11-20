import { MAX_EVENTS_BY_SELECTION_TYPE, SelectionType, coversOneEvent } from '@poolmaster/shared/domain';

describe('MAX_EVENTS_BY_SELECTION_TYPE', () => {
  it('names an event limit for every selection type, and no type that does not exist', () => {
    expect(Object.keys(MAX_EVENTS_BY_SELECTION_TYPE).sort()).toEqual(Object.values(SelectionType).sort());
  });
});

describe('coversOneEvent', () => {
  it.each([SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SQUARES])(
    'holds a %s contest to one event, so its events never change',
    (selectionType) => {
      expect(coversOneEvent(selectionType)).toBe(true);
    },
  );

  it.each([SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.PICK_EM, SelectionType.SURVIVOR])(
    'lets a %s contest cover several events',
    (selectionType) => {
      expect(coversOneEvent(selectionType)).toBe(false);
    },
  );
});
