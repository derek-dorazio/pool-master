import type {
  SystemEmailTemplateDataByKey,
  SystemEmailTemplateKey,
} from '../../packages/core-api/src/modules/email';

/**
 * One filled-in example of every system email, for `npm run email:preview` and the template
 * tests. A template key without an example here doesn't compile.
 */
export const EMAIL_TEMPLATE_FIXTURES: { [Key in SystemEmailTemplateKey]: SystemEmailTemplateDataByKey[Key] } = {
  LEAGUE_MEMBER_INVITE: {
    recipientEmail: 'morgan@example.com',
    inviterName: 'Casey Commissioner',
    leagueName: 'Office League',
    leagueCode: 'OFFICE24',
    inviteUrl: 'http://localhost:5173/invite/abc123def456',
    message: 'Join us for the Masters pool this year.',
    expiresAt: '2026-04-04T18:30:00.000Z',
  },
  LEAGUE_JOIN_SUCCESS: {
    userName: 'Morgan Member',
    leagueName: 'Office League',
    leagueCode: 'OFFICE24',
    leagueHomeUrl: 'http://localhost:5173/league/OFFICE24',
    teamName: 'Morgan\'s Squad',
  },
  CONTEST_ENTRY_COMPLETED: {
    userName: 'Morgan Member',
    leagueName: 'Office League',
    contestName: 'Masters Pick 6',
    teamName: 'Morgan\'s Squad',
    entryName: 'Entry 1',
    entryUrl: 'http://localhost:5173/league/OFFICE24/contests/contest-1/entries/entry-1',
    submittedAt: '2026-04-08T15:30:00.000Z',
    tiebreaker: '-12',
    tiers: [
      { tierName: 'Tier A', participantNames: ['Rory McIlroy', 'Ludvig Aberg'] },
      { tierName: 'Tier B', participantNames: ['Tommy Fleetwood', 'Robert MacIntyre'] },
      { tierName: 'Tier C', participantNames: ['Min Woo Lee', 'Sepp Straka'] },
    ],
  },
  CONTEST_STARTED_SUMMARY: {
    userName: 'Morgan Member',
    leagueName: 'Office League',
    contestName: 'Masters Pick 6',
    eventName: 'The Masters',
    contestUrl: 'http://localhost:5173/league/OFFICE24/contests/contest-1',
    startedAt: '2026-04-09T12:00:00.000Z',
    entryCount: 2,
    entries: [
      { entryName: 'Entry 1', teamName: 'Morgan\'s Squad' },
      { entryName: 'Entry 2', teamName: 'Casey\'s Crew' },
    ],
  },
  CONTEST_ENTRY_REMINDER: {
    userName: 'Morgan Member',
    leagueName: 'Office League',
    contestName: 'Masters Pick 6',
    eventName: 'The Masters',
    closesAt: new Date('2026-04-09T11:40:00.000Z'),
    hasDraft: true,
    contestUrl: 'http://localhost:5173/league/OFFICE24/contests/contest-1',
  },
  PASSWORD_RESET: {
    firstName: 'Morgan',
    username: 'morgan',
    resetUrl: 'https://app.example.com/reset-password#token=example-token',
    expiresInMinutes: 10,
  },
  PASSWORD_CHANGED: {
    firstName: 'Morgan',
    username: 'morgan',
    changedAt: new Date('2026-10-22T14:05:00.000Z'),
    forgotPasswordUrl: 'https://app.example.com/forgot-password',
  },
};
