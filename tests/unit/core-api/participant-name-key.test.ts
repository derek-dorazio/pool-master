import { describe, expect, it } from '@jest/globals';
import { participantNameKey } from '../../../packages/core-api/src/modules/ingestion/core/participant-name-key';

// The folded name two sources' spellings of one player share, for linking by name (#1664).
describe('participantNameKey', () => {
  it.each([
    ['drops accents', 'Luka Dončić', 'Luka Doncic'],
    ['ignores case', 'LeBron James', 'lebron JAMES'],
    ['drops punctuation inside a name', 'P.J. Washington', 'PJ Washington'],
    ['drops an apostrophe', "De'Aaron Fox", 'DeAaron Fox'],
    ['reads a hyphen as a space', 'Shai Gilgeous-Alexander', 'Shai Gilgeous Alexander'],
    ['reads a run of spaces as one', '  Jayson   Tatum ', 'Jayson Tatum'],
    ['leaves off a trailing Jr.', 'Jaren Jackson Jr.', 'Jaren Jackson'],
    ['leaves off a trailing Sr', 'Larry Nance Sr', 'Larry Nance'],
    ['leaves off a trailing II, III or IV', 'Gary Payton II', 'Gary Payton'],
    ['leaves off a trailing III', 'Robert Williams III', 'Robert Williams'],
    ['leaves off a trailing IV, after a comma', 'Sam Jones, IV', 'Sam Jones'],
  ])('%s, so the two spellings read the same', (_label, one, other) => {
    expect(participantNameKey(one)).toBe(participantNameKey(other));
  });

  it('folds a name to lower case words joined by single spaces', () => {
    expect(participantNameKey('Nikola Jokić')).toBe('nikola jokic');
  });

  it('keeps a suffix word that is not at the end, and a two-word name whose last word reads as one', () => {
    expect(participantNameKey('Jr Smith Jones')).toBe('jr smith jones');
    expect(participantNameKey('Malcolm II')).toBe('malcolm ii');
  });

  it('keeps apart names that differ in more than accents, case, punctuation and a suffix', () => {
    expect(participantNameKey('Jalen Williams')).not.toBe(participantNameKey('Jaylin Williams'));
    expect(participantNameKey('Gary Payton II')).not.toBe(participantNameKey('Gary Paytons'));
  });

  it('keeps a letter that is its own letter rather than one with a mark', () => {
    expect(participantNameKey('Søren Kjeldsen')).toBe('søren kjeldsen');
  });
});
