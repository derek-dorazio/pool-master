import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  createContest,
  enterContest,
  getUserEmailPreferences,
  listContestConfigTemplates,
  listLeagueInvitations,
  resendLeagueInvitation,
  openContest,
  receiveSesEvent,
  sendLeagueInvitations,
  submitContestEntry,
  selectContestPick,
  transitionEvent,
  unsubscribeFromEmail,
  updateContestEntry,
  updateUserEmailPreference,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ParticipantType, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  buildLeagueWithCommissioner,
  buildRegisteredUser,
  promoteToRootAdmin,
  type RegisteredUserContext,
} from './builders';
import { awaitSentMailTo, linksIn, sentMailTo, sentMailWithSubject } from './mail';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma, getSdkClient } from './setup';
import { FUNCTIONAL_APP_BASE_URL } from './state';
import { cleanupFreshEventEditions, freshEventEdition } from '../support/event-edition';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';

// #442 — every system email the app sends, proven end to end: the functional server sends
// through a local SMTP sink that records each message, and these tests read it back. Each one
// asserts the email went once, to the right person, with the right subject and link.

const createdParticipantIds: string[] = [];
const createdSportEventIds: string[] = [];
const createdSportEventParticipantIds: string[] = [];

async function cleanupEventFixtures(): Promise<void> {
  const prisma = getFunctionalPrisma();
  await prisma.contestEntryPick.deleteMany({
    where: { sportEventParticipantId: { in: createdSportEventParticipantIds } },
  });
  await prisma.sportEventParticipantValuation.deleteMany({
    where: { sportEventParticipantId: { in: createdSportEventParticipantIds } },
  });
  await prisma.sportEventParticipant.deleteMany({ where: { id: { in: createdSportEventParticipantIds } } });
  await prisma.sportEventTier.deleteMany({ where: { sportEventId: { in: createdSportEventIds } } });
  await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: createdSportEventIds } } });
  await unlinkContestsFromSportEvents(prisma, createdSportEventIds);
  await prisma.sportEvent.deleteMany({ where: { id: { in: createdSportEventIds } } });
  await cleanupFreshEventEditions(prisma);
  await prisma.participant.deleteMany({ where: { id: { in: createdParticipantIds } } });
  createdSportEventParticipantIds.length = 0;
  createdSportEventIds.length = 0;
  createdParticipantIds.length = 0;
}

/** A scheduled, released golf event with a one-golfer field in one tier: enough for a one-pick contest. */
async function seedScheduledGolfEvent(eventName: string): Promise<{
  sportEventId: string;
  sportEventParticipantId: string;
}> {
  const prisma = getFunctionalPrisma();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const edition = await freshEventEdition(prisma);
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...edition,
      externalId: `email-event-${randomUUID().slice(0, 8)}`,
      providerId: 'functional-test',
      sport: Sport.GOLF,
      name: eventName,
      startDate: new Date(now + 2 * day),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(sportEvent.id);

  const tier = await prisma.sportEventTier.create({
    data: { sportEventId: sportEvent.id, tierKey: 'A', label: 'Tier A', tierNumber: 1 },
  });
  const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: 'GOLF' } });
  const participant = await prisma.participant.create({
    data: {
      sportId: golf.id,
      name: `Email Golfer ${randomUUID().slice(0, 8)}`,
      participantType: ParticipantType.INDIVIDUAL,
      externalIds: {},
      role: 'GOLFER',
      teamAffiliation: 'USA',
    },
  });
  createdParticipantIds.push(participant.id);
  const sportEventParticipant = await prisma.sportEventParticipant.create({
    data: { sportEventId: sportEvent.id, participantId: participant.id, isActive: true },
  });
  createdSportEventParticipantIds.push(sportEventParticipant.id);
  await prisma.sportEventParticipantValuation.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      sportEventTierId: tier.id,
      tierOrderIndex: 1,
      tierAssignedSource: 'MANUAL',
    },
  });

  return { sportEventId: sportEvent.id, sportEventParticipantId: sportEventParticipant.id };
}

/** Invites `invitee` to the league by email and has them accept; returns the invite code. */
async function inviteAndJoin(
  commissioner: RegisteredUserContext,
  leagueId: string,
  invitee: RegisteredUserContext,
): Promise<string> {
  const invite = await sendLeagueInvitations({
    client: commissioner.client,
    path: { id: leagueId },
    body: { emails: [invitee.email] },
  });
  expect(invite.response?.status).toBe(201);
  const inviteCode = invite.data?.sent[0]?.inviteCode as string;
  expect(inviteCode).toBeTruthy();

  const accepted = await acceptInvitation({ client: invitee.client, body: { inviteCode } });
  expect(accepted.response?.status).toBe(201);
  return inviteCode;
}

/** The league's pending invites' email statuses, once none is still queued or being sent. */
async function inviteEmailStatusesOnceSettled(commissioner: RegisteredUserContext, leagueId: string): Promise<unknown[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const listed = await listLeagueInvitations({ client: commissioner.client, path: { id: leagueId } });
    const statuses = listed.data?.invitations.map((invitation) => invitation.emailStatus) ?? [];
    if (!statuses.some((status) => status === 'QUEUED' || status === 'SENDING') || Date.now() >= deadline) return statuses;
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
}

/**
 * A league with a commissioner, a member and an idle member, and a one-pick golf contest the member
 * has entered with a complete lineup, ready to submit; no receipt has gone out yet.
 */
async function enteredContest() {
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Contest Commissioner',
    leagueName: `Email Contest League ${randomUUID().slice(0, 6)}`,
  });
  const member = await buildRegisteredUser({ displayName: 'Entering Member' });
  await inviteAndJoin(commissioner, league.id, member);
  // A league member who enters nothing is still told the contest opened and started (#845).
  const bystander = await buildRegisteredUser({ displayName: 'Idle Member' });
  await inviteAndJoin(commissioner, league.id, bystander);

  const event = await seedScheduledGolfEvent(`Email Open ${randomUUID().slice(0, 6)}`);
  const templates = await listContestConfigTemplates({
    client: commissioner.client,
    query: { sport: Sport.GOLF, active: true },
  });
  const template = templates.data?.templates.find((candidate) => candidate.contestFormat === ContestFormat.ROSTER && candidate.isDefault);
  expect(template).toBeDefined();
  const contestName = `Email Contest ${randomUUID().slice(0, 6)}`;
  const created = await createContest({
    client: commissioner.client,
    path: { id: league.id },
    body: {
      name: contestName,
      sportEventIds: [event.sportEventId],
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
      templateId: template?.id as string,
      configuration: { maxEntriesPerSquad: 1, selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
    },
  });
  expect(created.response?.status).toBe(201);
  const contestId = created.data?.contest.id as string;
  const opened = await openContest({ client: commissioner.client, path: { id: league.id, contestId } });
  expect(opened.data?.contest.status).toBe('OPEN');
  const contestUrl = `${FUNCTIONAL_APP_BASE_URL}/league/${league.leagueCode}/contests/${contestId}`;
  for (const recipient of [commissioner, member, bystander]) {
    const announcements = await awaitSentMailTo(recipient.email, 1, `New contest: ${contestName}`);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].to).toEqual([recipient.email]);
    expect(linksIn(announcements[0])[0]).toBe(contestUrl);
  }

  const entered = await enterContest({ client: member.client, path: { contestId } });
  const entryId = entered.data?.entry.id as string;
  expect(entryId).toBeTruthy();
  // #481: an entry with an incomplete lineup cannot be submitted.
  const early = await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.sportEventId } });
  expect(early.response?.status).toBe(409);
  expect(early.error?.error.code).toBe('ENTRY_LINEUP_INCOMPLETE');
  const picked = await selectContestPick({
    client: member.client,
    path: { contestId, entryId, sportEventParticipantId: event.sportEventParticipantId },
  });
  // The one-golfer lineup is now full, and still a draft until it is submitted.
  expect(picked.data?.picks).toHaveLength(1);
  expect(picked.data?.entryStatus).toBe('DRAFT');
  expect(await sentMailWithSubject(member.email, `Entry submitted: ${contestName}`)).toHaveLength(0);

  const completed = await updateContestEntry({
    client: member.client,
    path: { contestId, entryId },
    body: { tiebreakerValue: -12 },
  });
  expect(completed.response?.status).toBe(200);
  // The confirmation goes out when the entry is submitted (#481), not when its details are saved.
  expect(await sentMailWithSubject(member.email, `Entry submitted: ${contestName}`)).toHaveLength(0);

  return { commissioner, league, member, bystander, event, contestId, contestUrl, entryId, contestName };
}

/** The token in an email's List-Unsubscribe header, as a mail app would post it back. */
function oneClickToken(listUnsubscribe: string | undefined): string {
  const url = /^<([^>]+)>$/.exec(listUnsubscribe ?? '')?.[1];
  expect(url).toMatch(new RegExp(`^${FUNCTIONAL_APP_BASE_URL}/api/v1/email/unsubscribe\\?token=`));
  return new URL(url as string).searchParams.get('token') as string;
}

afterEach(async () => {
  await cleanupEventFixtures();
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: system emails', () => {
  it('sends one league invite to the invited address from the league\'s own address, linking to that invitation, one welcome linking to the league once they join, and one email telling the commissioner who joined', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Inviting Commissioner',
      leagueName: `Email Invite League ${randomUUID().slice(0, 6)}`,
    });
    const invitee = await buildRegisteredUser({ displayName: 'Invited Member' });

    const invite = await sendLeagueInvitations({
      client: commissioner.client,
      path: { id: league.id },
      body: { emails: [invitee.email] },
    });
    expect(invite.response?.status).toBe(201);
    expect(invite.data?.sent[0]?.emailStatus).toBe('QUEUED');
    const inviteCode = invite.data?.sent[0]?.inviteCode as string;

    const invitesSent = await awaitSentMailTo(invitee.email, 1);
    expect(invitesSent).toHaveLength(1);
    expect(invitesSent[0].to).toEqual([invitee.email]);
    expect(invitesSent[0].from).toBe(`${league.leagueCode.toLowerCase()}@functional.test`);
    expect(invitesSent[0].subject).toBe(`Inviting Commissioner invited you to ${league.name}`);
    expect(linksIn(invitesSent[0])).toEqual([`${FUNCTIONAL_APP_BASE_URL}/invite/${inviteCode}`]);
    // Nobody but the invitee is told about the invitation.
    expect(await sentMailTo(commissioner.email)).toHaveLength(0);
    // The commissioner's pending invites show the email went out, once the sender has recorded it.
    expect(await inviteEmailStatusesOnceSettled(commissioner, league.id)).toEqual(['SENT']);

    const accepted = await acceptInvitation({ client: invitee.client, body: { inviteCode } });
    expect(accepted.response?.status).toBe(201);

    const welcomes = await awaitSentMailTo(invitee.email, 1, `Welcome to ${league.name}`);
    expect(welcomes).toHaveLength(1);
    expect(welcomes[0].to).toEqual([invitee.email]);
    expect(linksIn(welcomes[0])).toEqual([`${FUNCTIONAL_APP_BASE_URL}/league/${league.leagueCode}`]);
    expect(await sentMailTo(invitee.email)).toHaveLength(2);

    const joined = await awaitSentMailTo(commissioner.email, 1);
    expect(joined).toHaveLength(1);
    expect(joined[0].subject).toBe(`Invited Member joined ${league.name}`);
    expect(linksIn(joined[0])).toContain(`${FUNCTIONAL_APP_BASE_URL}/league/${league.leagueCode}/admin/teams`);
  });

  it('resends a league invite to the same address with a new link, and only the new link joins the league', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Resending Commissioner',
      leagueName: `Email Resend League ${randomUUID().slice(0, 6)}`,
    });
    const invitee = await buildRegisteredUser({ displayName: 'Re-Invited Member' });
    const invite = await sendLeagueInvitations({
      client: commissioner.client,
      path: { id: league.id },
      body: { emails: [invitee.email] },
    });
    const original = invite.data?.sent[0];
    expect(original).toBeDefined();

    const resent = await resendLeagueInvitation({
      client: commissioner.client,
      path: { id: league.id, invitationId: original?.id as string },
    });

    expect(resent.response?.status).toBe(200);
    const newCode = resent.data?.invitation.inviteCode as string;
    expect(newCode).toBeTruthy();
    expect(newCode).not.toBe(original?.inviteCode);
    const invitesSent = await awaitSentMailTo(
      invitee.email,
      2,
      `Resending Commissioner invited you to ${league.name}`,
    );
    expect(invitesSent).toHaveLength(2);
    expect(linksIn(invitesSent[1])).toEqual([`${FUNCTIONAL_APP_BASE_URL}/invite/${newCode}`]);

    const oldLink = await acceptInvitation({
      client: invitee.client,
      body: { inviteCode: original?.inviteCode as string },
    });
    expect(oldLink.response?.status).toBe(404);
    const newLink = await acceptInvitation({ client: invitee.client, body: { inviteCode: newCode } });
    expect(newLink.response?.status).toBe(201);
  });

  it('tells every league member a contest opened, sends the entry confirmation to the entry\'s owner linking to that entry, and wishes every member good luck with a leaderboard link when an admin starts the event', async () => {
    const { commissioner, member, bystander, event, contestId, contestUrl, entryId, contestName } = await enteredContest();

    const submitted = await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.sportEventId } });
    expect(submitted.response?.status).toBe(200);
    expect(submitted.data?.entries.find((row) => row.id === entryId)?.status).toBe('SUBMITTED');

    const confirmations = await awaitSentMailTo(member.email, 1, `Entry submitted: ${contestName}`);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].to).toEqual([member.email]);
    const [entryLink, unsubscribeLink] = linksIn(confirmations[0]);
    expect(entryLink).toBe(`${contestUrl}/entries/${entryId}`);
    // An entry receipt is an email a member can turn off: it ends with their own unsubscribe link.
    expect(unsubscribeLink).toMatch(new RegExp(`^${FUNCTIONAL_APP_BASE_URL}/email/unsubscribe\\?token=`));
    expect(await sentMailWithSubject(commissioner.email, `Entry submitted: ${contestName}`)).toHaveLength(0);

    // Post-#435 every event is admin-owned: the admin's transition is what starts its contests.
    const admin = await buildRegisteredUser({ displayName: 'Email Root Admin' });
    await promoteToRootAdmin(admin);
    const started = await transitionEvent({
      client: admin.client,
      path: { eventId: event.sportEventId },
      body: { toStatus: 'IN_PROGRESS' },
    });
    expect(started.response?.status).toBe(200);

    const startedSubject = `${contestName} is live`;
    for (const recipient of [commissioner, member, bystander]) {
      const summaries = await awaitSentMailTo(recipient.email, 1, startedSubject);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].to).toEqual([recipient.email]);
      expect(linksIn(summaries[0])[0]).toBe(`${contestUrl}/leaderboard`);
    }
    // The root admin is not in the league, so is told nothing.
    expect(await sentMailWithSubject(admin.email, startedSubject)).toHaveLength(0);
  });
});

describe('SDK Functional: email preferences and unsubscribe', () => {
  it('stops a member\'s contest-started email once they turn live standings off, and turns receipts off from the one-click unsubscribe header of their entry receipt', async () => {
    const { commissioner, member, event, contestId, entryId, contestName } = await enteredContest();
    const liveOff = await updateUserEmailPreference({
      client: member.client,
      path: { userId: 'me' },
      body: { category: 'LIVE_STANDINGS', enabled: false },
    });
    expect(liveOff.response?.status).toBe(200);

    const submitted = await submitContestEntry({ client: member.client, path: { contestId, entryId, sportEventId: event.sportEventId } });
    expect(submitted.response?.status).toBe(200);
    const [receipt] = await awaitSentMailTo(member.email, 1, `Entry submitted: ${contestName}`);
    expect(receipt.listUnsubscribePost).toBe('List-Unsubscribe=One-Click');

    // A mail app posts the header's URL with no session; the token is its whole authority.
    const unsubscribed = await unsubscribeFromEmail({
      client: getSdkClient(),
      query: { token: oneClickToken(receipt.listUnsubscribe) },
    });
    expect(unsubscribed.data).toEqual({ category: 'RECEIPTS' });
    const preferences = await getUserEmailPreferences({ client: member.client, path: { userId: 'me' } });
    expect(preferences.data?.preferences.filter((preference) => !preference.enabled).map((preference) => preference.category))
      .toEqual(['LIVE_STANDINGS', 'RECEIPTS']);

    const admin = await buildRegisteredUser({ displayName: 'Preferences Root Admin' });
    await promoteToRootAdmin(admin);
    const started = await transitionEvent({ client: admin.client, path: { eventId: event.sportEventId }, body: { toStatus: 'IN_PROGRESS' } });
    expect(started.response?.status).toBe(200);

    // The commissioner still gets theirs; the member, who turned live standings off, does not.
    expect(await awaitSentMailTo(commissioner.email, 1, `${contestName} is live`)).toHaveLength(1);
    expect(await sentMailWithSubject(member.email, `${contestName} is live`)).toHaveLength(0);
  });
});

describe('SDK Functional: SES delivery events', () => {
  it('refuses, without a session, an SNS message the server cannot verify as its SES events topic\'s', async () => {
    const answer = await receiveSesEvent({
      client: getSdkClient(),
      body: {
        Type: 'Notification',
        MessageId: randomUUID(),
        TopicArn: 'arn:aws:sns:us-east-2:123456789012:someone-elses-topic',
        Message: JSON.stringify({ eventType: 'Delivery', mail: { messageId: 'functional' } }),
        Timestamp: new Date().toISOString(),
        SignatureVersion: '2',
        Signature: 'bm90IGEgc2lnbmF0dXJl',
        SigningCertURL: 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-functional.pem',
      },
    });

    expect(answer.response?.status).toBe(403);
    expect(answer.error?.error.code).toBe('EMAIL_EVENT_UNVERIFIED');
  });
});
