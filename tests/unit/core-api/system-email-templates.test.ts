import { EmailCategory, EmailTemplateKey, NotificationClass } from '@poolmaster/shared/domain';
import {
  EMAIL_SETTINGS,
  EMAIL_TEMPLATES,
  EntryReceiptKind,
  EntryReminderKind,
  StandingsMomentKind,
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

  const ENTRY = {
    userName: 'Derek Dorazio',
    leagueName: 'Mathworks',
    teamName: 'Derek Dorazio',
    entryName: 'Entry 1',
    entryUrl: 'https://app.primetimecommissioner.com/entries/entry-1',
    submittedAt: '2026-04-04T15:30:00.000Z',
  };

  it('renders a lineup receipt with each tier\'s selections, the tiebreaker and when picks close', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      contestName: 'Masters Pick 6',
      tiebreaker: '-12',
      receipt: {
        kind: EntryReceiptKind.LINEUP,
        tiers: [
          { tierName: 'Tier A', participantNames: ['Rory McIlroy', 'Ludvig Aberg'] },
          { tierName: 'Tier B', participantNames: ['Tommy Fleetwood', 'Robert MacIntyre'] },
        ],
        changeUntil: new Date('2026-04-09T11:40:00.000Z'),
      },
    }, UTC);

    expect(message.templateKey).toBe('CONTEST_ENTRY_COMPLETED');
    expect(message.text).toContain('You can change your picks until Apr 9, 2026, 11:40 AM UTC.');
    expect(message.subject).toBe('Entry submitted: Masters Pick 6');
    expect(message.text).toContain('- Tier A: Rory McIlroy, Ludvig Aberg');
    expect(message.text).toContain('Tiebreaker: -12');
    expect(message.text).not.toContain('Salary');
    expect(message.html).toContain('Entry completed');
    expect(message.html).toContain('Review entry');
    expect(message.html).toContain('Tommy Fleetwood, Robert MacIntyre');
  });

  it('adds what a budget lineup spent against the salary cap to its receipt', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      contestName: 'Masters Budget',
      receipt: {
        kind: EntryReceiptKind.LINEUP,
        tiers: [{ tierName: 'Golfers', participantNames: ['Scottie Scheffler', 'Min Woo Lee'] }],
        budget: { spent: 48_500, salaryCap: 50_000 },
        changeUntil: new Date('2026-04-09T11:40:00.000Z'),
      },
    }, UTC);

    expect(message.text).toContain('- Salary: $48,500 of $50,000');
  });

  it('renders a pick\'em receipt with each game\'s pick, its spread and its confidence, and says each pick changes until its game starts', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      contestName: 'NFL Pick\'em',
      tiebreaker: '45 total points (Bills at Chiefs)',
      receipt: {
        kind: EntryReceiptKind.GAME_PICKS,
        eventName: 'Week 1',
        games: [
          { matchup: 'Bills at Chiefs', pick: 'Chiefs -3.5', confidence: 2 },
          { matchup: 'Bears at Lions', pick: 'Bears +7', confidence: 1 },
        ],
      },
    }, UTC);

    expect(message.text).toContain('Week 1 picks:');
    expect(message.text).toContain('- Bills at Chiefs: Chiefs -3.5 (2)');
    expect(message.text).toContain('- Bears at Lions: Bears +7 (1)');
    expect(message.text).toContain('Tiebreaker: 45 total points (Bills at Chiefs)');
    expect(message.text).toContain('You can change each pick until its game starts.');
  });

  it('renders a bracket receipt round by round, the final first, with when the bracket locks', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      contestName: 'March Madness',
      receipt: {
        kind: EntryReceiptKind.BRACKET,
        eventName: 'NCAA Tournament',
        rounds: [
          { name: 'Championship', picks: ['Duke'] },
          { name: 'Final Four', picks: ['Duke', 'Houston'] },
        ],
        changeUntil: new Date('2026-03-19T16:15:00.000Z'),
      },
    }, UTC);

    expect(message.text).toContain('NCAA Tournament bracket:');
    expect(message.text).toContain('- Championship: Duke');
    expect(message.text).toContain('- Final Four: Duke, Houston');
    expect(message.text).toContain('You can change your bracket until Mar 19, 2026, 4:15 PM UTC.');
  });

  it('renders a survivor receipt with the team, its game and when the pick locks', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      contestName: 'NFL Survivor',
      receipt: {
        kind: EntryReceiptKind.SURVIVOR,
        eventName: 'Week 3',
        picks: [{ team: 'Lions', matchup: 'Bears at Lions', kickoff: new Date('2026-09-20T17:00:00.000Z') }],
      },
    }, UTC);

    expect(message.text).toContain('Week 3 pick:');
    expect(message.text).toContain('- Lions: Bears at Lions, Sep 20, 2026, 5:00 PM UTC');
    expect(message.text).toContain('You can change your pick until Sep 20, 2026, 5:00 PM UTC.');
  });

  it('renders a quick pick receipt with the dealt picks, saying the draw made them and leaving out a submit time', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      submittedAt: undefined,
      contestName: 'Masters Quick Pick',
      receipt: { kind: EntryReceiptKind.QUICK_PICK, picks: ['Scottie Scheffler', 'Min Woo Lee'] },
    }, UTC);

    expect(message.subject).toBe('Your quick picks: Masters Quick Pick');
    expect(message.text).toContain('Derek Dorazio, your Entry 1 entry got its picks in the quick pick draw for Masters Quick Pick.');
    expect(message.text).toContain('- Pick 1: Scottie Scheffler');
    expect(message.text).toContain('- Pick 2: Min Woo Lee');
    expect(message.text).toContain('The quick pick made these picks for you, so there\'s nothing to change.');
    expect(message.text).not.toContain('Submitted:');
  });

  it('renders a squares receipt with each box\'s row and column numbers by team', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', {
      ...ENTRY,
      submittedAt: undefined,
      contestName: 'Super Bowl Squares',
      receipt: {
        kind: EntryReceiptKind.SQUARES,
        rowTeam: 'Eagles',
        columnTeam: 'Chiefs',
        boxes: [{ rowNumber: 0, columnNumber: 7 }, { rowNumber: 3, columnNumber: 3 }],
      },
    }, UTC);

    expect(message.subject).toBe('Your numbers: Super Bowl Squares');
    expect(message.text).toContain('your Entry 1 entry has its numbers drawn for Super Bowl Squares.');
    expect(message.text).toContain('Your boxes:');
    expect(message.text).toContain('- Box 1: Eagles 0, Chiefs 7');
    expect(message.text).toContain('- Box 2: Eagles 3, Chiefs 3');
    expect(message.text).toContain('A box wins when the last digit of each team\'s score matches its numbers.');
  });

  it('renders the contest is live email with good luck, the event, the rules, the entry count and a Leaderboard button, and no entry list', () => {
    const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      event: { name: 'The Masters', startsAt: new Date('2026-04-09T11:40:00.000Z'), venue: 'Augusta National Golf Club' },
      eventFormat: '4 rounds',
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entryCount: 2,
      hasEntry: true,
      leaderboardUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1/leaderboard',
    }, UTC);

    expect(message.subject).toBe('Masters Pick 6 is live');
    expect(message.text).toContain('Good luck, everyone.');
    expect(message.text).toContain('Venue: Augusta National Golf Club');
    expect(message.text).toContain('Starts: Apr 9, 2026, 11:40 AM UTC');
    expect(message.text).toContain('Format: 4 rounds');
    expect(message.text).toContain('Rules: Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(message.text).toContain('Entries: 2');
    expect(message.text).toContain('Leaderboard: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1/leaderboard');
    expect(message.text).not.toContain('You didn\'t enter this one');
    expect(message.html).toContain('Leaderboard');
  });

  it('tells a member with no entry in a live contest that they can still follow it on the leaderboard', () => {
    const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
      userName: 'Morgan Member',
      leagueName: 'Mathworks',
      contestName: 'NFL Week 1 Pick\'em',
      event: { name: 'NFL Week 1', startsAt: new Date('2026-09-10T00:20:00.000Z') },
      rules: 'Pick the winner of every game.',
      entryCount: 1,
      hasEntry: false,
      leaderboardUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-2/leaderboard',
    }, UTC);

    expect(message.text).toContain('You didn\'t enter this one, but you can follow every entry on the leaderboard.');
    expect(message.text).not.toContain('Venue:');
    expect(message.text).not.toContain('Format:');
    expect(message.html).toContain('is live with 1 entry.');
  });

  it('renders the new contest email with the event, the rules, the entry limit, when picks close and an Enter contest button', () => {
    const message = renderSystemEmailTemplate('CONTEST_OPENED', {
      userName: 'Morgan Member',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      events: [{ name: 'The Masters', startsAt: new Date('2026-04-09T11:40:00.000Z'), venue: 'Augusta National Golf Club' }],
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entriesPerMember: '1 entry per member',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      contestUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1',
    }, UTC);

    expect(message.templateKey).toBe('CONTEST_OPENED');
    expect(message.subject).toBe('New contest: Masters Pick 6');
    expect(message.text).toContain('Masters Pick 6 is open in Mathworks.');
    expect(message.text).toContain('Event: The Masters');
    expect(message.text).toContain('Rules: Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(message.text).toContain('Entries: 1 entry per member');
    expect(message.text).toContain('Picks close: Apr 9, 2026, 11:40 AM UTC');
    expect(message.text).toContain('Enter contest: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1');
    expect(message.html).toContain('New contest open');
  });

  it('lists every event of a multi-event contest in the new contest email, and says when the first picks close', () => {
    const message = renderSystemEmailTemplate('CONTEST_OPENED', {
      userName: 'Morgan Member',
      leagueName: 'Mathworks',
      contestName: 'Majors Pool',
      events: [
        { name: 'The Masters', startsAt: new Date('2026-04-09T11:40:00.000Z') },
        { name: 'PGA Championship', startsAt: new Date('2026-05-14T11:40:00.000Z') },
      ],
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entriesPerMember: 'No limit on entries per member',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      contestUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-3',
    }, UTC);

    expect(message.text).toContain('Events: The Masters (Apr 9, 2026, 11:40 AM UTC), PGA Championship (May 14, 2026, 11:40 AM UTC)');
    expect(message.text).toContain('First picks close: Apr 9, 2026, 11:40 AM UTC');
  });

  it('renders the entry reminder with when picks close in the reader\'s time zone and a Make your picks button', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Masters Pick 6',
      eventName: 'The Masters',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      standing: { kind: EntryReminderKind.NOT_ENTERED },
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
      standing: { kind: EntryReminderKind.DRAFT, drafts: 1 },
      contestUrl: 'https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-2',
    }, UTC);

    expect(message.text).toContain('Your Week 7 entry is saved as a draft. It won\'t count until you submit it.');
    expect(message.text).not.toContain('haven\'t entered');
  });

  describe('live standings', () => {
    const standings = EMAIL_TEMPLATE_FIXTURES.CONTEST_STANDINGS;

    it('names the round in the subject and lists the leaders with each one\'s score and movement since the last email', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', standings, UTC);

      expect(message.subject).toBe('After round 2: Masters Pick 6');
      expect(message.text).toContain('Round 2 standings');
      expect(message.text).toContain('Here\'s where Masters Pick 6 stands after round 2 of The Masters.');
      expect(message.text).toContain('Top 3 of 18:');
      expect(message.text).toContain('1. Amen Corner (Casey & Co), -12, up 2');
      expect(message.text).toContain('T2. Green Jackets (Morgan Member), yours, -9, no change');
      expect(message.text).toContain('T2. Azalea (The Fourballs), -9, down 1');
      expect(message.html).toContain('▲2');
      expect(message.html).toContain('▼1');
      expect(message.text).toContain('Leaderboard: http://localhost:5173/league/OFFICE24/contests/contest-1/leaderboard');
    });

    it('lists the reader\'s entries placed below the leaders, and their golfers who missed the cut', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', standings, UTC);

      expect(message.text).toContain('Your entry:\n14. Long Shots (Morgan Member), yours, +3, down 4');
      expect(message.text).toContain('Missed the cut from Long Shots: Danny Willett, Mike Weir.');
    });

    it('shows no movement for an entry with no earlier standings email, and a dash for an entry with nothing scored', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        top: [{ place: null, entryName: 'Late Entry', squadName: 'Pat', score: null, movement: null, isYours: false }],
        yours: [],
        entryCount: 1,
        cut: [],
      }, UTC);

      expect(message.text).toContain('Standings:\n-. Late Entry (Pat), no score yet\n');
      expect(message.text).not.toContain('Your entr');
      expect(message.text).not.toContain('Missed the cut');
    });

    it('reports a finished event of a season contest with each entry\'s result in it and when the next event\'s picks close', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        moment: {
          kind: StandingsMomentKind.EVENT,
          eventName: 'The Masters',
          nextEvent: { name: 'PGA Championship', startsAt: new Date('2026-05-14T11:00:00.000Z'), picksCloseAt: new Date('2026-05-14T11:00:00.000Z') },
        },
        top: [{ place: '1', entryName: 'Amen Corner', squadName: 'Casey & Co', score: '-20', movement: null, isYours: false, eventResult: 'T2, -9' }],
        yours: [],
        entryCount: 1,
        cut: [],
      }, { timeZone: 'America/New_York' });

      expect(message.subject).toBe('After The Masters: Masters Pick 6');
      expect(message.text).toContain('The Masters results');
      expect(message.text).toContain('The Masters is done. Here\'s where Masters Pick 6 stands.');
      expect(message.text).toContain('1. Amen Corner (Casey & Co), -20, this event T2, -9');
      expect(message.text).toContain('Next event: PGA Championship, May 14, 2026, 7:00 AM EDT');
      expect(message.text).toContain('Picks close: May 14, 2026, 7:00 AM EDT');
    });
  });

  describe('entry reminder wording by why it goes to the reader', () => {
    const base = {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Office Pool',
      eventName: 'The Masters',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      contestUrl: 'https://app.example.test/league/OFFICE24/contests/contest-1',
    };

    it('says how far along a single draft is, as picks made of picks needed', () => {
      const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
        ...base,
        standing: { kind: EntryReminderKind.DRAFT, drafts: 1, progress: { made: 4, of: 6 } },
      }, UTC);

      expect(message.text).toContain('Your The Masters entry is a draft with 4 of 6 picked. It won\'t count until you submit it.');
    });

    it('counts a reader\'s drafts rather than one draft\'s progress when they have several', () => {
      const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
        ...base,
        standing: { kind: EntryReminderKind.DRAFT, drafts: 2 },
      }, UTC);

      expect(message.text).toContain('You have 2 draft entries for The Masters. They won\'t count until you submit them.');
    });

    it('asks a member not in a random draw to join it, since the draw deals the picks', () => {
      const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
        ...base,
        standing: { kind: EntryReminderKind.NOT_JOINED },
      }, UTC);

      expect(message.subject).toBe('Entries close soon: Office Pool');
      expect(message.text).toContain('Just join Office Pool before entries close. It\'s a quick pick contest, so your picks are made for you.');
      expect(message.text).toContain('Entries close: Apr 9, 2026');
      expect(message.text).toContain(`Join the contest: ${base.contestUrl}`);
      expect(message.text).not.toContain('Make your picks');
    });

    it('asks a squares member without a box to claim one before the game starts or the numbers are drawn', () => {
      const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
        ...base,
        standing: { kind: EntryReminderKind.NO_BOX },
      }, UTC);

      expect(message.subject).toBe('Boxes close soon: Office Pool');
      expect(message.text).toContain('You haven\'t claimed a box on the Office Pool grid yet. Boxes close when the game starts, or sooner if the numbers are drawn first.');
      expect(message.text).toContain('Game starts: Apr 9, 2026');
      expect(message.text).toContain(`Claim your boxes: ${base.contestUrl}`);
    });
  });

  it('ends an email with a "Stop these emails" link in both bodies when it is given one, and with none otherwise', () => {
    const data = {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      event: { name: 'Manual Test Golf Tournament', startsAt: new Date('2026-04-05T14:00:00.000Z') },
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entryCount: 0,
      hasEntry: false,
      leaderboardUrl: 'https://app.example.test/contests/contest-1/leaderboard',
    };
    const unsubscribeUrl = 'https://app.example.test/email/unsubscribe?token=a&b';

    const linked = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', data, { ...UTC, unsubscribeUrl });
    const plain = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', data, UTC);

    expect(linked.text).toContain(`Stop these emails: ${unsubscribeUrl}`);
    expect(linked.html).toContain('href="https://app.example.test/email/unsubscribe?token=a&amp;b"');
    expect(linked.html).toContain('Stop these emails');
    expect(plain.text).not.toContain('Stop these emails');
    expect(plain.html).not.toContain('Stop these emails');
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
      CONTEST_OPENED: EmailCategory.CONTEST_UPDATES,
      CONTEST_STANDINGS: EmailCategory.LIVE_STANDINGS,
      PASSWORD_RESET: EmailCategory.ACCOUNT,
      PASSWORD_CHANGED: EmailCategory.ACCOUNT,
    });
  });

  it('gives every template a notification class: account and membership email essential, the contest opening and receipts on the free class, reminders, the live email and live standings on the first paid class', () => {
    expect(Object.fromEntries(Object.entries(EMAIL_TEMPLATES).map(([key, template]) => [key, template.notificationClass]))).toEqual({
      LEAGUE_MEMBER_INVITE: NotificationClass.ESSENTIAL,
      LEAGUE_JOIN_SUCCESS: NotificationClass.ESSENTIAL,
      CONTEST_ENTRY_COMPLETED: NotificationClass.A,
      CONTEST_STARTED_SUMMARY: NotificationClass.B,
      CONTEST_ENTRY_REMINDER: NotificationClass.B,
      CONTEST_OPENED: NotificationClass.A,
      CONTEST_STANDINGS: NotificationClass.B,
      PASSWORD_RESET: NotificationClass.ESSENTIAL,
      PASSWORD_CHANGED: NotificationClass.ESSENTIAL,
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
