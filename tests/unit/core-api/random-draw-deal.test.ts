import { dealRandomDraw } from '../../../packages/core-api/src/modules/selections/selection-engines/random-draw';

// The draw's deal (#601), called directly: pure, so these tests hand it a seed, a field and
// the entries, and read back what each entry was dealt.

const FIELD = Array.from({ length: 11 }, (_, index) => `sep-${String(index).padStart(2, '0')}`);
const ENTRIES = ['entry-a', 'entry-b', 'entry-c'];

function deal(overrides: Partial<Parameters<typeof dealRandomDraw>[0]> = {}) {
  return dealRandomDraw({
    seed: 'seed-1',
    sportEventParticipantIds: FIELD,
    entryIds: ENTRIES,
    picksPerEntry: 3,
    ...overrides,
  });
}

describe('dealRandomDraw', () => {
  it('deals every entry the same number of picks, and no member of the field twice', () => {
    const { entries } = deal();
    const dealt = entries.flatMap((entry) => entry.sportEventParticipantIds);

    expect(entries.map((entry) => entry.sportEventParticipantIds.length)).toEqual([3, 3, 3]);
    expect(new Set(dealt).size).toBe(9);
    expect(dealt.every((id) => FIELD.includes(id))).toBe(true);
    expect([...entries.map((entry) => entry.entryId)].sort()).toEqual(ENTRIES);
  });

  it('leaves the field members after the last round undealt', () => {
    const { fieldOrder, entries } = deal();
    const dealt = new Set(entries.flatMap((entry) => entry.sportEventParticipantIds));

    expect(fieldOrder.slice(9).some((id) => dealt.has(id))).toBe(false);
  });

  it('deals round-robin from the shuffled orders, one card each per round', () => {
    const { fieldOrder, entryOrder, entries } = deal();

    expect(entries.map((entry) => entry.entryId)).toEqual(entryOrder);
    expect(entries[1]?.sportEventParticipantIds).toEqual([fieldOrder[1], fieldOrder[4], fieldOrder[7]]);
  });

  it('deals exactly the same picks again from the same seed, however the field and entries were ordered', () => {
    const replay = deal({
      sportEventParticipantIds: [...FIELD].reverse(),
      entryIds: [...ENTRIES].reverse(),
    });

    expect(replay).toEqual(deal());
  });

  it('shuffles the field differently for a different seed', () => {
    expect(deal({ seed: 'seed-2' }).fieldOrder).not.toEqual(deal().fieldOrder);
  });

  it('shuffles the field rather than dealing it in id order', () => {
    expect(deal().fieldOrder).not.toEqual(FIELD);
    expect([...deal().fieldOrder].sort()).toEqual(FIELD);
  });
});
