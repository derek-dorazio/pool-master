import { EmailCategory, EmailTemplateKey, PLAN_FEATURE_GROUP, PlanFeature, PlanFeatureGroup } from '@poolmaster/shared/domain';
import {
  EMAIL_SETTINGS,
  ContestEventChangeKind,
  ContestResultsKind,
  EMAIL_TEMPLATES,
  EntryReceiptKind,
  EntryReminderKind,
  MemberJoinedTiming,
  StandingsMomentKind,
  renderSystemEmailTemplate,
  type SystemEmailTemplateKey,
} from '../../../packages/core-api/src/modules/email';
import { EMAIL_TEMPLATE_FIXTURES } from '../../support/email-template-fixtures';

const UTC = { timeZone: 'UTC' };

describe('pool-master-98i system email templates', () => {
  it('renders the league member invite with Primetime Commissioner theme and fallback text', () => {
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
    expect(message.text).toContain('Primetime Commissioner');
    expect(message.text).toContain('The ultimate office pool manager and other game-day contests');
    expect(message.text).toContain('Join league: https://app.primetimecommissioner.com/invite/abc123');
    expect(message.html).toContain('Primetime Commissioner');
    expect(message.html).toContain('The ultimate office pool manager and other game-day contests');
    expect(message.html).toContain('background:#0b1e3f');
    expect(message.html).toContain('background:#f5b800');
  });

  it('renders the registration and league join success email', () => {
    const message = renderSystemEmailTemplate('LEAGUE_JOIN_SUCCESS', {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      leagueCode: 'MATHWORKS',
      leagueHomeUrl: 'https://app.primetimecommissioner.com/leagues/league-1',
      openContests: [],
    }, UTC);

    expect(message.templateKey).toBe('LEAGUE_JOIN_SUCCESS');
    expect(message.subject).toBe('Welcome to Mathworks');
    expect(message.text).toContain('your account is registered and you joined Mathworks');
    expect(message.html).toContain('You are in');
    expect(message.html).toContain('Open league');
  });

  const MASTERS_EVENT = EMAIL_TEMPLATE_FIXTURES.CONTEST_OPENED.event;
  const TIERED = EMAIL_TEMPLATE_FIXTURES.CONTEST_OPENED.format;
  const REMINDER_CARD = { format: TIERED, rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.', entryCount: 14 };
  const ENTRY = {
    userName: 'Derek Dorazio',
    leagueName: 'Mathworks',
    teamName: 'Derek Dorazio',
    entryName: 'Entry 1',
    entryUrl: 'https://app.primetimecommissioner.com/entries/entry-1',
    submittedAt: '2026-04-04T15:30:00.000Z',
    event: EMAIL_TEMPLATE_FIXTURES.CONTEST_ENTRY_COMPLETED.event,
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
    expect(message.text).toContain('You can change your picks until Thu, Apr 9, 2026.');
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
    expect(message.text).toContain('You can change your bracket until Thu, Mar 19, 2026.');
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
    expect(message.text).toContain('- Lions: Bears at Lions, Sun, Sep 20, 2026');
    expect(message.text).toContain('You can change your pick until Sun, Sep 20, 2026.');
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

  it('renders the contest is live email with the event\'s picture, good luck, the entries, format and event as stats, the rules and a Watch the leaderboard button, and no entry list', () => {
    const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      event: MASTERS_EVENT,
      venue: 'Augusta National Golf Club',
      format: TIERED,
      eventFormat: '4 rounds',
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entryCount: 2,
      hasEntry: true,
      leaderboardUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1/leaderboard',
    }, UTC);

    expect(message.subject).toBe('Masters Pick 6 is live');
    expect(message.text).toContain('The Masters (PGA Tour), Thu, Apr 9, 2026');
    expect(message.text).toContain('Good luck, everyone. Masters Pick 6 is live with 2 entries.');
    expect(message.text).toContain('Entries: 2\nFormat: Tiered\nEvent: 4 rounds\nPick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(message.text).toContain('Watch the leaderboard: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1/leaderboard');
    expect(message.text).toContain('Venue: Augusta National Golf Club');
    expect(message.text).not.toContain('You didn\'t enter this one');
    expect(message.html).toContain(`src="${MASTERS_EVENT.imageUrl}"`);
    expect(message.html).toContain('PGA Tour · Contest is live');
  });

  it('tells a member with no entry in a live contest that they can still follow it on the leaderboard', () => {
    const message = renderSystemEmailTemplate('CONTEST_STARTED_SUMMARY', {
      userName: 'Morgan Member',
      leagueName: 'Mathworks',
      contestName: 'NFL Week 1 Pick\'em',
      event: { ...MASTERS_EVENT, sportLeagueName: 'NFL', eventName: 'NFL Week 1', startsAt: new Date('2026-09-10T00:20:00.000Z') },
      format: { name: 'Pick\'em', imageUrl: 'https://app.example.test/email/formats/pick-em.png' },
      rules: 'Pick the winner of every game.',
      entryCount: 1,
      hasEntry: false,
      leaderboardUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-2/leaderboard',
    }, UTC);

    expect(message.text).toContain('You didn\'t enter this one, but you can follow every entry on the leaderboard.');
    expect(message.text).not.toContain('Venue:');
    expect(message.text).not.toContain('Event:');
    expect(message.html).toContain('is live with 1 entry.');
  });

  it('renders the new contest email with the event\'s picture, the contest card with its format, rules and entry limit, when picks close and an Enter contest button', () => {
    const message = renderSystemEmailTemplate('CONTEST_OPENED', {
      userName: 'Morgan Member',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      event: MASTERS_EVENT,
      events: [{ name: 'The Masters', startsAt: new Date('2026-04-09T11:40:00.000Z'), venue: 'Augusta National Golf Club' }],
      format: TIERED,
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entriesPerMember: '1 entry per member',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      contestUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1',
    }, UTC);

    expect(message.templateKey).toBe('CONTEST_OPENED');
    expect(message.subject).toBe('New contest: Masters Pick 6');
    expect(message.text).toContain('New contest open\nThe Masters (PGA Tour), Thu, Apr 9, 2026');
    expect(message.text).toContain('Masters Pick 6 is open in Mathworks.');
    expect(message.text).toContain('Masters Pick 6 (Tiered)\nPick 1 golfer from each of 6 tiers. The best 4 scores count.\n1 entry per member');
    expect(message.text).toContain('Picks close: Thu, Apr 9, 2026');
    expect(message.text).not.toContain('Then:');
    expect(message.text).toContain('Enter contest: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1');
    expect(message.html).toContain(`src="${TIERED.imageUrl}"`);
    expect(message.html).toContain('Not affiliated with PGA Tour or any sports league.');
  });

  it('lists a multi-event contest\'s events after the first in the new contest email, and says when the first picks close', () => {
    const message = renderSystemEmailTemplate('CONTEST_OPENED', {
      userName: 'Morgan Member',
      leagueName: 'Mathworks',
      contestName: 'Majors Pool',
      event: MASTERS_EVENT,
      format: TIERED,
      events: [
        { name: 'The Masters', startsAt: new Date('2026-04-09T11:40:00.000Z') },
        { name: 'PGA Championship', startsAt: new Date('2026-05-14T11:40:00.000Z') },
      ],
      rules: 'Pick 1 golfer from each of 6 tiers. The best 4 scores count.',
      entriesPerMember: 'No limit on entries per member',
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      contestUrl: 'https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-3',
    }, UTC);

    expect(message.text).toContain('Then:\nPGA Championship, Thu, May 14, 2026');
    expect(message.text).toContain('First picks close: Thu, Apr 9, 2026');
  });

  it('renders the 3-hour entry reminder with the time picks close, in the reader\'s time zone, and a Make your picks button', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Masters Pick 6',
      event: MASTERS_EVENT,
      ...REMINDER_CARD,
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      hoursBefore: 3,
      standing: { kind: EntryReminderKind.NOT_ENTERED },
      contestUrl: 'https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-1',
    }, { timeZone: 'America/New_York' });

    expect(message.subject).toBe('Picks close soon: Masters Pick 6');
    expect(message.text).toContain('You haven\'t entered Masters Pick 6 for The Masters yet.');
    expect(message.text).toContain('Picks close in 3 hours: Apr 9, 2026, 7:40 AM EDT');
    expect(message.text).toContain('Masters Pick 6 (Tiered)\nPick 1 golfer from each of 6 tiers. The best 4 scores count.\n14 entries so far');
    expect(message.text).toContain('Make your picks: https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-1');
    expect(message.html).toContain('Make your picks');
  });

  it('writes the 3-hour reminder\'s closing time in the reader\'s locale and 24-hour clock', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Masters Pick 6',
      event: MASTERS_EVENT,
      ...REMINDER_CARD,
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      hoursBefore: 3,
      standing: { kind: EntryReminderKind.NOT_ENTERED },
      contestUrl: 'https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-1',
    }, { timeZone: 'Europe/London', locale: 'en-GB', hour12: false });

    expect(message.text).toContain('Picks close in 3 hours: 9 Apr 2026, 12:40 BST');
  });

  it('gives an entry reminder sent a day or more ahead the date picks close, without a time', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Masters Pick 6',
      event: MASTERS_EVENT,
      ...REMINDER_CARD,
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      hoursBefore: 24,
      standing: { kind: EntryReminderKind.NOT_ENTERED },
      contestUrl: 'https://app.primetimecommissioner.com/league/OFFICE24/contests/contest-1',
    }, { timeZone: 'America/New_York' });

    expect(message.text).toContain('Picks close in 1 day: Thu, Apr 9, 2026\n');
    expect(message.text).not.toContain('7:40 AM');
  });

  it('gives a moved event\'s old and new days, and their times when it moved within the same day', () => {
    const moved = EMAIL_TEMPLATE_FIXTURES.CONTEST_EVENT_CHANGED;
    const eastern = { timeZone: 'America/New_York' };
    const sameDay = {
      ...moved,
      change: {
        kind: ContestEventChangeKind.RESCHEDULED,
        previousStart: new Date('2027-04-08T12:00:00.000Z'),
        newStart: new Date('2027-04-08T15:30:00.000Z'),
        picksOpen: true,
      },
    };

    expect(renderSystemEmailTemplate('CONTEST_EVENT_CHANGED', moved, eastern).text)
      .toContain('The Masters has moved from Thu, Apr 8, 2027 to Thu, Apr 15, 2027.');
    expect(renderSystemEmailTemplate('CONTEST_EVENT_CHANGED', sameDay, eastern).text)
      .toContain('The Masters has moved from Apr 8, 2027, 8:00 AM EDT to Apr 8, 2027, 11:30 AM EDT.');
  });

  it('tells a reader with a draft entry that it won\'t count until submitted', () => {
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'NFL Pick\'em',
      event: { ...MASTERS_EVENT, sportLeagueName: 'NFL', eventName: 'Week 7' },
      ...REMINDER_CARD,
      closesAt: new Date('2026-10-22T00:15:00.000Z'),
      hoursBefore: 3,
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
      expect(message.text).toContain('Full leaderboard: http://localhost:5173/league/OFFICE24/contests/contest-1/leaderboard');
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
        top: [{ place: '1', entryName: 'Amen Corner', squadName: 'Casey & Co', score: '-20', movement: null, isYours: false, eventResult: { place: 'T2', score: '-9' } }],
        yours: [],
        entryCount: 1,
        cut: [],
      }, { timeZone: 'America/New_York' });

      expect(message.subject).toBe('After The Masters: Masters Pick 6');
      expect(message.text).toContain('The Masters results');
      expect(message.text).toContain('The Masters is done. Here\'s where Masters Pick 6 stands.');
      expect(message.text).toContain('1. Amen Corner (Casey & Co), -20, this event T2, -9');
      expect(message.text).toContain('Next event: PGA Championship, Thu, May 14, 2026');
      expect(message.text).toContain('Picks close: Thu, May 14, 2026');
    });

    it('reports a settled pick\'em week with its winners, its leaders by the week\'s points, the season by points, next week\'s first kickoff and a picks button', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        contestName: 'NFL Pick\'em',
        moment: {
          kind: StandingsMomentKind.PICK_EM_WEEK,
          eventName: 'Week 3',
          winners: [{ entryName: 'Upset City', squadName: 'Casey & Co' }, { entryName: 'Chalk', squadName: 'Pat' }],
          weekLeaders: [
            { place: 'T1', entryName: 'Upset City', squadName: 'Casey & Co', score: '13', movement: null, isYours: false },
            { place: 'T1', entryName: 'Chalk', squadName: 'Pat', score: '13', movement: null, isYours: false },
          ],
          weekEntryCount: 9,
          nextWeek: { name: 'Week 4', firstKickoffAt: new Date('2026-09-25T00:15:00.000Z') },
        },
        top: [{ place: '1', entryName: 'Chalk', squadName: 'Pat', score: '38', movement: 1, isYours: false }],
        yours: [],
        entryCount: 9,
        cut: [],
        picksUrl: 'http://localhost:5173/league/OFFICE24/contests/contest-1',
      }, { timeZone: 'America/New_York' });

      expect(message.subject).toBe('After Week 3: NFL Pick\'em');
      expect(message.text).toContain('Week 3 is done. Upset City (Casey & Co) and Chalk (Pat) tied for the week. Here\'s where NFL Pick\'em stands.');
      expect(message.text).toContain('Week 3, top 2 of 9:\nT1. Upset City (Casey & Co), 13\nT1. Chalk (Pat), 13');
      expect(message.text).toContain('Season top 1 of 9, by points:\n1. Chalk (Pat), 38, up 1');
      expect(message.text).toContain('Next week: Week 4, first kickoff Thu, Sep 24, 2026');
      expect(message.text).toContain('Make picks for next week: http://localhost:5173/league/OFFICE24/contests/contest-1');
      expect(message.html).toContain('Make picks for next week');
    });

    it('names a pick\'em week\'s single winner as having won it', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        moment: { kind: StandingsMomentKind.PICK_EM_WEEK, eventName: 'Week 3', winners: [{ entryName: 'Chalk', squadName: 'Pat' }], weekLeaders: [], weekEntryCount: 1 },
        cut: [],
      }, UTC);

      expect(message.text).toContain('Week 3 is done. Chalk (Pat) won the week.');
      expect(message.text).not.toContain('Make picks for next week');
    });

    it('reports a settled survivor week with how many are still in, which entries are out, and the reader\'s entries that went out and why', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        contestName: 'Last One Standing',
        moment: { kind: StandingsMomentKind.SURVIVOR_WEEK, eventName: 'Week 5', stillIn: 1, nextWeek: { name: 'Week 6', firstKickoffAt: new Date('2026-10-09T00:15:00.000Z') } },
        top: [
          { place: '1', entryName: 'Iron Man', squadName: 'Casey & Co', score: '5', movement: 0, isYours: false },
          { place: 'T2', entryName: 'Bears Believer', squadName: 'Morgan Member', score: '4', movement: null, isYours: true, isOut: true },
          { place: 'T2', entryName: 'Sleepy', squadName: 'Morgan Member', score: '4', movement: null, isYours: true, isOut: true },
        ],
        yours: [],
        entryCount: 3,
        cut: [],
        out: [
          { entryName: 'Bears Believer', team: 'Chicago Bears', roundNumber: null },
          { entryName: 'Sleepy', team: null, roundNumber: null },
        ],
      }, UTC);

      expect(message.subject).toBe('After Week 5: Last One Standing');
      expect(message.text).toContain('Week 5 is done. 1 of 3 entries is still in Last One Standing.');
      expect(message.text).toContain('Bears Believer is out: Chicago Bears didn\'t win in Week 5.');
      expect(message.text).toContain('Sleepy is out: it had no pick in Week 5.');
      expect(message.text).toContain('Standings, by weeks survived:\n1. Iron Man (Casey & Co), 5, no change\nT2. Bears Believer (Morgan Member), yours, 4, out');
      expect(message.text).toContain('Next week: Week 6, first kickoff');
      expect(message.text).not.toContain('Make picks for next week');
    });

    it('reports a finished bracket round with the leaders by points, the reader\'s champion picks and what each entry can still reach, and the next round\'s start', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        contestName: 'March Madness',
        moment: { kind: StandingsMomentKind.BRACKET_ROUND, eventName: 'NCAA Tournament', roundName: 'Sweet 16', nextRound: { name: 'Elite Eight', startsAt: new Date('2026-03-28T22:09:00.000Z') } },
        top: [{ place: '1', entryName: 'Chalk', squadName: 'Pat', score: '120', movement: 2, isYours: false }],
        yours: [],
        entryCount: 1,
        cut: [],
        champions: [
          { entryName: 'Blue Devils', team: 'Duke', alive: true, maxPossiblePoints: 280 },
          { entryName: 'Long Shot', team: 'Saint Peter\'s', alive: false, maxPossiblePoints: 90 },
        ],
      }, { timeZone: 'America/New_York' });

      expect(message.subject).toBe('After Sweet 16: March Madness');
      expect(message.text).toContain('Sweet 16 results');
      expect(message.text).toContain('Sweet 16 of NCAA Tournament is done. Here\'s where March Madness stands.');
      expect(message.text).toContain('Blue Devils: your champion, Duke, is still alive, with 280 points possible.');
      expect(message.text).toContain('Long Shot: your champion, Saint Peter\'s, is out, with 90 points possible.');
      expect(message.text).toContain('Standings, by points:\n1. Chalk (Pat), 120, up 2');
      expect(message.text).toContain('Next round: Elite Eight, Sat, Mar 28, 2026');
    });

    it('names the round a survivor entry went out in when the event is a playoff of several rounds', () => {
      const message = renderSystemEmailTemplate('CONTEST_STANDINGS', {
        ...standings,
        moment: { kind: StandingsMomentKind.SURVIVOR_WEEK, eventName: 'NFL Playoffs', stillIn: 4 },
        cut: [],
        out: [{ entryName: 'Bears Believer', team: 'Chicago Bears', roundNumber: 2 }],
      }, UTC);

      expect(message.text).toContain('Bears Believer is out: Chicago Bears didn\'t win in round 2 of NFL Playoffs.');
    });
  });

  describe('entry reminder wording by why it goes to the reader', () => {
    const base = {
      userName: 'Morgan Member',
      leagueName: 'Office League',
      contestName: 'Office Pool',
      event: MASTERS_EVENT,
      ...REMINDER_CARD,
      closesAt: new Date('2026-04-09T11:40:00.000Z'),
      hoursBefore: 3,
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
      expect(message.text).toContain('Entries close in 3 hours: Apr 9, 2026');
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
      expect(message.text).toContain('Game starts in 3 hours: Apr 9, 2026');
      expect(message.text).toContain(`Claim your boxes: ${base.contestUrl}`);
    });
  });

  it('ends an email with a "Stop these emails" link in both bodies when it is given one, and with none otherwise', () => {
    const data = {
      userName: 'Derek Dorazio',
      leagueName: 'Mathworks',
      contestName: 'Masters Pick 6',
      event: MASTERS_EVENT,
      format: TIERED,
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
      openContests: [{ name: '<Pool & Co>', url: 'https://app.primetimecommissioner.com/contests/c?x="bad"' }],
    }, UTC);

    expect(message.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(message.html).toContain('&lt;Pool &amp; Co&gt;</a>');
    expect(message.html).not.toContain('x="bad"');
    expect(message.html).toContain('&lt;League &amp; Co&gt;');
    expect(message.html).not.toContain('<script>alert');
    expect(message.html).not.toContain('href="https://app.primetimecommissioner.com/leagues/league-1?x=<bad>"');
  });
});

describe('the test email', () => {
  it('names the environment and the root admin who sent it, and says email from the site is working', () => {
    const message = renderSystemEmailTemplate('EMAIL_TEST', EMAIL_TEMPLATE_FIXTURES.EMAIL_TEST, UTC);

    expect(message.subject).toBe('Primetime Commissioner test email (qa)');
    expect(message.text).toContain('poolmaster-admin sent this test from the qa Email settings on');
    expect(message.text).toContain('It reached you, so email from this site is working.');
    expect(message.html).toContain('It reached you, so email from this site is working.');
  });
});

describe('the year in review', () => {
  it('lists the squad\'s championship place with its trophy, its contest medals and each cup it placed in, and links to its squad page for the year', () => {
    const message = renderSystemEmailTemplate('YEAR_IN_REVIEW', EMAIL_TEMPLATE_FIXTURES.YEAR_IN_REVIEW, UTC);

    expect(message.subject).toBe('Casey Crushers\' 2026 in Office League');
    expect(message.text).toContain('Here\'s how Casey Crushers did in Office League in 2026.');
    expect(message.text).toContain('2026 Office League Cup: 2nd of 12, 612.5 points · Runner-up');
    expect(message.text).toContain('1sts: 4\n2nds: 2\n3rds: 1\nContests played: 18');
    expect(message.text).toContain('2026 NFL Cup: 1st of 12, 240 points · Champion');
    expect(message.text).toContain('2026 PGA Tour Cup: T5 of 12, 180 points');
    expect(message.html).toContain('href="http://localhost:5173/league/OFFICE24/team?year=2026"');
  });

  it('says no championship contest counted for a squad that placed only in a cup, leaves out the Cups section for one in none, and gives a name not ending in s the usual possessive', () => {
    const cupOnly = renderSystemEmailTemplate('YEAR_IN_REVIEW', { ...EMAIL_TEMPLATE_FIXTURES.YEAR_IN_REVIEW, championship: null }, UTC);
    const noCups = renderSystemEmailTemplate('YEAR_IN_REVIEW', { ...EMAIL_TEMPLATE_FIXTURES.YEAR_IN_REVIEW, cups: [] }, UTC);

    expect(cupOnly.text).toContain('No championship contest counted for Casey Crushers in 2026.');
    expect(noCups.text).not.toContain('Cups:');
    expect(renderSystemEmailTemplate('YEAR_IN_REVIEW', { ...EMAIL_TEMPLATE_FIXTURES.YEAR_IN_REVIEW, squadName: 'Birdie Brigade' }, UTC).subject).toBe('Birdie Brigade\'s 2026 in Office League');
  });
});

describe('new member joined', () => {
  it('names who joined at once, as which squad, with the member count and a Members and owners button', () => {
    const message = renderSystemEmailTemplate('LEAGUE_MEMBER_JOINED', EMAIL_TEMPLATE_FIXTURES.LEAGUE_MEMBER_JOINED, UTC);

    expect(message.subject).toBe('Morgan Member joined Office League');
    expect(message.text).toContain("Morgan Member joined Office League as Morgan's Squad.");
    expect(message.text).toContain('The league has 9 members now.');
    expect(message.text).toContain('Members and owners: http://localhost:5173/league/OFFICE24/admin/teams');
    expect(message.html).toContain('href="http://localhost:5173/league/OFFICE24/admin/teams"');
  });

  it('lists a busy day\'s later joins the next day, each with their squad when they have one, and escapes their names', () => {
    const message = renderSystemEmailTemplate('LEAGUE_MEMBER_JOINED', {
      ...EMAIL_TEMPLATE_FIXTURES.LEAGUE_MEMBER_JOINED,
      timing: MemberJoinedTiming.NEXT_DAY,
      joined: [{ name: 'Dee <b>Bold</b>', squadName: 'Dee Squad' }, { name: 'Eve Early', squadName: null }],
    }, UTC);

    expect(message.subject).toBe('2 more joined Office League');
    expect(message.text).toContain('After the first three, 2 more people joined Office League yesterday:\nDee <b>Bold</b> (Dee Squad)\nEve Early');
    expect(message.html).toContain('Dee &lt;b&gt;Bold&lt;/b&gt; (Dee Squad)<br>Eve Early');
    expect(message.html).not.toContain('<b>Bold</b>');
  });

  it('says "one more person" when a busy day had just one join after the third, and leaves the squad out of a member without one', () => {
    const nextDay = renderSystemEmailTemplate('LEAGUE_MEMBER_JOINED', {
      ...EMAIL_TEMPLATE_FIXTURES.LEAGUE_MEMBER_JOINED,
      timing: MemberJoinedTiming.NEXT_DAY,
    }, UTC);
    const noSquad = renderSystemEmailTemplate('LEAGUE_MEMBER_JOINED', {
      ...EMAIL_TEMPLATE_FIXTURES.LEAGUE_MEMBER_JOINED,
      joined: [{ name: 'Morgan Member', squadName: null }],
      memberCount: 1,
    }, UTC);

    expect(nextDay.text).toContain('After the first three, one more person joined Office League yesterday:');
    expect(noSquad.text).toContain('Morgan Member joined Office League.');
    expect(noSquad.text).toContain('The league has 1 member now.');
  });
});

describe('contest expanded', () => {
  it('says who expanded which contest to how many entries, that it is in the payment history, with a Manage contest button', () => {
    const message = renderSystemEmailTemplate('CONTEST_EXPANDED', EMAIL_TEMPLATE_FIXTURES.CONTEST_EXPANDED, UTC);

    expect(message.subject).toBe('Masters Pool now takes 50 entries');
    expect(message.text).toContain("Masters Pool was expanded to 50 entries by Sam Commissioner. It's in Office League's payment history.");
    expect(message.text).toContain('Manage contest: http://localhost:5173/league/OFFICE24/admin/contests/contest-1');
    expect(message.html).toContain('href="http://localhost:5173/league/OFFICE24/admin/contests/contest-1"');
  });

  it('names Primetime Commissioner for a grant, and escapes the contest\'s name', () => {
    const message = renderSystemEmailTemplate('CONTEST_EXPANDED', {
      ...EMAIL_TEMPLATE_FIXTURES.CONTEST_EXPANDED,
      contestName: 'Pool <b>One</b>',
      entriesPerContest: 500,
      expandedBy: null,
    }, UTC);

    expect(message.text).toContain('Pool <b>One</b> was expanded to 500 entries by Primetime Commissioner.');
    expect(message.html).toContain('Pool &lt;b&gt;One&lt;/b&gt; was expanded to 500 entries by Primetime Commissioner.');
    expect(message.html).not.toContain('<b>One</b>');
  });
});

describe('Premium preview period ending', () => {
  it('frames the end as the close of a gifted preview period, with the end time in the reader\'s zone, what Free allows, and a See your plan button', () => {
    const message = renderSystemEmailTemplate('LEAGUE_PLAN_PREVIEW_ENDING', EMAIL_TEMPLATE_FIXTURES.LEAGUE_PLAN_PREVIEW_ENDING, { timeZone: 'America/New_York' });

    expect(message.subject).toBe('Office League\'s Premium preview period ends in 7 days');
    expect(message.text).toContain('Office League was gifted Premium for its preview period. The preview period ends in 7 days, on Sat, Apr 24, 2027.');
    expect(message.text).toContain('After that, Office League moves to the Free plan: up to 20 entries per contest and 5 sports leagues a year.');
    expect(message.text).toContain('Nothing is deleted: contests keep the entries they have, and Premium features are hidden, not removed.');
    expect(message.text).toContain('See your plan: http://localhost:5173/league/OFFICE24/admin/plan');
    expect(message.html).toContain('href="http://localhost:5173/league/OFFICE24/admin/plan"');
    expect(`${message.subject} ${message.text}`.toLowerCase()).not.toContain('expire');
  });

  it('says the last reminder ends tomorrow, and leaves out a Free limit set to unlimited', () => {
    const message = renderSystemEmailTemplate('LEAGUE_PLAN_PREVIEW_ENDING', {
      ...EMAIL_TEMPLATE_FIXTURES.LEAGUE_PLAN_PREVIEW_ENDING,
      daysLeft: 1,
      freeSportsLeaguesPerYear: null,
    }, UTC);

    expect(message.subject).toBe('Office League\'s Premium preview period ends tomorrow');
    expect(message.text).toContain('The preview period ends tomorrow, on Sat, Apr 24, 2027.');
    expect(message.text).toContain('After that, Office League moves to the Free plan: up to 20 entries per contest.');
  });

  it('escapes the league\'s name in the HTML', () => {
    const message = renderSystemEmailTemplate('LEAGUE_PLAN_PREVIEW_ENDING', {
      ...EMAIL_TEMPLATE_FIXTURES.LEAGUE_PLAN_PREVIEW_ENDING,
      leagueName: 'Pool <i>One</i>',
    }, UTC);

    expect(message.html).toContain('Pool &lt;i&gt;One&lt;/i&gt; was gifted Premium');
    expect(message.html).not.toContain('<i>One</i>');
  });
});

describe('the email template registry', () => {
  it('gives every template key a category, with invitations, welcomes, the password reset and password changed emails, the contest expanded email and the root admin\'s test email ones a member can\'t turn off', () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual(Object.values(EmailTemplateKey).sort());
    expect(Object.fromEntries(Object.entries(EMAIL_TEMPLATES).map(([key, template]) => [key, template.category]))).toEqual({
      LEAGUE_MEMBER_INVITE: EmailCategory.MEMBERSHIP,
      LEAGUE_JOIN_SUCCESS: EmailCategory.MEMBERSHIP,
      CONTEST_ENTRY_COMPLETED: EmailCategory.RECEIPTS,
      CONTEST_STARTED_SUMMARY: EmailCategory.LIVE_STANDINGS,
      CONTEST_ENTRY_REMINDER: EmailCategory.CONTEST_UPDATES,
      CONTEST_OPENED: EmailCategory.CONTEST_UPDATES,
      CONTEST_STANDINGS: EmailCategory.LIVE_STANDINGS,
      CONTEST_RESULTS: EmailCategory.RESULTS,
      CONTEST_EVENT_CHANGED: EmailCategory.CONTEST_UPDATES,
      EVENT_COMING_UP: EmailCategory.COMMISSIONER_UPDATES,
      EVENT_READY_FOR_CONTESTS: EmailCategory.COMMISSIONER_UPDATES,
      EVENT_WEEKLY_DIGEST: EmailCategory.COMMISSIONER_UPDATES,
      CONTEST_NOT_OPEN: EmailCategory.COMMISSIONER_UPDATES,
      EVENT_STILL_DRAFT: EmailCategory.ROOT_ADMIN,
      SQUAD_OWNER_INVITE: EmailCategory.MEMBERSHIP,
      SQUAD_OWNER_ADDED: EmailCategory.MEMBERSHIP,
      PASSWORD_RESET: EmailCategory.ACCOUNT,
      PASSWORD_CHANGED: EmailCategory.ACCOUNT,
      EMAIL_CHANGED: EmailCategory.ACCOUNT,
      EMAIL_TEST: EmailCategory.ROOT_ADMIN,
      YEAR_IN_REVIEW: EmailCategory.RESULTS,
      LEAGUE_MEMBER_JOINED: EmailCategory.COMMISSIONER_UPDATES,
      CONTEST_EXPANDED: EmailCategory.ACCOUNT,
      LEAGUE_PLAN_PREVIEW_ENDING: EmailCategory.ACCOUNT,
    });
  });

  it('gives every optional email its own plan feature and leaves account, membership and root admin email to every league, so a plan can stop only the optional ones', () => {
    expect(Object.fromEntries(Object.entries(EMAIL_TEMPLATES).map(([key, template]) => [key, template.planFeature]))).toEqual({
      LEAGUE_MEMBER_INVITE: null,
      LEAGUE_JOIN_SUCCESS: null,
      CONTEST_ENTRY_COMPLETED: PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED,
      CONTEST_STARTED_SUMMARY: PlanFeature.EMAIL_CONTEST_STARTED_SUMMARY,
      CONTEST_ENTRY_REMINDER: PlanFeature.EMAIL_CONTEST_ENTRY_REMINDER,
      CONTEST_OPENED: PlanFeature.EMAIL_CONTEST_OPENED,
      CONTEST_STANDINGS: PlanFeature.EMAIL_CONTEST_STANDINGS,
      CONTEST_RESULTS: PlanFeature.EMAIL_CONTEST_RESULTS,
      CONTEST_EVENT_CHANGED: PlanFeature.EMAIL_CONTEST_EVENT_CHANGED,
      EVENT_COMING_UP: PlanFeature.EMAIL_EVENT_COMING_UP,
      EVENT_READY_FOR_CONTESTS: PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS,
      EVENT_WEEKLY_DIGEST: PlanFeature.EMAIL_EVENT_COMING_UP,
      CONTEST_NOT_OPEN: PlanFeature.EMAIL_CONTEST_NOT_OPEN,
      EVENT_STILL_DRAFT: null,
      SQUAD_OWNER_INVITE: null,
      SQUAD_OWNER_ADDED: null,
      PASSWORD_RESET: null,
      PASSWORD_CHANGED: null,
      EMAIL_CHANGED: null,
      EMAIL_TEST: null,
      YEAR_IN_REVIEW: PlanFeature.EMAIL_YEAR_IN_REVIEW,
      LEAGUE_MEMBER_JOINED: PlanFeature.EMAIL_LEAGUE_MEMBER_JOINED,
      CONTEST_EXPANDED: null,
      LEAGUE_PLAN_PREVIEW_ENDING: null,
    });
  });

  it('sends every email plan feature from one template, the weekly digest sharing "Coming up soon"\'s, so no email feature on the Plans page switches nothing', () => {
    const emailFeatures = Object.values(PlanFeature).filter((feature) => PLAN_FEATURE_GROUP[feature] === PlanFeatureGroup.EMAILS);
    const sentBy = Object.entries(EMAIL_TEMPLATES)
      .filter(([key]) => key !== 'EVENT_WEEKLY_DIGEST')
      .map(([, template]) => template.planFeature)
      .filter((feature) => feature !== null);

    expect([...sentBy].sort()).toEqual([...emailFeatures].sort());
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
      expect(message.text).toContain('Primetime Commissioner');
      expect(message.text).toContain('Replies to this email aren\'t read.');
      expect(message.html).toMatch(/^<!doctype html>/);
      expect(message.html).toContain('Replies to this email aren&#39;t read.');
    }
  });
});

describe('the event emails\' header and contest type tiles', () => {
  const data = EMAIL_TEMPLATE_FIXTURES.EVENT_READY_FOR_CONTESTS;

  it("puts the sport's picture above a band naming the sport league, the email, the event and its day, so the event reads with images blocked", () => {
    const message = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', data, UTC);

    expect(message.html).toContain(`<img src="${data.event.imageUrl}" alt=""`);
    expect(message.html).toContain('PGA Tour · Ready for contests');
    expect(message.html).toContain('>The Masters</');
    expect(message.html).toContain('Thu, Apr 8, 2027');
    expect(message.text).toContain('Ready for contests\nThe Masters (PGA Tour), Thu, Apr 8, 2027');
    expect(message.html).toContain('Office League</td>');
  });

  it('draws each setup as one linked tile with its way to play above the rest of its name, starting with a capital', () => {
    const message = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', data, UTC);
    const survivor = data.setups[1];

    expect(message.html).toContain(`src="${survivor.imageUrl}"`);
    expect(message.html).toContain('>Pick a golfer to make the cut<');
    expect(message.html).not.toContain('>Survivor: pick a golfer');
    expect(message.html).toContain(`href="${survivor.url.replace(/&/g, '&amp;')}"`);
    expect(message.text).toContain(`Survivor: pick a golfer to make the cut: ${survivor.url}`);
  });

  it("labels C2's tiles \"Set up\" and C1's \"How it works\", since C1's open the contest types page rather than Create contest", () => {
    const ready = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', data, UTC);
    const comingUp = renderSystemEmailTemplate('EVENT_COMING_UP', EMAIL_TEMPLATE_FIXTURES.EVENT_COMING_UP, UTC);

    expect(ready.html).toContain('Set up &rarr;');
    expect(ready.html).not.toContain('How it works');
    expect(comingUp.html).toContain('How it works &rarr;');
    expect(comingUp.html).not.toContain('Set up &rarr;');
  });

  it('names the event once in the Ready for contests intro', () => {
    const message = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', data, UTC);

    expect(message.text).toContain("The Masters is ready. Pick a way to play and set up Office League's contest with it already chosen.");
  });

  it('leaves out an event without a sport league name from the eyebrow, the heading line and the footer instead of showing an empty name', () => {
    const message = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', { ...data, event: { ...data.event, sportLeagueName: '' } }, UTC);

    expect(message.html).toContain('>Ready for contests<');
    expect(message.html).not.toContain(' · Ready for contests');
    expect(message.text).toContain('Ready for contests\nThe Masters, Thu, Apr 8, 2027');
    expect(message.text).toContain('Not affiliated with any sports league.');
    expect(message.text).not.toContain('with  or');
  });

  it("points C2's button at the event page when there is one, and at the contest types page without one", () => {
    const withPage = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', data, UTC);
    const withoutPage = renderSystemEmailTemplate('EVENT_READY_FOR_CONTESTS', { ...data, eventPageUrl: null }, UTC);

    expect(withPage.html).toContain(`href="${data.eventPageUrl}"`);
    expect(withoutPage.html).toContain(`href="${data.contestTypesUrl}"`);
    expect(withoutPage.text).toContain(`See every way to play: ${data.contestTypesUrl}`);
  });

  it("links a digest event's name to its event page when it has one, and leaves it plain otherwise", () => {
    const digest = EMAIL_TEMPLATE_FIXTURES.EVENT_WEEKLY_DIGEST;
    const message = renderSystemEmailTemplate('EVENT_WEEKLY_DIGEST', digest, UTC);

    expect(message.html).toContain(`<a href="${digest.thisWeek[0].eventPageUrl}"`);
    expect(message.html.match(/\/play\//g)).toHaveLength(1);
  });

  it('names every sport league the email mentions in the footer, saying we are affiliated with none of them', () => {
    const message = renderSystemEmailTemplate('EVENT_WEEKLY_DIGEST', EMAIL_TEMPLATE_FIXTURES.EVENT_WEEKLY_DIGEST, UTC);

    expect(message.text).toContain('Not affiliated with PGA Tour, Triple Crown or any sports league.');
    expect(message.html).toContain('Not affiliated with PGA Tour, Triple Crown or any sports league.');
  });
});

describe('the member contest emails\' header, contest card and places', () => {
  const standings = EMAIL_TEMPLATE_FIXTURES.CONTEST_STANDINGS;
  const results = EMAIL_TEMPLATE_FIXTURES.CONTEST_RESULTS;

  it('opens the standings with the event as a strip naming the contest and its entries, then the reader\'s best place and how it moved', () => {
    const message = renderSystemEmailTemplate('CONTEST_STANDINGS', standings, UTC);

    expect(message.text).toContain('Round 2 standings\nThe Masters (PGA Tour), Masters Pick 6 · 18 entries');
    expect(message.text).toContain('Your place: T2, Green Jackets, -9. Same place as the last update.');
    expect(message.html).toContain(`src="${standings.event.imageUrl}"`);
    expect(message.html).toContain('>T2</td>');
  });

  it('marks the reader\'s rows "YOU" on a gold tint and leaves everyone else\'s plain', () => {
    const message = renderSystemEmailTemplate('CONTEST_STANDINGS', standings, UTC);

    expect(message.html.match(/>YOU</g)).toHaveLength(2);
    expect(message.html).not.toContain('(yours)');
  });

  it('gives a reader whose only placed entry moved up the places it climbed, and no callout to a reader with no entry', () => {
    const climbed = renderSystemEmailTemplate('CONTEST_STANDINGS', {
      ...standings,
      top: standings.top.map((line) => ({ ...line, isYours: line.entryName === 'Amen Corner' })),
      yours: [],
    }, UTC);
    const watching = renderSystemEmailTemplate('CONTEST_STANDINGS', {
      ...standings,
      top: standings.top.map((line) => ({ ...line, isYours: false })),
      yours: [],
    }, UTC);

    expect(climbed.text).toContain('Your place: 1st, Amen Corner, -12. Up 2 places since the last update.');
    expect(watching.text).not.toContain('Your place');
  });

  it('heads the final results with a trophy and the winner, then gives the reader their final place', () => {
    const message = renderSystemEmailTemplate('CONTEST_RESULTS', results, UTC);

    expect(message.text).toContain('Final results\nGreen Jackets wins');
    expect(message.text).toContain('Your place: 1st, Green Jackets, -14. Your final place.');
    expect(message.html).toContain('Masters Pick 6 · Final results');
    expect(message.html).toContain('Morgan Member · -14');
  });

  it('heads tied final results with every winner', () => {
    const outcome = results.outcome.kind === ContestResultsKind.SCORED ? results.outcome : undefined;
    if (!outcome) throw new Error('the fixture is scored');
    const message = renderSystemEmailTemplate('CONTEST_RESULTS', {
      ...results,
      outcome: { ...outcome, winners: [...outcome.winners, { entryName: 'Amen Corner', squadName: 'Casey & Co' }] },
    }, UTC);

    expect(message.text).toContain('Green Jackets and Amen Corner tie for first');
  });

  it('shows the new start under a moved event, and no date under a postponed one', () => {
    const moved = renderSystemEmailTemplate('CONTEST_EVENT_CHANGED', EMAIL_TEMPLATE_FIXTURES.CONTEST_EVENT_CHANGED, UTC);
    const postponed = renderSystemEmailTemplate('CONTEST_EVENT_CHANGED', {
      ...EMAIL_TEMPLATE_FIXTURES.CONTEST_EVENT_CHANGED,
      change: { kind: ContestEventChangeKind.POSTPONED, picksOpen: true },
    }, UTC);

    expect(moved.text).toContain('Event moved\nThe Masters (PGA Tour), Thu, Apr 15, 2027\n');
    expect(postponed.text).toContain('Event postponed\nThe Masters (PGA Tour)\n');
  });

  it('counts down to a reminder\'s close in hours under a day and in days beyond, and shows the contest card with the entries so far', () => {
    const reminder = EMAIL_TEMPLATE_FIXTURES.CONTEST_ENTRY_REMINDER;
    const soon = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', reminder, UTC);
    const twoDays = renderSystemEmailTemplate('CONTEST_ENTRY_REMINDER', { ...reminder, hoursBefore: 48, entryCount: 1 }, UTC);

    expect(soon.html).toContain('>3 hours</div>');
    expect(soon.text).toContain('14 entries so far');
    expect(twoDays.html).toContain('>2 days</div>');
    expect(twoDays.text).toContain('1 entry so far');
    expect(soon.html).toContain(`src="${reminder.format.imageUrl}"`);
  });

  it('puts the event the picks are for across the top of an entry receipt', () => {
    const receipt = EMAIL_TEMPLATE_FIXTURES.CONTEST_ENTRY_COMPLETED;
    const message = renderSystemEmailTemplate('CONTEST_ENTRY_COMPLETED', receipt, UTC);

    expect(message.text).toContain('Entry completed\nThe Masters (PGA Tour), Thu, Apr 9, 2026');
    expect(message.html).toContain(`src="${receipt.event.imageUrl}"`);
    expect(message.text).toContain('Not affiliated with PGA Tour or any sports league.');
  });
});
