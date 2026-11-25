import { buildDefaultSquadName, formatUserFullName } from '../../../packages/core-api/src/core/user-name';

describe('formatUserFullName', () => {
  it('joins the trimmed first and last names with one space', () => {
    expect(formatUserFullName('  Derek ', ' Smith  ')).toBe('Derek Smith');
  });

  it('uses whichever name is there when the other is missing or blank', () => {
    expect(formatUserFullName('Derek', null)).toBe('Derek');
    expect(formatUserFullName('   ', 'Smith')).toBe('Smith');
  });

  it('answers "Unknown User" when neither name has any text', () => {
    expect(formatUserFullName(null, undefined)).toBe('Unknown User');
    expect(formatUserFullName(' ', '')).toBe('Unknown User');
  });
});

describe('buildDefaultSquadName', () => {
  it('names a new team after its owner, or "Unknown User" with no name', () => {
    expect(buildDefaultSquadName('Derek', 'Smith')).toBe('Derek Smith');
    expect(buildDefaultSquadName(null, null)).toBe('Unknown User');
  });
});
