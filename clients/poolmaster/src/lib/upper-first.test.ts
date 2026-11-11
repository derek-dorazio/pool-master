import { describe, expect, it } from 'vitest';
import { upperFirst } from './upper-first';

describe('upperFirst', () => {
  it('upper-cases only the first letter, leaving the rest as written', () => {
    expect(upperFirst('golfer')).toBe('Golfer');
    expect(upperFirst('pGA tour')).toBe('PGA tour');
  });

  it('returns an empty word unchanged', () => {
    expect(upperFirst('')).toBe('');
  });
});
