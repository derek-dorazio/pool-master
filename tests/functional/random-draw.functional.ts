import {
  acceptInvitation,
  enterContest,
  generateInviteLink,
  getSelectionState,
  runContestDraw,
  submitContestSelection,
} from '@poolmaster/shared/generated/hey-api';
import { SelectionType } from '@poolmaster/shared/domain';
import { attachContestEvent, buildLeagueWithCommissioner, buildRegisteredUser, seedContestFixture } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';
import { randomUUID } from 'node:crypto';
import { cleanupFreshEventEditions, freshEventEdition } from '../support/event-edition';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';

// The random draw (#601) end to end over HTTP: members enter, nobody can pick, the
// commissioner's draw deals every entry its golfers, and the deal is then final and public.

const createdParticipantIds: string[] = [];
const createdSportEventIds: string[] = [];

async function cleanupDrawArtifacts(): Promise<void> {
  const prisma = getFunctionalPrisma();
  if (createdSportEventIds.length > 0) {
    await prisma.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: createdSportEventIds } } } });
    await prisma.sportEventParticipant.deleteMany({ where: { sportEventId: { in: createdSportEventIds } } });
    await unlinkContestsFromSportEvents(prisma, createdSportEventIds);
    await prisma.sportEvent.deleteMany({ where: { id: { in: createdSportEventIds } } });
    await cleanupFreshEventEditions(prisma);
    createdSportEventIds.length = 0;
  }
  if (createdParticipantIds.length > 0) {
    await prisma.participant.deleteMany({ where: { id: { in: createdParticipantIds } } });
    createdParticipantIds.length = 0;
  }
}

/** An open random-draw contest dealing one golfer each, entered by the commissioner and a member, on a field of three. */
async function seedRandomDrawFixture() {
  const { commissioner, league } = await buildLeagueWithCommissioner({
    displayName: 'Draw Commissioner',
    leagueName: 'Draw Functional League',
  });
  const member = await buildRegisteredUser({ displayName: 'Draw Member' });
  const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
  if (!invite.data) throw new Error('Builder: generateInviteLink failed for the draw fixture');
  const accepted = await acceptInvitation({ client: member.client, body: { inviteCode: invite.data.invitation.inviteCode } });
  if (!accepted.data) throw new Error('Builder: acceptInvitation failed for the draw fixture');

  const { contestId } = await seedContestFixture(league.id, {
    name: 'Draw Functional Contest',
    selectionType: SelectionType.RANDOM_DRAW,
    configuration: {
      configJson: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 1, countedScores: 1 },
    },
  });

  const commissionerEntry = await enterContest({ client: commissioner.client, path: { contestId } });
  const memberEntry = await enterContest({ client: member.client, path: { contestId } });
  if (!commissionerEntry.data || !memberEntry.data) throw new Error('Builder: enterContest failed for the draw fixture');

  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `draw-functional-event-${randomUUID().slice(0, 8)}`,
      providerId: 'integration-test',
      sport: 'GOLF',
      name: 'Draw Functional Event',
      startDate: new Date('2099-04-20T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  createdSportEventIds.push(event.id);
  const fieldIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Draw Golfer ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
        externalIds: {},
        role: 'GOLFER',
      },
    });
    createdParticipantIds.push(participant.id);
    const row = await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: true },
    });
    fieldIds.push(row.id);
  }
  await attachContestEvent(contestId, event.id);

  return {
    contestId,
    commissioner,
    member,
    commissionerEntryId: commissionerEntry.data.entry.id,
    memberEntryId: memberEntry.data.entry.id,
    fieldIds,
  };
}

afterEach(async () => {
  await cleanupDrawArtifacts();
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Quick pick', () => {
  it('refuses a member\'s pick and a member\'s draw, then the commissioner\'s draw deals and submits every entry, revealing each entry\'s golfer to the league', async () => {
    const fixture = await seedRandomDrawFixture();
    const { contestId } = fixture;

    const memberPick = await submitContestSelection({
      client: fixture.member.client,
      path: { contestId },
      body: { entryId: fixture.memberEntryId, participantId: fixture.fieldIds[0] ?? '' },
    });
    expectFunctionalError(memberPick, { status: 409, code: 'SELECTION_DEALT_BY_DRAW' });

    const memberDraw = await runContestDraw({ client: fixture.member.client, path: { contestId } });
    expect(memberDraw.response?.status).toBe(403);

    const drawn = await runContestDraw({ client: fixture.commissioner.client, path: { contestId } });
    expect(drawn.data?.drawnAt).toEqual(expect.any(String));
    expect(drawn.data?.entries.map((entry) => entry.status)).toEqual(['SUBMITTED', 'SUBMITTED']);

    // The member reads the commissioner's entry while the contest is still open: a draw is public.
    const memberView = await getSelectionState({
      client: fixture.member.client,
      path: { contestId },
      query: { entryId: fixture.commissionerEntryId },
    });
    expect(memberView.data?.selectedEntryId).toBe(fixture.commissionerEntryId);
    const dealt = memberView.data?.pickHistories.map((pick) => pick.participantId) ?? [];
    expect(dealt).toHaveLength(2);
    expect(new Set(dealt).size).toBe(2);
    expect(dealt.every((id) => id !== null && fixture.fieldIds.includes(id))).toBe(true);
    expect(memberView.data?.pickHistories.map((pick) => pick.entryId).sort())
      .toEqual([fixture.commissionerEntryId, fixture.memberEntryId].sort());
  });

  it('refuses a second draw, and closes entries once drawn', async () => {
    const fixture = await seedRandomDrawFixture();
    const { contestId } = fixture;
    await runContestDraw({ client: fixture.commissioner.client, path: { contestId } });

    const again = await runContestDraw({ client: fixture.commissioner.client, path: { contestId } });
    expectFunctionalError(again, { status: 409, code: 'CONTEST_DRAW_ALREADY_RUN' });

    const lateEntry = await enterContest({ client: fixture.member.client, path: { contestId } });
    expectFunctionalError(lateEntry, { status: 400, code: 'CONTEST_ENTRY_LOCKED' });
  });

  it('refuses a draw the field cannot deal, dealing nothing', async () => {
    const fixture = await seedRandomDrawFixture();
    const { contestId } = fixture;
    const prisma = getFunctionalPrisma();
    await prisma.contestConfiguration.update({
      where: { contestId },
      data: { configJson: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 2, countedScores: 1 } },
    });

    const refused = await runContestDraw({ client: fixture.commissioner.client, path: { contestId } });

    expectFunctionalError(refused, { status: 409, code: 'CONTEST_DRAW_FIELD_TOO_SMALL' });
    expect(await prisma.contestEntryPick.count({ where: { entry: { contestId } } })).toBe(0);
  });
});
