import { EmailTemplateKey } from '@poolmaster/shared/domain';
import {
  EMAIL_SETTINGS,
  EMAIL_TEMPLATES,
  EmailCategory,
  renderSystemEmailTemplate,
  type SystemEmailTemplateKey,
} from '../../../packages/core-api/src/modules/email';
import { EMAIL_TEMPLATE_FIXTURES } from '../../support/email-template-fixtures';

const UTC = { timeZone: 'UTC' };

describe('pool-master-98i system email templates', () => {
  it('renders the league member invite with Prime Time Commissioner theme and fallback text', () => {
    const message = renderSystemEmailTemplate('LEAGUE_MEMBER_INVITE', {
      recipientEmail: 'member@example.com',
      inviterName: 'Commissioner One',
      leagueName: 'Mathworks',
      leagueCode: 'MATHWORKS',
      inviteUrl: 'https://app.primetimecommissioner.com/invite/abc123',
      expiresAt: '2026-05-04T18:30:00.000Z',
    }, UTC);

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
    }, UTC);

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
      teamName: "Derek Dorazio",
      entryName: 'Entry 1',
      entryUrl: 'https://app.primetimecommissioner.com/entries/entry-1',
      submittedAt: '2026-04-04T15:30:00.000Z',
      tiebreaker: '-12',
      tiers: [
        { tierName: 'Tier A', participantNames: ['Rory McIlroy', 'Ludvig Aberg'] },
        { tierName: 'Tier B', participantNames: ['Tommy Fleetwood', 'Robert MacIntyre'] },
      ],
    }, UTC);

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
        { entryName: 'Entry 1', teamName: "Derek Dorazio" },
        { entryName: 'Entry 2', teamName: 'Member Team' },
      ],
    }, UTC);

    expect(message.templateKey).toBe('CONTEST_STARTED_SUMMARY');
    expect(message.subject).toBe('Masters Pick 6 has started');
    expect(message.text).toContain('Entries: 2');
    expect(message.text).toContain('- Entry 2: Member Team');
    expect(message.html).toContain('Contest started');
    expect(message.html).toContain('Open contest board');
  });

  it('renders the entry reminder with when picks close in the reader\'s time zone and a Make your picks button', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Masters Pick 6',
      eventName: 'The Masters',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      hasDraft: false,
      contestUrl: 'https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-1',
    }, { timeZone: 'America/New_York' });

    expect(message.subject).toBe('Picks close soon: Masters Pick 6');
    expect(message.text).toContain('You haven\'t entered Masters Pick 6 for The Masters yet.');
    expect(message.text).toContain('Picks close: Apr 9, 2026, 7:40 AM EDT');
    expect(message.text).toContain('Make your picks: https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-1');
    expect(message.html).toContain('Make your picks');
  });

  it('tells a reader with a draft entry that it won\'t count until submitted', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'NFL Pick\'em',
      eventName: 'Week 7',
      closesAt: new Date('2026-10-22T00:15:00.000Z'),
      hasDraft: true,
      contestUrl: 'https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-2',
    }, UTC);

    expect(message.text).toContain('Your Week 7 entry is saved as a draft. It won\'t count until you submit it.');
    expect(message.text).not.toContain('haven\'t entered');
  });

  it('escapes untrusted HTML in themed message bodies', () => {
    const message = renderSystemEmailTemplate('LEAGUE_JOIN_SUCCESS', {
      userName: '<script>alert("x")</script>',
      leagueName: '<League & Co>',
      leagueCode: 'LEAGUE',
      leagueHomeUrl: 'https://app.primetimecommissioner.com/leagues/league-1?x=<bad>',
    }, UTC);

    expect(message.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(message.html).toContain('&lt;League &amp; Co&gt;');
    expect(message.html).not.toContain('<script>alert');
    expect(message.html).not.toContain('href="https://app.primetimecommissioner.com/leagues/league-1?x=<bad>"');
  });
});

describe('the email template registry', () => {
  it('gives every template key a category, with invitations, welcomes and the password reset and password changed emails ones a member can\'t turn off', () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual(Object.values(EmailTemplateKey).sort());
    expect(Object.fromEntries(Object.entries(EMAIL_TEMPLATES).map(([key, template]) => [key, template.category]))).toEqual({
      LEAGUE_MEMBER_INVITE: EmailCategory.MEMBERSHIP,
      LEAGUE_JOIN_SUCCESS: EmailCategory.MEMBERSHIP,
      CONTEST_ENTRY_COMPLETED: EmailCategory.RECEIPTS,
      CONTEST_STARTED_SUMMARY: EmailCategory.LIVE_STANDINGS,
      CONTEST_ENTRY_REMINDER: EmailCategory.CONTEST_UPDATES,
      PASSWORD_RESET: EmailCategory.ACCOUNT,
      PASSWORD_CHANGED: EmailCategory.ACCOUNT,
    });
  });

  it('marks as switchable exactly the emails EMAIL_CONFIG has a switch for, so the service checks the right ones', () => {
    const switchable = Object.entries(EMAIL_TEMPLATES)
      .filter(([, template]) => template.settingsSwitch)
      .map(([key]) => key);

    expect(switchable.sort()).toEqual(Object.keys(EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }).templates).sort());
  });

  it('renders every template\'s preview example with a subject, a plain-text twin, the branded HTML shell and the unread-replies footer', () => {
    for (const templateKey of Object.keys(EMAIL_TEMPLATES) as SystemEmailTemplateKey[]) {
      const message = renderSystemEmailTemplate(templateKey, EMAIL_TEMPLATE_FIXTURES[templateKey], UTC);

      expect(message.templateKey).toBe(templateKey);
      expect(message.subject.length).toBeGreaterThan(0);
      expect(message.text).toContain('Prime Time Commissioner');
      expect(message.text).toContain('Replies to this email aren\'t read.');
      expect(message.html).toMatch(/^<!doctype html>/);
      expect(message.html).toContain('Replies to this email aren&#39;t read.');
    }
  });
});
