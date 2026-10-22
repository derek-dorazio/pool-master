import type { EmailTemplateKey, SwitchableEmailTemplateKey } from '@poolmaster/shared/domain';
import { PASSWORD_RESET_LINK_MINUTES } from '@poolmaster/shared/dto';
import { EmailCategory, NotificationClass } from '@poolmaster/shared/domain';

export type SystemEmailTemplateKey = EmailTemplateKey;

export interface SystemEmailMessage {
  templateKey: SystemEmailTemplateKey;
  subject: string;
  text: string;
  html: string;
}

export interface LeagueMemberInviteEmailData {
  recipientEmail: string;
  inviterName: string;
  leagueName: string;
  leagueCode: string;
  inviteUrl: string;
  message?: string;
  expiresAt?: Date | string;
}

export interface LeagueJoinSuccessEmailData {
  userName: string;
  leagueName: string;
  leagueCode: string;
  leagueHomeUrl: string;
  teamName?: string;
}

export interface ContestEntryCompletedTierSelection {
  tierName: string;
  participantNames: string[];
}

export interface ContestEntryCompletedEmailData {
  userName: string;
  leagueName: string;
  contestName: string;
  teamName: string;
  entryName: string;
  entryUrl: string;
  submittedAt?: Date | string;
  /** When the event's picks close; until then the entry's owners can still change it. */
  changeUntil: Date;
  tiebreaker?: string;
  tiers: ContestEntryCompletedTierSelection[];
}

/** One event as a contest email lists it. */
export interface ContestEmailEvent {
  name: string;
  startsAt: Date;
  venue?: string;
}

export interface ContestStartedSummaryEmailData {
  userName: string;
  leagueName: string;
  contestName: string;
  event: ContestEmailEvent;
  /** How the event plays, such as "4 rounds" or "16 games", when known. */
  eventFormat?: string;
  /** The contest's rules in a sentence, as its page states them. */
  rules: string;
  entryCount: number;
  /** Whether the reader has an entry in the contest; a reader without one is told they can still follow it. */
  hasEntry: boolean;
  leaderboardUrl: string;
}

export interface ContestOpenedEmailData {
  userName: string;
  leagueName: string;
  contestName: string;
  /** The contest's events in sequence order: one for most contests, several for a season. */
  events: ContestEmailEvent[];
  /** The contest's rules in a sentence, as its page states them. */
  rules: string;
  /** "1 entry per member". */
  entriesPerMember: string;
  /** When the first event's picks close. */
  closesAt: Date;
  contestUrl: string;
}

/** Why a reminder goes to its reader (#845, catalog row D2), which decides what it asks of them. */
export const EntryReminderKind = {
  /** No entry for the event yet, in a contest whose members pick. */
  NOT_ENTERED: 'NOT_ENTERED',
  /** An entry saved for the event but not submitted. */
  DRAFT: 'DRAFT',
  /** Not in a random draw yet: the draw deals the picks, so joining is all there is to do. */
  NOT_JOINED: 'NOT_JOINED',
  /** No box claimed on a squares grid yet. */
  NO_BOX: 'NO_BOX',
} as const;
export type EntryReminderKind = (typeof EntryReminderKind)[keyof typeof EntryReminderKind];

/** How far along a draft is: "4 of 6 picked". */
export interface DraftProgress {
  made: number;
  of: number;
}

export type EntryReminderStanding =
  | { kind: typeof EntryReminderKind.NOT_ENTERED }
  /** `progress` is shown for a reader with one draft, in a format that counts picks. */
  | { kind: typeof EntryReminderKind.DRAFT; drafts: number; progress?: DraftProgress }
  | { kind: typeof EntryReminderKind.NOT_JOINED }
  | { kind: typeof EntryReminderKind.NO_BOX };

export interface ContestEntryReminderEmailData {
  userName: string;
  leagueName: string;
  contestName: string;
  eventName: string;
  /** When the event's picks, the draw's entries or the grid's boxes close. */
  closesAt: Date;
  standing: EntryReminderStanding;
  contestUrl: string;
}

export interface PasswordResetEmailData {
  firstName: string;
  username: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface PasswordChangedEmailData {
  firstName: string;
  username: string;
  changedAt: Date;
  forgotPasswordUrl: string;
}

export interface SystemEmailTemplateDataByKey {
  LEAGUE_MEMBER_INVITE: LeagueMemberInviteEmailData;
  LEAGUE_JOIN_SUCCESS: LeagueJoinSuccessEmailData;
  CONTEST_ENTRY_COMPLETED: ContestEntryCompletedEmailData;
  CONTEST_STARTED_SUMMARY: ContestStartedSummaryEmailData;
  CONTEST_ENTRY_REMINDER: ContestEntryReminderEmailData;
  CONTEST_OPENED: ContestOpenedEmailData;
  PASSWORD_RESET: PasswordResetEmailData;
  PASSWORD_CHANGED: PasswordChangedEmailData;
}

/** What a renderer knows about the person it renders for, beyond the template's own data. */
export interface EmailRenderContext {
  /** IANA time zone dates are shown in: the recipient's, or UTC when they have none. */
  timeZone: string;
  /**
   * The recipient's "Stop these emails" page for this email's category (#844 slice 5), on an
   * email a member can turn off; absent on the rest.
   */
  unsubscribeUrl?: string;
}

type TemplateRenderer<Key extends SystemEmailTemplateKey> = (
  data: SystemEmailTemplateDataByKey[Key],
  context: EmailRenderContext,
) => SystemEmailMessage;

export interface EmailTemplateDefinition<Key extends SystemEmailTemplateKey> {
  /** Decides whether a member can turn the email off, and which unsubscribe link it carries. */
  category: EmailCategory;
  /** The service level the email belongs to, for monetization to gate on later (#845). */
  notificationClass: NotificationClass;
  /**
   * Whether EMAIL_CONFIG has a switch for this email, under its key. An email without one (an
   * account email such as a password reset) follows only the overall switch.
   */
  settingsSwitch: boolean;
  /**
   * Whether the outbox keeps the email's subject and bodies once it is sent (for 30 days). False
   * for an email that carries a secret, such as a password reset link: the outbox clears it the
   * moment the email is sent or given up on.
   */
  keepsContent: boolean;
  /**
   * How long after it is queued the email may still go out, or null for no limit. Past it the
   * outbox gives up instead of sending or retrying: a password reset is useless once its link
   * has expired. An email with a limit is also claimed ahead of the rest.
   */
  sendWithinMs: number | null;
  render: TemplateRenderer<Key>;
}

/**
 * Whom each email is about. A LEAGUE email comes from that league's address and must be sent
 * with the league; a PLATFORM email (account and root admin email) comes from the app. A type,
 * not a registry field: EmailService.send requires `league` exactly for the LEAGUE ones, and a
 * key missing here doesn't compile.
 */
export const EmailTemplateScope = {
  LEAGUE: 'LEAGUE',
  PLATFORM: 'PLATFORM',
} as const;
export type EmailTemplateScope = (typeof EmailTemplateScope)[keyof typeof EmailTemplateScope];

export interface EmailTemplateScopeByKey {
  LEAGUE_MEMBER_INVITE: typeof EmailTemplateScope.LEAGUE;
  LEAGUE_JOIN_SUCCESS: typeof EmailTemplateScope.LEAGUE;
  CONTEST_ENTRY_COMPLETED: typeof EmailTemplateScope.LEAGUE;
  CONTEST_STARTED_SUMMARY: typeof EmailTemplateScope.LEAGUE;
  CONTEST_ENTRY_REMINDER: typeof EmailTemplateScope.LEAGUE;
  CONTEST_OPENED: typeof EmailTemplateScope.LEAGUE;
  PASSWORD_RESET: typeof EmailTemplateScope.PLATFORM;
  PASSWORD_CHANGED: typeof EmailTemplateScope.PLATFORM;
}

type EmailTemplateRegistry = {
  [Key in SystemEmailTemplateKey]: EmailTemplateDefinition<Key>;
};

const BRAND_NAME = 'Prime Time Commissioner';
const BRAND_TAGLINE = 'Ultimate Office Pool Manager';
/** System email has no Reply-To (#844), so a reply bounces; the footer says so. */
const NOT_MONITORED = 'Replies to this email aren\'t read.';
const STOP_THESE_EMAILS = 'Stop these emails';

const EMAIL_THEME = {
  canvas: '#f5f5f2',
  raised: '#ffffff',
  navy: '#0b1e3f',
  navyDeep: '#05122a',
  gold: '#f5b800',
  goldHover: '#ffc82e',
  red: '#a8202d',
  ink: '#0b0b0b',
  muted: '#6b6b64',
  border: 'rgba(11, 30, 63, 0.18)',
  subtleBorder: 'rgba(11, 30, 63, 0.10)',
} as const;

/** Whether EMAIL_CONFIG has a switch for `templateKey`, as the registry says. */
export function hasSettingsSwitch(templateKey: SystemEmailTemplateKey): templateKey is SwitchableEmailTemplateKey {
  return EMAIL_TEMPLATES[templateKey].settingsSwitch;
}

/** The app's sender name, for email that is not about one league. */
export const PLATFORM_SENDER_NAME = BRAND_NAME;

export function renderSystemEmailTemplate<Key extends SystemEmailTemplateKey>(
  templateKey: Key,
  data: SystemEmailTemplateDataByKey[Key],
  context: EmailRenderContext,
): SystemEmailMessage {
  const renderer = EMAIL_TEMPLATES[templateKey].render;
  return renderer(data, context);
}

/**
 * Every system email: its category and its renderer. Adding a key to
 * EmailTemplateKey without an entry here is a compile error.
 */
export const EMAIL_TEMPLATES: EmailTemplateRegistry = {
  LEAGUE_MEMBER_INVITE: {
    category: EmailCategory.MEMBERSHIP,
    notificationClass: NotificationClass.ESSENTIAL,
    settingsSwitch: true,
    keepsContent: true,
    sendWithinMs: null,
    render: renderLeagueMemberInviteEmail,
  },
  LEAGUE_JOIN_SUCCESS: {
    category: EmailCategory.MEMBERSHIP,
    notificationClass: NotificationClass.ESSENTIAL,
    settingsSwitch: true,
    keepsContent: true,
    sendWithinMs: null,
    render: renderLeagueJoinSuccessEmail,
  },
  CONTEST_ENTRY_COMPLETED: {
    category: EmailCategory.RECEIPTS,
    notificationClass: NotificationClass.A,
    settingsSwitch: true,
    keepsContent: true,
    sendWithinMs: null,
    render: renderContestEntryCompletedEmail,
  },
  CONTEST_STARTED_SUMMARY: {
    category: EmailCategory.LIVE_STANDINGS,
    notificationClass: NotificationClass.B,
    settingsSwitch: true,
    keepsContent: true,
    sendWithinMs: null,
    render: renderContestStartedSummaryEmail,
  },
  CONTEST_ENTRY_REMINDER: {
    category: EmailCategory.CONTEST_UPDATES,
    notificationClass: NotificationClass.B,
    settingsSwitch: true,
    keepsContent: true,
    sendWithinMs: null,
    render: renderContestEntryReminderEmail,
  },
  CONTEST_OPENED: {
    category: EmailCategory.CONTEST_UPDATES,
    notificationClass: NotificationClass.A,
    settingsSwitch: true,
    keepsContent: true,
    sendWithinMs: null,
    render: renderContestOpenedEmail,
  },
  PASSWORD_RESET: {
    category: EmailCategory.ACCOUNT,
    notificationClass: NotificationClass.ESSENTIAL,
    settingsSwitch: false,
    keepsContent: false,
    // A reset email is never sent after its link is dead.
    sendWithinMs: PASSWORD_RESET_LINK_MINUTES * 60_000,
    render: renderPasswordResetEmail,
  },
  PASSWORD_CHANGED: {
    category: EmailCategory.ACCOUNT,
    notificationClass: NotificationClass.ESSENTIAL,
    settingsSwitch: false,
    keepsContent: true,
    sendWithinMs: null,
    render: renderPasswordChangedEmail,
  },
};

function renderLeagueMemberInviteEmail(
  data: LeagueMemberInviteEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const expiresLine = formatDateTime(data.expiresAt, context.timeZone);
  const subject = `${data.inviterName} invited you to ${data.leagueName}`;
  const bodyBlocks = [
    paragraph(`${escapeHtml(data.inviterName)} invited you to join ${strong(data.leagueName)}.`),
    ...(data.message?.trim()
      ? [paragraph(`Message from ${escapeHtml(data.inviterName)}: ${escapeHtml(data.message)}`)]
      : []),
    detailList([
      ['League code', data.leagueCode],
      ['Invite email', data.recipientEmail],
      ...(expiresLine ? ([['Expires', expiresLine]] as Array<[string, string]>) : []),
    ]),
    button('Join league', data.inviteUrl),
  ].join('');
  const textLines = [
    `${data.inviterName} invited you to join ${data.leagueName}.`,
    ...(data.message?.trim() ? [`Message from ${data.inviterName}: ${data.message}`] : []),
    `League code: ${data.leagueCode}`,
    `Invite email: ${data.recipientEmail}`,
    ...(expiresLine ? [`Expires: ${expiresLine}`] : []),
    `Join league: ${data.inviteUrl}`,
  ];

  return buildMessage(context, {
    templateKey: 'LEAGUE_MEMBER_INVITE',
    subject,
    preheader: `Join ${data.leagueName} on ${BRAND_NAME}.`,
    title: 'League invitation',
    bodyBlocks,
    textLines,
  });
}

function renderLeagueJoinSuccessEmail(
  data: LeagueJoinSuccessEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const subject = `Welcome to ${data.leagueName}`;
  const bodyBlocks = [
    paragraph(
      `${escapeHtml(data.userName)}, your account is registered and you joined ${strong(data.leagueName)}.`,
    ),
    detailList([
      ['League', data.leagueName],
      ['League code', data.leagueCode],
      ...(data.teamName ? ([['Playing as', data.teamName]] as Array<[string, string]>) : []),
    ]),
    button('Open league', data.leagueHomeUrl),
  ].join('');
  const textLines = [
    `${data.userName}, your account is registered and you joined ${data.leagueName}.`,
    `League code: ${data.leagueCode}`,
    ...(data.teamName ? [`Playing as: ${data.teamName}`] : []),
    `Open league: ${data.leagueHomeUrl}`,
  ];

  return buildMessage(context, {
    templateKey: 'LEAGUE_JOIN_SUCCESS',
    subject,
    preheader: `Your ${BRAND_NAME} account is ready.`,
    title: 'You are in',
    bodyBlocks,
    textLines,
  });
}

function renderContestEntryCompletedEmail(
  data: ContestEntryCompletedEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const submittedLine = formatDateTime(data.submittedAt, context.timeZone);
  const changeLine = `You can change your picks until ${formatInstant(data.changeUntil, context.timeZone)}.`;
  const subject = `Entry submitted: ${data.contestName}`;
  const tierRows = data.tiers
    .map((tier) => [
      tier.tierName,
      tier.participantNames.length > 0 ? tier.participantNames.join(', ') : 'No selections',
    ] as [string, string]);
  const bodyBlocks = [
    paragraph(
      `${escapeHtml(data.userName)}, your ${strong(data.entryName)} entry was submitted for ${strong(
        data.contestName,
      )}.`,
    ),
    detailList([
      ['League', data.leagueName],
      ['Playing as', data.teamName],
      ['Entry', data.entryName],
      ...(submittedLine ? ([['Submitted', submittedLine]] as Array<[string, string]>) : []),
      ...(data.tiebreaker ? ([['Tiebreaker', data.tiebreaker]] as Array<[string, string]>) : []),
    ]),
    sectionTitle('Selections'),
    detailList(tierRows),
    paragraph(escapeHtml(changeLine)),
    button('Review entry', data.entryUrl),
  ].join('');
  const textLines = [
    `${data.userName}, your ${data.entryName} entry was submitted for ${data.contestName}.`,
    `League: ${data.leagueName}`,
    `Playing as: ${data.teamName}`,
    ...(submittedLine ? [`Submitted: ${submittedLine}`] : []),
    ...(data.tiebreaker ? [`Tiebreaker: ${data.tiebreaker}`] : []),
    'Selections:',
    ...tierRows.map(([tierName, participants]) => `- ${tierName}: ${participants}`),
    changeLine,
    `Review entry: ${data.entryUrl}`,
  ];

  return buildMessage(context, {
    templateKey: 'CONTEST_ENTRY_COMPLETED',
    subject,
    preheader: `Your ${data.contestName} entry is saved.`,
    title: 'Entry completed',
    bodyBlocks,
    textLines,
  });
}

function renderContestStartedSummaryEmail(
  data: ContestStartedSummaryEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const subject = `${data.contestName} is live`;
  const intro = `${data.contestName} is live for ${data.event.name}.`;
  const followAlong = data.hasEntry
    ? null
    : 'You didn\'t enter this one, but you can follow every entry on the leaderboard.';
  const rows: Array<[string, string]> = [
    ['League', data.leagueName],
    ['Event', data.event.name],
    ...(data.event.venue ? ([['Venue', data.event.venue]] as Array<[string, string]>) : []),
    ['Starts', formatInstant(data.event.startsAt, context.timeZone)],
    ...(data.eventFormat ? ([['Format', data.eventFormat]] as Array<[string, string]>) : []),
    ['Rules', data.rules],
    ['Entries', String(data.entryCount)],
  ];
  const bodyBlocks = [
    paragraph('Good luck, everyone.'),
    paragraph(`${strong(data.contestName)} is live for ${strong(data.event.name)}.`),
    detailList(rows),
    ...(followAlong ? [paragraph(escapeHtml(followAlong))] : []),
    button('Leaderboard', data.leaderboardUrl),
  ].join('');
  const textLines = [
    'Good luck, everyone.',
    '',
    intro,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(followAlong ? ['', followAlong] : []),
    `Leaderboard: ${data.leaderboardUrl}`,
  ];

  return buildMessage(context, {
    templateKey: 'CONTEST_STARTED_SUMMARY',
    subject,
    preheader: `Good luck, everyone. ${data.contestName} is live with ${data.entryCount} ${data.entryCount === 1 ? 'entry' : 'entries'}.`,
    title: 'Contest is live',
    bodyBlocks,
    textLines,
  });
}

function renderContestOpenedEmail(
  data: ContestOpenedEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const subject = `New contest: ${data.contestName}`;
  const closesLine = formatInstant(data.closesAt, context.timeZone);
  const onlyEvent = data.events.length === 1 ? data.events[0] : undefined;
  const eventRows: Array<[string, string]> = onlyEvent
    ? [
      ['Event', onlyEvent.name],
      ...(onlyEvent.venue ? ([['Venue', onlyEvent.venue]] as Array<[string, string]>) : []),
      ['Starts', formatInstant(onlyEvent.startsAt, context.timeZone)],
    ]
    : [['Events', data.events.map((event) => `${event.name} (${formatInstant(event.startsAt, context.timeZone)})`).join(', ')]];
  const rows: Array<[string, string]> = [
    ['League', data.leagueName],
    ...eventRows,
    ['Rules', data.rules],
    ['Entries', data.entriesPerMember],
    [onlyEvent ? 'Picks close' : 'First picks close', closesLine],
  ];
  const intro = `${data.contestName} is open in ${data.leagueName}.`;
  const bodyBlocks = [
    paragraph(`Hi ${escapeHtml(data.userName)},`),
    paragraph(`${strong(data.contestName)} is open in ${strong(data.leagueName)}.`),
    detailList(rows),
    button('Enter contest', data.contestUrl),
  ].join('');
  const textLines = [
    `Hi ${data.userName},`,
    '',
    intro,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `Enter contest: ${data.contestUrl}`,
  ];

  return buildMessage(context, {
    templateKey: 'CONTEST_OPENED',
    subject,
    preheader: `${data.contestName} is open. Picks close ${closesLine}.`,
    title: 'New contest open',
    bodyBlocks,
    textLines,
  });
}

/** What a reminder says to its reader, by why it goes to them. */
function entryReminderWording(data: ContestEntryReminderEmailData): {
  subject: string;
  title: string;
  message: string;
  closesLabel: string;
  action: string;
} {
  const { standing } = data;
  switch (standing.kind) {
    case EntryReminderKind.NOT_JOINED:
      return {
        subject: `Entries close soon: ${data.contestName}`,
        title: 'Entries close soon',
        message: `Just join ${data.contestName} before entries close. It's a quick pick contest, so your picks are made for you.`,
        closesLabel: 'Entries close',
        action: 'Join the contest',
      };
    case EntryReminderKind.NO_BOX:
      return {
        subject: `Boxes close soon: ${data.contestName}`,
        title: 'Boxes close soon',
        message: `You haven't claimed a box on the ${data.contestName} grid yet. Boxes close when the game starts, or sooner if the numbers are drawn first.`,
        closesLabel: 'Game starts',
        action: 'Claim your boxes',
      };
    case EntryReminderKind.DRAFT:
      return {
        subject: `Picks close soon: ${data.contestName}`,
        title: 'Picks close soon',
        message: standing.drafts > 1
          ? `You have ${String(standing.drafts)} draft entries for ${data.eventName}. They won't count until you submit them.`
          : standing.progress === undefined
            ? `Your ${data.eventName} entry is saved as a draft. It won't count until you submit it.`
            : `Your ${data.eventName} entry is a draft with ${String(standing.progress.made)} of ${String(standing.progress.of)} picked. It won't count until you submit it.`,
        closesLabel: 'Picks close',
        action: 'Make your picks',
      };
    case EntryReminderKind.NOT_ENTERED:
      return {
        subject: `Picks close soon: ${data.contestName}`,
        title: 'Picks close soon',
        message: `You haven't entered ${data.contestName} for ${data.eventName} yet.`,
        closesLabel: 'Picks close',
        action: 'Make your picks',
      };
  }
}

function renderContestEntryReminderEmail(
  data: ContestEntryReminderEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const closesLine = formatInstant(data.closesAt, context.timeZone);
  const wording = entryReminderWording(data);
  const bodyBlocks = [
    paragraph(`Hi ${escapeHtml(data.userName)},`),
    paragraph(escapeHtml(wording.message)),
    detailList([
      ['League', data.leagueName],
      ['Contest', data.contestName],
      [wording.closesLabel, closesLine],
    ]),
    button(wording.action, data.contestUrl),
  ].join('');
  const textLines = [
    `Hi ${data.userName},`,
    '',
    wording.message,
    `League: ${data.leagueName}`,
    `Contest: ${data.contestName}`,
    `${wording.closesLabel}: ${closesLine}`,
    `${wording.action}: ${data.contestUrl}`,
  ];

  return buildMessage(context, {
    templateKey: 'CONTEST_ENTRY_REMINDER',
    subject: wording.subject,
    preheader: `${wording.closesLabel} ${closesLine}.`,
    title: wording.title,
    bodyBlocks,
    textLines,
  });
}

function renderPasswordResetEmail(
  data: PasswordResetEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const subject = `Reset your ${BRAND_NAME} password`;
  const expiryLine = `This link works once and expires in ${data.expiresInMinutes} minutes. `
    + "If you didn't ask for this, you can ignore this email. Your password won't change.";
  const bodyBlocks = [
    paragraph(`Hi ${escapeHtml(data.firstName)},`),
    paragraph(
      `We got a request to reset the password for your ${BRAND_NAME} account (${strong(data.username)}).`,
    ),
    button('Choose a new password', data.resetUrl),
    paragraph(escapeHtml(expiryLine)),
  ].join('');
  const textLines = [
    `Hi ${data.firstName},`,
    '',
    `We got a request to reset the password for your ${BRAND_NAME} account (${data.username}).`,
    '',
    `Choose a new password: ${data.resetUrl}`,
    '',
    expiryLine,
  ];

  return buildMessage(context, {
    templateKey: 'PASSWORD_RESET',
    subject,
    preheader: `Choose a new password. The link expires in ${data.expiresInMinutes} minutes.`,
    title: 'Reset your password',
    bodyBlocks,
    textLines,
  });
}

function renderPasswordChangedEmail(
  data: PasswordChangedEmailData,
  context: EmailRenderContext,
): SystemEmailMessage {
  const subject = `Your ${BRAND_NAME} password was changed`;
  const changedSentence = `The password for your ${BRAND_NAME} account (${data.username}) was changed on ${formatInstant(data.changedAt, context.timeZone)}.`;
  const bodyBlocks = [
    paragraph(`Hi ${escapeHtml(data.firstName)},`),
    paragraph(escapeHtml(changedSentence)),
    paragraph("If this was you, there's nothing else to do. If this wasn't you, reset your password now."),
    button('Reset your password', data.forgotPasswordUrl),
  ].join('');
  const textLines = [
    `Hi ${data.firstName},`,
    '',
    changedSentence,
    '',
    "If this was you, there's nothing else to do. If this wasn't you, reset your password now:",
    data.forgotPasswordUrl,
  ];

  return buildMessage(context, {
    templateKey: 'PASSWORD_CHANGED',
    subject,
    preheader: `Your ${BRAND_NAME} password was changed.`,
    title: 'Password changed',
    bodyBlocks,
    textLines,
  });
}

function buildMessage(context: EmailRenderContext, input: {
  templateKey: SystemEmailTemplateKey;
  subject: string;
  preheader: string;
  title: string;
  bodyBlocks: string;
  textLines: string[];
}): SystemEmailMessage {
  return {
    templateKey: input.templateKey,
    subject: input.subject,
    text: [
      BRAND_NAME,
      BRAND_TAGLINE,
      '',
      input.title,
      '',
      ...input.textLines,
      '',
      NOT_MONITORED,
      ...(context.unsubscribeUrl ? [`${STOP_THESE_EMAILS}: ${context.unsubscribeUrl}`] : []),
    ].join('\n'),
    html: documentShell({
      preheader: input.preheader,
      title: input.title,
      bodyBlocks: input.bodyBlocks,
      unsubscribeUrl: context.unsubscribeUrl,
    }),
  };
}

function documentShell(input: {
  preheader: string;
  title: string;
  bodyBlocks: string;
  unsubscribeUrl?: string;
}): string {
  const unsubscribe = input.unsubscribeUrl
    ? `<br><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:rgba(255,255,255,0.85);">${STOP_THESE_EMAILS}</a>`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${EMAIL_THEME.canvas};color:${EMAIL_THEME.navy};font-family:Inter,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(input.preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_THEME.canvas};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:${EMAIL_THEME.raised};border:1px solid ${EMAIL_THEME.border};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${EMAIL_THEME.navy};padding:28px 32px;color:#ffffff;">
                <div style="font-family:Archivo,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${EMAIL_THEME.gold};">${BRAND_NAME}</div>
                <div style="margin-top:8px;font-size:14px;line-height:1.5;color:rgba(255,255,255,0.72);">${BRAND_TAGLINE}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 20px;font-family:Archivo,Arial,sans-serif;font-size:28px;line-height:1.15;color:${EMAIL_THEME.navy};">${escapeHtml(input.title)}</h1>
                ${input.bodyBlocks}
              </td>
            </tr>
            <tr>
              <td style="background:${EMAIL_THEME.navyDeep};padding:20px 32px;color:rgba(255,255,255,0.70);font-size:12px;line-height:1.5;">
                Sent by ${BRAND_NAME}. Keep the office pool moving.<br>${escapeHtml(NOT_MONITORED)}${unsubscribe}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paragraph(content: string): string {
  return `<p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:${EMAIL_THEME.ink};">${content}</p>`;
}

function sectionTitle(content: string): string {
  return `<h2 style="margin:28px 0 12px;font-family:Archivo,Arial,sans-serif;font-size:18px;line-height:1.25;color:${EMAIL_THEME.navy};">${escapeHtml(content)}</h2>`;
}

function detailList(rows: Array<[string, string]>): string {
  const renderedRows = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:12px 16px;border-top:1px solid ${EMAIL_THEME.subtleBorder};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${EMAIL_THEME.muted};vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:12px 16px;border-top:1px solid ${EMAIL_THEME.subtleBorder};font-size:14px;line-height:1.45;color:${EMAIL_THEME.navy};vertical-align:top;">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid ${EMAIL_THEME.border};border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">${renderedRows}</table>`;
}

function button(label: string, href: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 4px;">
    <tr>
      <td style="background:${EMAIL_THEME.gold};border-radius:8px;">
        <a href="${escapeAttribute(href)}" style="display:inline-block;padding:14px 20px;font-family:Inter,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:${EMAIL_THEME.navy};text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function strong(value: string): string {
  return `<strong style="color:${EMAIL_THEME.navy};">${escapeHtml(value)}</strong>`;
}

/** A date in the recipient's time zone, with the zone named, e.g. "Oct 22, 2026, 2:30 PM EDT". */
function formatDateTime(value: Date | string | undefined, timeZone: string): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatInstant(date, timeZone);
}

/** A date that is always present, formatted as formatDateTime does. */
function formatInstant(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
