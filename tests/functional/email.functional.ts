import { randomUUID } from 'node:crypto';
import {
  acceptInvitation,
  createContest,
  enterContest,
  listContestConfigTemplates,
  resendLeagueInvitation,
  openContest,
  sendLeagueInvitations,
  submitContestSelection,
  transitionEvent,
  updateContestEntry,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ParticipantType, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  buildLeagueWithCommissioner,
  buildRegisteredUser,
  promoteToRootAdmin,
  type RegisteredUserContext,
} from './builders';
import { linksIn, sentMailTo, sentMailWithSubject } from './mail';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { FUNCTIONAL_APP_BASE_URL } from './state';
import { cleanupFreshEventEditions, freshEventEdition } from '../support/event-edition';

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
  const golf = await prisma.sport.findUniqueOrThrow({ where: { name: 'GOLF' } });
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
  expect(invite.response.status).toBe(201);
  const inviteCode = invite.data?.sent[0]?.inviteCode as string;
  expect(inviteCode).toBeTruthy();

  const accepted = await acceptInvitation({ client: invitee.client, body: { inviteCode } });
  expect(accepted.response.status).toBe(201);
  return inviteCode;
}

afterEach(async () => {
  await cleanupEventFixtures();
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: system emails', () => {
  it('sends one league invite to the invited address, linking to that invitation, and one welcome linking to the league once they join', async () => {
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
    expect(invite.response.status).toBe(201);
    const inviteCode = invite.data?.sent[0]?.inviteCode as string;

    const invitesSent = await sentMailTo(invitee.email);
    expect(invitesSent).toHaveLength(1);
    expect(invitesSent[0].to).toEqual([invitee.email]);
    expect(invitesSent[0].subject).toBe(`Inviting Commissioner invited you to ${league.name}`);
    expect(linksIn(invitesSent[0])).toEqual([`${FUNCTIONAL_APP_BASE_URL}/invite/${inviteCode}`]);
    // Nobody but the invitee is told about the invitation.
    expect(await sentMailTo(commissioner.email)).toHaveLength(0);

    const accepted = await acceptInvitation({ client: invitee.client, body: { inviteCode } });
    expect(accepted.response.status).toBe(201);

    const welcomes = await sentMailWithSubject(invitee.email, `Welcome to ${league.name}`);
    expect(welcomes).toHaveLength(1);
    expect(welcomes[0].to).toEqual([invitee.email]);
    expect(linksIn(welcomes[0])).toEqual([`${FUNCTIONAL_APP_BASE_URL}/league/${league.leagueCode}`]);
    expect(await sentMailTo(invitee.email)).toHaveLength(2);
    expect(await sentMailTo(commissioner.email)).toHaveLength(0);
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

    expect(resent.response.status).toBe(200);
    const newCode = resent.data?.invitation.inviteCode as string;
    expect(newCode).toBeTruthy();
    expect(newCode).not.toBe(original?.inviteCode);
    const invitesSent = await sentMailWithSubject(
      invitee.email,
      `Resending Commissioner invited you to ${league.name}`,
    );
    expect(invitesSent).toHaveLength(2);
    expect(linksIn(invitesSent[1])).toEqual([`${FUNCTIONAL_APP_BASE_URL}/invite/${newCode}`]);

    const oldLink = await acceptInvitation({
      client: invitee.client,
      body: { inviteCode: original?.inviteCode as string },
    });
    expect(oldLink.response.status).toBe(404);
    const newLink = await acceptInvitation({ client: invitee.client, body: { inviteCode: newCode } });
    expect(newLink.response.status).toBe(201);
  });

  it('sends the entry confirmation to the member who completed the entry, linking to that entry, and a contest-started summary to the commissioner and each entrant when an admin starts the event', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Contest Commissioner',
      leagueName: `Email Contest League ${randomUUID().slice(0, 6)}`,
    });
    const member = await buildRegisteredUser({ displayName: 'Entering Member' });
    await inviteAndJoin(commissioner, league.id, member);
    // A league member who enters nothing is not told the contest started.
    const bystander = await buildRegisteredUser({ displayName: 'Idle Member' });
    await inviteAndJoin(commissioner, league.id, bystander);

    const event = await seedScheduledGolfEvent(`Email Open ${randomUUID().slice(0, 6)}`);
    const templates = await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.GOLF, contestFormat: ContestFormat.ROSTER, active: true },
    });
    const template = templates.data?.templates.find((candidate) => candidate.isDefault);
    expect(template).toBeDefined();
    const contestName = `Email Contest ${randomUUID().slice(0, 6)}`;
    const created = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: contestName,
        sportEventId: event.sportEventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: template?.id as string,
        configuration: { maxEntriesPerSquad: 1, picksPerTier: 1, countedScores: 1 },
      },
    });
    expect(created.response.status).toBe(201);
    const contestId = created.data?.contest.id as string;
    const opened = await openContest({ client: commissioner.client, path: { id: league.id, contestId } });
    expect(opened.data?.contest.status).toBe('OPEN');

    const entered = await enterContest({ client: member.client, path: { contestId } });
    const entryId = entered.data?.entry.id as string;
    expect(entryId).toBeTruthy();
    const picked = await submitContestSelection({
      client: member.client,
      path: { contestId },
      body: { entryId, participantId: event.sportEventParticipantId },
    });
    expect(picked.data?.isComplete).toBe(true);
    // The confirmation goes out once the lineup and the tiebreaker are both in.
    expect(await sentMailWithSubject(member.email, `Entry submitted: ${contestName}`)).toHaveLength(0);

    const completed = await updateContestEntry({
      client: member.client,
      path: { contestId, entryId },
      body: { tiebreakerValue: -12 },
    });
    expect(completed.response.status).toBe(200);

    const confirmations = await sentMailWithSubject(member.email, `Entry submitted: ${contestName}`);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].to).toEqual([member.email]);
    expect(linksIn(confirmations[0])).toEqual([
      `${FUNCTIONAL_APP_BASE_URL}/league/${league.leagueCode}/contests/${contestId}/entries/${entryId}`,
    ]);
    expect(await sentMailWithSubject(commissioner.email, `Entry submitted: ${contestName}`)).toHaveLength(0);

    // Post-#435 every event is admin-owned: the admin's transition is what starts its contests.
    const admin = await buildRegisteredUser({ displayName: 'Email Root Admin' });
    await promoteToRootAdmin(admin);
    const started = await transitionEvent({
      client: admin.client,
      path: { eventId: event.sportEventId },
      body: { toStatus: 'IN_PROGRESS' },
    });
    expect(started.response.status).toBe(200);

    const startedSubject = `${contestName} has started`;
    const contestUrl = `${FUNCTIONAL_APP_BASE_URL}/league/${league.leagueCode}/contests/${contestId}`;
    for (const recipient of [commissioner, member]) {
      const summaries = await sentMailWithSubject(recipient.email, startedSubject);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].to).toEqual([recipient.email]);
      expect(linksIn(summaries[0])).toEqual([contestUrl]);
    }
    expect(await sentMailWithSubject(bystander.email, startedSubject)).toHaveLength(0);
    expect(await sentMailWithSubject(admin.email, startedSubject)).toHaveLength(0);
  });
});
