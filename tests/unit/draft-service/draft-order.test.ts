import {
  generateRandomOrder,
  validateCommissionerOrder,
  generateDraftOrder,
} from '../../../packages/core-api/src/modules/drafts/engine/draft-order';

describe('generateRandomOrder', () => {
  it('returns all entry IDs', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const order = generateRandomOrder(ids);
    expect(order).toHaveLength(4);
    expect(order.sort()).toEqual(ids.sort());
  });

  it('does not mutate the input', () => {
    const ids = ['a', 'b', 'c'];
    const original = [...ids];
    generateRandomOrder(ids);
    expect(ids).toEqual(original);
  });
});

describe('validateCommissionerOrder', () => {
  const entries = ['a', 'b', 'c'];

  it('accepts valid order', () => {
    expect(validateCommissionerOrder(['c', 'a', 'b'], entries).valid).toBe(true);
  });

  it('rejects wrong length', () => {
    const result = validateCommissionerOrder(['a', 'b'], entries);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('3');
  });

  it('rejects duplicates', () => {
    const result = validateCommissionerOrder(['a', 'a', 'b'], entries);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Duplicate');
  });

  it('rejects unknown entry IDs', () => {
    const result = validateCommissionerOrder(['a', 'b', 'x'], entries);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('x');
  });
});

describe('generateDraftOrder', () => {
  const entries = ['a', 'b', 'c'];

  it('RANDOM returns shuffled entries', () => {
    const order = generateDraftOrder('RANDOM', entries);
    expect(order).toHaveLength(3);
    expect(order.sort()).toEqual(entries.sort());
  });

  it('COMMISSIONER uses provided order', () => {
    const order = generateDraftOrder('COMMISSIONER', entries, ['c', 'a', 'b']);
    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('COMMISSIONER throws without order', () => {
    expect(() => generateDraftOrder('COMMISSIONER', entries)).toThrow();
  });

  it('SIGNUP_ORDER preserves input order', () => {
    const order = generateDraftOrder('SIGNUP_ORDER', entries);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
