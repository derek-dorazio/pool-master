import { describe, expect, it } from 'vitest';
import { EVENT_FIELD_NUMERIC_VALIDATORS, eventFieldServerValue } from './event-field-patch';
import { eventFieldColumnsShown, eventFieldRows, fieldValueSetBy } from './event-field-rows';
import { participantCorrection, participantSchema, participantValuesOf } from './event-participant-form';
import { fieldEntryFixture, participantFixture, tierFixture, valuationFixture } from './sport-test-fixtures';

const TIERS = [tierFixture({ tierNumber: 1 }), tierFixture({ tierNumber: 2 })];

function entry(id: string, overrides: Parameters<typeof fieldEntryFixture>[0] = {}) {
  return fieldEntryFixture({ id, participantId: `p-${id}`, participant: participantFixture({ id: `p-${id}`, name: id }), ...overrides });
}

describe('Field grid rows', () => {
  it('reads Manual when either the tier or the price was corrected, Auto when only automatic values are set, and nothing when neither is', () => {
    expect(fieldValueSetBy(valuationFixture({ tierAssignedSource: 'AUTO_ODDS', priceAssignedSource: 'MANUAL' }))).toBe('MANUAL');
    expect(fieldValueSetBy(valuationFixture({ tierAssignedSource: 'AUTO_SEED' }))).toBe('AUTO');
    expect(fieldValueSetBy(valuationFixture())).toBeNull();
    expect(fieldValueSetBy(null)).toBeNull();
  });

  it('gives each row its tier and the feed\'s last sighting, and leaves both blank when it has neither', () => {
    const rows = eventFieldRows(
      [entry('a', { valuation: valuationFixture({ sportEventTierId: 'tier-2', price: 700 }) }), entry('b', { valuation: null })],
      TIERS,
      [{ sportEventParticipantId: 'a', feedId: 'feed-a', lastInFeedAt: '2026-05-01T00:00:00.000Z' }],
    );

    expect(rows.map((row) => [row.id, row.tierLabel, row.tierNumber, row.price, row.feedId, row.lastInFeedAt])).toEqual([
      ['a', 'Tier 2', 2, 700, 'feed-a', '2026-05-01T00:00:00.000Z'],
      ['b', null, null, null, null, null],
    ]);
  });

  it('shows Team, Country and Seed only when someone has one, and Last in feed only on a synced event', () => {
    const plain = eventFieldRows([entry('a')], TIERS, []);
    const full = eventFieldRows([entry('a', {
      seedNumber: 1,
      participant: participantFixture({ id: 'p-a', name: 'a', teamAffiliation: 'Ferrari', nationality: 'MON' }),
    })], TIERS, []);

    expect(eventFieldColumnsShown(plain, false)).toEqual({ team: false, country: false, seed: false, lastInFeed: false });
    expect(eventFieldColumnsShown(full, true)).toEqual({ team: true, country: true, seed: true, lastInFeed: true });
  });
});

describe('the participant dialog\'s corrections', () => {
  const both = { tierAndPrice: true, orderValues: true };

  it('accepts blank for any value and refuses a rank of 0, odds of 0 and a fractional price', () => {
    const base = { tierKey: '', price: '', ranking: '', oddsToWin: '', seedNumber: '' };
    expect(participantSchema.safeParse(base).success).toBe(true);
    expect(participantSchema.safeParse({ ...base, ranking: '0' }).success).toBe(false);
    expect(participantSchema.safeParse({ ...base, oddsToWin: '0' }).success).toBe(false);
    expect(participantSchema.safeParse({ ...base, price: '10.5' }).success).toBe(false);
    expect(EVENT_FIELD_NUMERIC_VALIDATORS.ranking('2147483648')).toBe(false);
  });

  it('reads the row\'s values as typed text, its price from its valuation', () => {
    const row = entry('a', { ranking: 4, oddsToWin: 12.5, seedNumber: null, valuation: valuationFixture({ sportEventTierId: 'tier-1', price: 900 }) });
    expect(participantValuesOf(row, TIERS)).toEqual({ tierKey: 'TIER_1', price: '900', ranking: '4', oddsToWin: '12.5', seedNumber: '' });
    expect(eventFieldServerValue(row, 'price')).toBe(900);
  });

  it('sends only changed values, a cleared one as null, and nothing when nothing changed', () => {
    const row = entry('a', { ranking: 4, oddsToWin: 12.5 });
    const current = participantValuesOf(row, TIERS);

    expect(participantCorrection(current, current, row, { editable: both, field: [row], tiers: TIERS })).toEqual({ patch: null, tierMove: null });
    expect(participantCorrection({ ...current, ranking: '', oddsToWin: '9' }, current, row, { editable: both, field: [row], tiers: TIERS }).patch)
      .toEqual({ sportEventParticipantId: 'a', ranking: null, oddsToWin: 9 });
  });

  it('leaves rank, odds and seed alone where a feed sets them, and tier and price alone once released', () => {
    const row = entry('a', { ranking: 4 });
    const current = participantValuesOf(row, TIERS);
    const changed = { ...current, ranking: '1', price: '500', tierKey: 'TIER_2' };

    expect(participantCorrection(changed, current, row, { editable: { tierAndPrice: true, orderValues: false }, field: [row], tiers: TIERS }).patch)
      .toEqual({ sportEventParticipantId: 'a', price: 500 });
    expect(participantCorrection(changed, current, row, { editable: { tierAndPrice: false, orderValues: true }, field: [row], tiers: TIERS }))
      .toEqual({ patch: { sportEventParticipantId: 'a', ranking: 1 }, tierMove: null });
  });

  it('moves a participant last into its new tier, counting only the others already there', () => {
    const moving = entry('a', { valuation: valuationFixture({ sportEventTierId: 'tier-1' }) });
    const field = [moving, entry('b', { valuation: valuationFixture({ sportEventTierId: 'tier-2' }) }), entry('c', { valuation: valuationFixture({ sportEventTierId: 'tier-2' }) })];
    const current = participantValuesOf(moving, TIERS);

    expect(participantCorrection({ ...current, tierKey: 'TIER_2' }, current, moving, { editable: both, field, tiers: TIERS }).tierMove)
      .toEqual({ sportEventParticipantId: 'a', tierKey: 'TIER_2', tierOrderIndex: 2 });
  });
});
