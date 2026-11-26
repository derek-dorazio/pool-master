/**
 * The one order a field is tiered and priced in (#1807, #2160): the profile's sources in its own
 * order, decided for the whole field by the first listed value every participant has, then name;
 * no order without any listed value.
 */
import { FieldOrderBasis, fieldOrderDecision, orderField, type OrderableFieldEntry } from '@poolmaster/shared/domain';

function entry(name: string, values: Omit<OrderableFieldEntry, 'name'> = {}): OrderableFieldEntry {
  return { name, ...values };
}

const ODDS_FIRST = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];
const SEED_FIRST = [FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING];

const ordered = (field: readonly OrderableFieldEntry[], sources: readonly FieldOrderBasis[] = ODDS_FIRST) => {
  const order = orderField(field, sources);
  if (order === null) throw new Error('The field has no order.');
  return order;
};
const names = (field: readonly OrderableFieldEntry[], sources: readonly FieldOrderBasis[] = ODDS_FIRST) => ordered(field, sources).ordered.map((row) => row.name);

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
    expect(fieldOrderDecision(field, ODDS_FIRST)).toEqual({ basis: FieldOrderBasis.SEED, coversField: true });
  });

  it('orders by rank when neither odds nor seeds cover the field', () => {
    const field = [
      entry('Rank 40', { ranking: 40, seedNumber: 1 }),
      entry('Rank 3', { ranking: 3 }),
      entry('Rank 12', { ranking: 12 }),
    ];

    expect(names(field)).toEqual(['Rank 3', 'Rank 12', 'Rank 40']);
    expect(fieldOrderDecision(field, ODDS_FIRST)?.basis).toBe(FieldOrderBasis.RANKING);
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
    expect(fieldOrderDecision(field, ODDS_FIRST)).toEqual({ basis: FieldOrderBasis.ODDS, coversField: false });
  });

  it('gives a field with no odds, seeds or ranks no order at all, since a name orders nothing', () => {
    const field = [entry('Charlie'), entry('alpha'), entry('Bravo')];

    expect(orderField(field, ODDS_FIRST)).toBeNull();
    expect(fieldOrderDecision(field, ODDS_FIRST)).toBeNull();
  });

  it('gives an empty field no order', () => {
    expect(orderField([], ODDS_FIRST)).toBeNull();
    expect(fieldOrderDecision([], ODDS_FIRST)).toBeNull();
  });

  it('orders by seed, best first, when the profile lists seed first, even though every participant has odds', () => {
    const field = [
      entry('Seed 3 favourite', { oddsToWin: 2, seedNumber: 3 }),
      entry('Seed 1', { oddsToWin: 6, seedNumber: 1 }),
      entry('Seed 2', { oddsToWin: 4, seedNumber: 2 }),
    ];

    expect(names(field, SEED_FIRST)).toEqual(['Seed 1', 'Seed 2', 'Seed 3 favourite']);
    expect(fieldOrderDecision(field, SEED_FIRST)).toEqual({ basis: FieldOrderBasis.SEED, coversField: true });
  });

  it('breaks a tie between two 1 seeds by the profile\'s next source, odds, not by name', () => {
    const field = [
      entry('AFC 1 seed', { oddsToWin: 5, seedNumber: 1 }),
      entry('NFC 1 seed', { oddsToWin: 3, seedNumber: 1 }),
      entry('AFC 2 seed', { oddsToWin: 4, seedNumber: 2 }),
    ];

    expect(names(field, SEED_FIRST)).toEqual(['NFC 1 seed', 'AFC 1 seed', 'AFC 2 seed']);
  });

  it('ignores a source the profile does not list: a field with only odds has no order under a seed-and-rank profile', () => {
    const field = [entry('A', { oddsToWin: 3 }), entry('B', { oddsToWin: 5 })];

    expect(orderField(field, [FieldOrderBasis.SEED, FieldOrderBasis.RANKING])).toBeNull();
    expect(fieldOrderDecision(field, [FieldOrderBasis.SEED])).toBeNull();
  });

  it('breaks ties only with the sources listed after the deciding one, so a rank-only list falls to name', () => {
    const field = [
      entry('Zed', { ranking: 4, oddsToWin: 1 }),
      entry('Abe', { ranking: 4, oddsToWin: 9 }),
    ];

    expect(names(field, [FieldOrderBasis.RANKING])).toEqual(['Abe', 'Zed']);
  });
});
