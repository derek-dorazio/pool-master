/**
 * Permanently deleting an inactive team, against Postgres.
 *
 * `SquadService.deleteInactiveSquad` deletes in one transaction, in foreign-key order: the
 * team's contest picks, then its entries (standings cascade), its pending co-owner
 * invitations, its ownership rows, and the team. Only a real database can say whether that
 * order satisfies every foreign key, so this suite drives the route end to end and reads
 * what is left.
 */
import { randomUUID } from 'node:crypto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

/**
 * A league with a commissioner on one team and an owner on another, and a contest where the
 * owner's team has an entry with a pick and a settled standing, plus a pending co-owner
 * invitation to the owner's team.
 */
async function seedLeagueWithContestHistory() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ firstName: 'Casey', lastName: `Commish${suffix}` });
  const owner = await createTestUser({ firstName: 'Olive', lastName: `Owner${suffix}` });

  const league = await prisma.league.create({
    data: {
      leagueCode: `DEL${suffix.toUpperCase()}`,
      name: `Delete Team League ${suffix}`,
      iconKey: 'TROPHY',
      joinPolicy: 'COMMISSIONER_ONLY',
    },
  });
  const seedMember = async (userId: string, role: 'COMMISSIONER' | 'MEMBER', teamName: string) => {
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId, role, status: 'ACTIVE', joinedAt: new Date() },
    });
    const squad = await prisma.squad.create({
      data: { leagueId: league.id, name: teamName, createdBy: userId },
    });
    await prisma.squadMembership.create({
      data: { squadId: squad.id, leagueId: league.id, userId, status: 'ACTIVE', joinedAt: new Date() },
    });
    return squad;
  };
  const commissionerSquad = await seedMember(commissioner.user.id, 'COMMISSIONER', `Commish Team ${suffix}`);
  const ownerSquad = await seedMember(owner.user.id, 'MEMBER', `Owner Team ${suffix}`);

  const sport = await prisma.sport.create({
    data: {
      name: `Delete Team Sport ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
      tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
    },
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `delete-team-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Delete Team Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const participant = await prisma.participant.create({
    data: {
      sportId: sport.id,
      name: `Golfer ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
      externalIds: {},
    },
  });
  const eventParticipant = await prisma.sportEventParticipant.create({
    data: { sportEventId: sportEvent.id, participantId: participant.id, isActive: true },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      sportEventId: sportEvent.id,
      name: `Delete Team Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
    },
  });
  const seedEntry = async (squadId: string) => {
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId, entryNumber: 1, name: `Entry ${squadId.slice(0, 6)}`, status: 'ACTIVE' },
    });
    await prisma.contestEntryPick.create({
      data: {
        entryId: entry.id,
        sportEventParticipantId: eventParticipant.id,
        contestFormat: 'ROSTER',
        isAutoPicked: false,
      },
    });
    await prisma.contestEntryStanding.create({
      data: {
        contestId: contest.id,
        contestEntryId: entry.id,
        position: 1,
        countingPickLimit: 1,
        scoredPickCount: 1,
        settledAt: new Date(),
      },
    });
    return entry;
  };
  const ownerEntry = await seedEntry(ownerSquad.id);
  const commissionerEntry = await seedEntry(commissionerSquad.id);

  await prisma.squadOwnerInvitation.create({
    data: {
      leagueId: league.id,
      squadId: ownerSquad.id,
      email: `pending-${suffix}@integration.test`,
      inviteCode: `del${suffix}`,
      status: 'PENDING',
      invitedBy: owner.user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });

  return { league, commissioner, owner, ownerSquad, commissionerSquad, ownerEntry, commissionerEntry };
}

describe('Permanently deleting an inactive team', () => {
  it('removes the team with its entries, picks, standings, owner invitations and ownership rows, and leaves every other team\'s history intact', async () => {
    const prisma = getPrisma();
    const app = getApp();
    const seeded = await seedLeagueWithContestHistory();
    const admin = await createTestUser({ isRootAdmin: true });

    const inactivate = await app.inject({
      method: 'POST',
      url: API_ROUTES.squads.inactivate(seeded.league.id, seeded.ownerSquad.id),
      headers: withoutJsonBodyHeaders(seeded.commissioner.headers),
    });
    expect(inactivate.statusCode).toBe(200);

    const response = await app.inject({
      method: 'DELETE',
      url: API_ROUTES.squads.detail(seeded.league.id, seeded.ownerSquad.id),
      headers: withoutJsonBodyHeaders(admin.headers),
    });

    expect(response.statusCode).toBe(200);
    await expect(prisma.squad.findUnique({ where: { id: seeded.ownerSquad.id } })).resolves.toBeNull();
    await expect(prisma.contestEntry.count({ where: { squadId: seeded.ownerSquad.id } })).resolves.toBe(0);
    await expect(prisma.contestEntryPick.count({ where: { entryId: seeded.ownerEntry.id } })).resolves.toBe(0);
    await expect(prisma.contestEntryStanding.count({ where: { contestEntryId: seeded.ownerEntry.id } })).resolves.toBe(0);
    await expect(prisma.squadOwnerInvitation.count({ where: { squadId: seeded.ownerSquad.id } })).resolves.toBe(0);
    await expect(prisma.squadMembership.count({ where: { squadId: seeded.ownerSquad.id } })).resolves.toBe(0);

    await expect(prisma.squad.findUnique({ where: { id: seeded.commissionerSquad.id } })).resolves.not.toBeNull();
    await expect(prisma.contestEntryPick.count({ where: { entryId: seeded.commissionerEntry.id } })).resolves.toBe(1);
    await expect(prisma.contestEntryStanding.count({ where: { contestEntryId: seeded.commissionerEntry.id } })).resolves.toBe(1);
  });

  it('refuses a commissioner who is not a root admin with 403, leaving the inactive team in place', async () => {
    const prisma = getPrisma();
    const app = getApp();
    const seeded = await seedLeagueWithContestHistory();
    await prisma.squad.update({ where: { id: seeded.ownerSquad.id }, data: { isActive: false } });

    const response = await app.inject({
      method: 'DELETE',
      url: API_ROUTES.squads.detail(seeded.league.id, seeded.ownerSquad.id),
      headers: withoutJsonBodyHeaders(seeded.commissioner.headers),
    });

    expect(response.statusCode).toBe(403);
    await expect(prisma.squad.findUnique({ where: { id: seeded.ownerSquad.id } })).resolves.not.toBeNull();
  });

  it('refuses to delete an active team with 400, so a live team is never wiped', async () => {
    const prisma = getPrisma();
    const app = getApp();
    const seeded = await seedLeagueWithContestHistory();
    const admin = await createTestUser({ isRootAdmin: true });

    const response = await app.inject({
      method: 'DELETE',
      url: API_ROUTES.squads.detail(seeded.league.id, seeded.ownerSquad.id),
      headers: withoutJsonBodyHeaders(admin.headers),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'SQUAD_DELETE_REQUIRES_INACTIVE' } });
    await expect(prisma.contestEntry.count({ where: { squadId: seeded.ownerSquad.id } })).resolves.toBe(1);
  });
});
