import {
  listSystemEmailTemplateKeys,
  renderSystemEmailTemplate,
} from '../../../packages/core-api/src/modules/email';

describe('pool-master-98i system email templates', () => {
  it('renders the league member invite with Prime Time Commissioner theme and fallback text', () => {
    const message = renderSystemEmailTemplate('LEAGUE_MEMBER_INVITE', {
      recipientEmail: 'member@example.com',
      inviterName: 'Commissioner One',
      leagueName: 'Mathworks',
      leagueCode: 'MATHWORKS',
      inviteUrl: 'https://app.primetimecommissioner.com/invite/abc123',
      expiresAt: '2026-05-04T18:30:00.000Z',
    });

    expect(message.templateKey).toBe('LEAGUE_MEMBER_INVITE');
    expect(message.subject).toBe('Commissioner One invited you to Mathworks');
    expect(message.text).toContain('Prime Time Commissioner');
    expect(message.text).toContain('Ultimate Office Pool Manager');
    expect(message.text).toContain('Join league: https://app.primetimecommissioner.com/invite/abc123');
    expect(message.html).toContain('Prime Time Commissioner');
    expect(message.html).toContain('Ultimate Office Pool Manager');
    expect(message.html).toContain('background:#0b1e3f');
    expect(message.html).toContain('background:#f5b800');
  });

  it('renders the registration and league join success email', () => {
    const message = renderSystemEmailTemplate('LEAGUE_JOIN_SUCCESS', {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      leagueCode: 'MATHWORKS',
      leagueHomeUrl: 'https://app.primetimecommissioner.com/leagues/league-1',
    });

    expect(message.templateKey).toBe('LEAGUE_JOIN_SUCCESS');
    expect(message.subject).toBe('Welcome to Mathworks');
    expect(message.text).toContain('your account is registered and you joined Mathworks');
    expect(message.html).toContain('You are in');
    expect(message.html).toContain('Open league');
  });

  it('renders the contest entry completed email with tier selections and tiebreaker', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      teamName: "Derek Dorazio's Team",
      entryName: 'Entry 1',
      entryUrl: 'https://app.primetimecommissioner.com/entries/entry-1',
      submittedAt: '2026-04-04T15:30:00.000Z',
      tiebreaker: '-12',
      tiers: [
        { tierName: 'Tier A', participantNames: ['Rory McIlroy', 'Ludvig Aberg'] },
        { tierName: 'Tier B', participantNames: ['Tommy Fleetwood', 'Robert MacIntyre'] },
      ],
    });

    expect(message.templateKey).toBe('CONTEST_ENTRY_COMPLETED');
    expect(message.subject).toBe('Entry submitted: Masters Pick 6');
    expect(message.text).toContain('- Tier A: Rory McIlroy, Ludvig Aberg');
    expect(message.text).toContain('Tiebreaker: -12');
    expect(message.html).toContain('Entry completed');
    expect(message.html).toContain('Review entry');
    expect(message.html).toContain('Tommy Fleetwood, Robert MacIntyre');
  });

  it('renders the contest started summary body with entry count and contest board link', () => {
    const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      eventName: 'Manual Test Golf Tournament',
      contestUrl: 'https://app.primetimecommissioner.com/contests/contest-1',
      startedAt: '2026-04-05T14:00:00.000Z',
      entryCount: 2,
      entries: [
        { entryName: 'Entry 1', teamName: "Derek Dorazio's Team" },
        { entryName: 'Entry 2', teamName: 'Member Team' },
      ],
    });

    expect(message.templateKey).toBe('CONTEST_STARTED_SUMMARY');
    expect(message.subject).toBe('Masters Pick 6 has started');
    expect(message.text).toContain('Entries: 2');
    expect(message.text).toContain('- Entry 2: Member Team');
    expect(message.html).toContain('Contest started');
    expect(message.html).toContain('Open contest board');
  });

  it('escapes untrusted HTML in themed message bodies', () => {
    const message = renderSystemEmailTemplate('LEAGUE_JOIN_SUCCESS', {
      userName: '<script>alert("x")</script>',
      leagueName: '<League & Co>',
      leagueCode: 'LEAGUE',
      leagueHomeUrl: 'https://app.primetimecommissioner.com/leagues/league-1?x=<bad>',
    });

    expect(message.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(message.html).toContain('&lt;League &amp; Co&gt;');
    expect(message.html).not.toContain('<script>alert');
    expect(message.html).not.toContain('href="https://app.primetimecommissioner.com/leagues/league-1?x=<bad>"');
  });

  it('lists all initial pool-master-98i template keys', () => {
    expect(listSystemEmailTemplateKeys()).toEqual([
      'LEAGUE_MEMBER_INVITE',
      'LEAGUE_JOIN_SUCCESS',
      'CONTEST_ENTRY_COMPLETED',
      'CONTEST_STARTED_SUMMARY',
    ]);
  });
});
