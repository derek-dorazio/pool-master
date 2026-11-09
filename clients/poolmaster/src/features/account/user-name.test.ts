import { describe, expect, it } from 'vitest';
import { formatUserName } from './user-name';

describe('formatUserName', () => {
  it('joins the trimmed first and last name with one space', () => {
    expect(formatUserName('  Derek ', ' Dorazio  ')).toBe('Derek Dorazio');
  });

  it('shows only the name that is present when the other is missing or blank', () => {
    expect(formatUserName('Derek', null)).toBe('Derek');
    expect(formatUserName('   ', 'Dorazio')).toBe('Dorazio');
  });

  it('falls back to "Account" when the user has no name at all', () => {
    expect(formatUserName(undefined, undefined)).toBe('Account');
    expect(formatUserName(' ', '')).toBe('Account');
  });
});
