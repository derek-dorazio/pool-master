/**
 * The one order a field is tiered and priced in (#1807): odds, then seed, then rank, decided for
 * the whole field by the first value every participant has, then name; no order without any value.
 */
import { FieldOrderBasis, fieldOrderDecision, orderField, type OrderableFieldEntry } from '@poolmaster/shared/domain';

function entry(name: string, values: Omit<OrderableFieldEntry, 'name'> = {}): OrderableFieldEntry {
  return { name, ...values };
}

const ordered = (field: readonly OrderableFieldEntry[]) => {
  const order = orderField(field);
  if (order === null) throw new Error('The field has no order.');
  return order;
};
const names = (field: readonly OrderableFieldEntry[]) => ordered(field).ordered.map((row) => row.name);

describe('orderField — one order for tiers and prices', () => {
  it('orders by odds, shortest first, when every participant has odds, whatever their seeds and ranks say', () => {
    const field = [
      entry('Long', { oddsToWin: 20, seedNumber: 1, ranking: 1 }),
      entry('Favourite', { oddsToWin: 3, seedNumber: 3, ranking: 9 }),
      entry('Middle', { oddsToWin: 8, seedNumber: 2, ranking: 4 }),
    ];

    expect(names(field)).toEqual(['Favourite', 'Middle', 'Long']);
    expect(ordered(field).decision).toEqual({ basis: FieldOrderBasis.ODDS, coversField: true });
  });

  it('orders by seed when not every participant has odds, and a participant\'s odds never lift it above a better seed', () => {
    const field = [
      entry('Seed 2 with odds', { oddsToWin: 2, seedNumber: 2 }),
      entry('Seed 1', { seedNumber: 1 }),
      entry('Seed 3', { seedNumber: 3 }),
    ];

    expect(names(field)).toEqual(['Seed 1', 'Seed 2 with odds', 'Seed 3']);
    expect(fieldOrderDecision(field)).toEqual({ basis: FieldOrderBasis.SEED, coversField: true });
  });

  it('orders by rank when neither odds nor seeds cover the field', () => {
    const field = [
      entry('Rank 40', { ranking: 40, seedNumber: 1 }),
      entry('Rank 3', { ranking: 3 }),
      entry('Rank 12', { ranking: 12 }),
    ];

    expect(names(field)).toEqual(['Rank 3', 'Rank 12', 'Rank 40']);
    expect(fieldOrderDecision(field)?.basis).toBe(FieldOrderBasis.RANKING);
  });

  it('breaks a tie on the deciding value by the later values in turn, then by name', () => {
    const field = [
      entry('Zed', { oddsToWin: 5, seedNumber: 4, ranking: 10 }),
      entry('Abe', { oddsToWin: 5, seedNumber: 4, ranking: 10 }),
      entry('Seed 4 rank 2', { oddsToWin: 5, seedNumber: 4, ranking: 2 }),
      entry('Seed 3', { oddsToWin: 5, seedNumber: 3, ranking: 30 }),
    ];

    expect(names(field)).toEqual(['Seed 3', 'Seed 4 rank 2', 'Abe', 'Zed']);
  });

  it('orders by the first value anyone has, those without it last, when no value covers the field', () => {
    const field = [
      entry('No odds', { ranking: 1 }),
      entry('Long', { oddsToWin: 30 }),
      entry('Short', { oddsToWin: 4 }),
    ];

    expect(names(field)).toEqual(['Short', 'Long', 'No odds']);
    expect(fieldOrderDecision(field)).toEqual({ basis: FieldOrderBasis.ODDS, coversField: false });
  });

  it('gives a field with no odds, seeds or ranks no order at all, since a name orders nothing', () => {
    const field = [entry('Charlie'), entry('alpha'), entry('Bravo')];

    expect(orderField(field)).toBeNull();
    expect(fieldOrderDecision(field)).toBeNull();
  });

  it('gives an empty field no order', () => {
    expect(orderField([])).toBeNull();
    expect(fieldOrderDecision([])).toBeNull();
  });
});
