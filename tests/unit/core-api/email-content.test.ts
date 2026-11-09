import {
  buildCreateContestUrl,
  formatStandingPlace,
  formatUserName,
} from '../../../packages/core-api/src/modules/email';

// The words and links every system email builds from (#845): a reader's name, a Create contest
// link, and a place as a sentence reads it.

const user = (firstName: string, lastName: string, username: string) => ({ firstName, lastName, username, email: 'riley@example.com' });

describe('formatUserName', () => {
  it('reads the full name, else a first or last name alone, else the username, else the address', () => {
    expect(formatUserName(user('Riley', 'Quinn', 'rq'))).toBe('Riley Quinn');
    expect(formatUserName(user(' ', 'Quinn', 'rq'))).toBe('Quinn');
    expect(formatUserName(user('', '', 'rq'))).toBe('rq');
    expect(formatUserName(user('', '', ''))).toBe('riley@example.com');
  });
});

describe('buildCreateContestUrl', () => {
  it('starts Create contest on a template and an event when given, and plain when not', () => {
    const base = 'https://app.example.test/league/OFFICE24/admin/contests/new';
    expect(buildCreateContestUrl('https://app.example.test', 'OFFICE24')).toBe(base);
    expect(buildCreateContestUrl('https://app.example.test', 'OFFICE24', { templateId: 't1', sportEventId: 'e1' })).toBe(`${base}?template=t1&event=e1`);
    expect(buildCreateContestUrl('https://app.example.test', 'OFFICE24', { sportEventId: 'e1' })).toBe(`${base}?event=e1`);
  });
});

describe('formatStandingPlace', () => {
  it('reads 1st, 2nd, 3rd, 4th, the teens and 21st by their suffixes, and a shared place as its T', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 112].map((position) => formatStandingPlace({ position, displayPosition: String(position) })))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '112th']);
    expect(formatStandingPlace({ position: 2, displayPosition: 'T2' })).toBe('T2');
  });
});
