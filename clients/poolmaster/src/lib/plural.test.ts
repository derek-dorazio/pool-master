import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it('names one thing in the singular', () => {
    expect(plural(1, 'member')).toBe('1 member');
  });

  it('adds an s for none or several when no plural is given', () => {
    expect(plural(0, 'team')).toBe('0 teams');
    expect(plural(3, 'team')).toBe('3 teams');
  });

  it('uses the given plural for a noun that does not take an s', () => {
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });
});
