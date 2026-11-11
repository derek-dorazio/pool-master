import { describe, expect, it } from 'vitest';
import { formatUserInitials, formatUserName } from './user-name';

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

describe('formatUserInitials', () => {
  it('takes the first letter of the first and last name, in capitals', () => {
    expect(formatUserInitials(' derek ', 'dorazio')).toBe('DD');
  });

  it('gives one letter when only one name is present', () => {
    expect(formatUserInitials('Derek', null)).toBe('D');
    expect(formatUserInitials('  ', 'Dorazio')).toBe('D');
  });

  it('gives null when the user has no name at all, so the button shows a person icon', () => {
    expect(formatUserInitials(undefined, undefined)).toBeNull();
    expect(formatUserInitials(' ', '')).toBeNull();
  });
});
