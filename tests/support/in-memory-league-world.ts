/**
 * An in-memory league world: users, leagues, league and squad memberships, squads, and both
 * invitation kinds, behind the same ports the Prisma adapters implement.
 *
 * For service tests that assert what a use case leaves stored (who is a member, which squad is
 * active, which invitation was accepted) rather than which repository calls it made. Each read
 * mirrors its adapter's filter, because a fake that is more forgiving than the database hides
 * exactly the defects these tests are for:
 *
 *   - `memberships.findByLeague` / `findByUser` / `countActiveByLeagues` → ACTIVE rows only
 *   - `memberships.findByLeagueAndUser` → any status (unique on league + user)
 *   - `leagues.findByUser` → leagues where the user holds an ACTIVE membership
 *   - `squads.findByLeague` → active squads unless `includeInactive`
 *   - `squadMemberships.findBySquad(s)` → ACTIVE rows unless `includeInactive`
 *   - `users.findByLeague` → users with a membership of ANY status, as the port documents
 *   - `leagueInvitations.findByEmail` / `ownerInvitations.findPendingByLeagueAndEmail` → PENDING
 *
 * The Prisma adapters behind these ports are tested against Postgres in the integration suite.
 */

import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  DomainEntity,
  League,
  LeagueInvitation,
  LeagueMembership,
  Squad,
  SquadMembership,
  SquadOwnerInvitation,
  User,
} from '@poolmaster/shared/domain';
import {
  InvitationStatus,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';

type NewRow<T extends DomainEntity> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

class Table<T extends DomainEntity> {
  readonly rows = new Map<string, T>();
  private sequence = 0;

  constructor(private readonly prefix: string) {}

  insert(row: NewRow<T>): T {
    this.sequence += 1;
    const now = new Date();
    const stored = { ...row, id: `${this.prefix}-${this.sequence}`, createdAt: now, updatedAt: now } as T;
    this.rows.set(stored.id, stored);
    return { ...stored };
  }

  patch(id: string, updates: Partial<T>): T {
    const current = this.rows.get(id);
    if (!current) {
      throw new Error(`${this.prefix} ${id} does not exist`);
    }
    const defined = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as Partial<T>;
    const next = { ...current, ...defined, id, updatedAt: new Date() };
    this.rows.set(id, next);
    return { ...next };
  }

  get(id: string): T | null {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  where(predicate: (row: T) => boolean): T[] {
    return [...this.rows.values()].filter(predicate).map((row) => ({ ...row }));
  }

  remove(id: string): void {
    this.rows.delete(id);
  }
}

export interface InMemoryLeagueWorld {
  users: UserRepository;
  leagues: LeagueRepository;
  memberships: LeagueMembershipRepository;
  squads: SquadRepository;
  squadMemberships: SquadMembershipRepository;
  leagueInvitations: LeagueInvitationRepository;
  ownerInvitations: SquadOwnerInvitationRepository;
  tables: {
    users: Table<User>;
    leagues: Table<League>;
    memberships: Table<LeagueMembership>;
    squads: Table<Squad>;
    squadMemberships: Table<SquadMembership>;
    leagueInvitations: Table<LeagueInvitation>;
    ownerInvitations: Table<SquadOwnerInvitation>;
  };
  /** Seeds a user with a first and last name, so default-squad provisioning can name a team. */
  addUser(overrides?: Partial<NewRow<User>>): User;
  addLeague(overrides?: Partial<NewRow<League>>): League;
  /** Seeds an ACTIVE league membership, and an active squad the user owns alone unless `squadId` is given. */
  addMember(input: {
    league: League;
    user: User;
    role?: LeagueRole;
    squadId?: string;
  }): { membership: LeagueMembership; squad: Squad };
  membershipOf(leagueId: string, userId: string): LeagueMembership | null;
  squadMembershipOf(leagueId: string, userId: string): SquadMembership | null;
}

export function inMemoryLeagueWorld(): InMemoryLeagueWorld {
  const users = new Table<User>('user');
  const leagues = new Table<League>('league');
  const memberships = new Table<LeagueMembership>('membership');
  const squads = new Table<Squad>('squad');
  const squadMemberships = new Table<SquadMembership>('squad-membership');
  const leagueInvitations = new Table<LeagueInvitation>('league-invitation');
  const ownerInvitations = new Table<SquadOwnerInvitation>('owner-invitation');

  const isActiveMembership = (row: LeagueMembership) => row.status === LeagueMembershipStatus.ACTIVE;
  const isActiveSquadMembership = (row: SquadMembership) => row.status === SquadMembershipStatus.ACTIVE;
  const one = <T>(rows: T[]): T | null => rows[0] ?? null;

  const userRepo: UserRepository = {
    findById: async (id) => users.get(id),
    findByEmail: async (email) => one(users.where((row) => row.email === email)),
    findAll: async () => users.where(() => true),
    findByLeague: async (leagueId) => {
      const userIds = new Set(memberships.where((row) => row.leagueId === leagueId).map((row) => row.userId));
      return users.where((row) => userIds.has(row.id));
    },
    findByIdentifier: async (identifier) =>
      one(users.where((row) => row.email === identifier || row.username === identifier)),
    countActiveRootAdmins: async () =>
      users.where((row) => row.isRootAdmin === true && row.isActive).length,
    create: async (row) => users.insert(row),
    // Account edits are outside the league world; no league use case writes a user.
    update: async () => {
      throw new Error('in-memory league world does not model user updates');
    },
  };

  const leagueRepo: LeagueRepository = {
    findById: async (id) => leagues.get(id),
    findByCode: async (code) => one(leagues.where((row) => row.leagueCode === code)),
    findAll: async (filters = {}) => {
      const search = filters.search?.trim().toLowerCase();
      return leagues.where((row) =>
        (filters.isActive === undefined || row.isActive === filters.isActive)
        && (!search || row.name.toLowerCase().includes(search)));
    },
    findByUser: async (userId) => {
      const leagueIds = new Set(
        memberships.where((row) => row.userId === userId && isActiveMembership(row)).map((row) => row.leagueId),
      );
      return leagues.where((row) => leagueIds.has(row.id));
    },
    create: async (row) => leagues.insert(row),
    update: async (id, updates) => leagues.patch(id, updates),
  };

  const membershipRepo: LeagueMembershipRepository = {
    findByLeague: async (leagueId) =>
      memberships.where((row) => row.leagueId === leagueId && isActiveMembership(row)),
    findByUser: async (userId) =>
      memberships.where((row) => row.userId === userId && isActiveMembership(row)),
    countActiveByLeagues: async (leagueIds) => {
      const counts = new Map<string, number>();
      for (const row of memberships.where((item) => leagueIds.includes(item.leagueId) && isActiveMembership(item))) {
        counts.set(row.leagueId, (counts.get(row.leagueId) ?? 0) + 1);
      }
      return counts;
    },
    findByLeagueAndUser: async (leagueId, userId) =>
      one(memberships.where((row) => row.leagueId === leagueId && row.userId === userId)),
    create: async (row) => {
      if (memberships.where((item) => item.leagueId === row.leagueId && item.userId === row.userId).length) {
        throw new Error(`Unique constraint: membership for ${row.userId} in ${row.leagueId} exists`);
      }
      return memberships.insert(row);
    },
    update: async (id, updates) => memberships.patch(id, updates),
  };

  const squadRepo: SquadRepository = {
    findById: async (id) => squads.get(id),
    findByLeague: async (leagueId, includeInactive = false) =>
      squads.where((row) => row.leagueId === leagueId && (includeInactive || row.isActive)),
    findByLeagueAndName: async (leagueId, name) =>
      one(squads.where((row) => row.leagueId === leagueId && row.name === name)),
    create: async (row) => squads.insert(row),
    update: async (id, updates) => squads.patch(id, updates),
  };

  const squadMembershipRepo: SquadMembershipRepository = {
    findBySquad: async (squadId, includeInactive = false) =>
      squadMemberships.where((row) => row.squadId === squadId && (includeInactive || isActiveSquadMembership(row))),
    findBySquads: async (squadIds, includeInactive = false) =>
      squadMemberships.where((row) => squadIds.includes(row.squadId) && (includeInactive || isActiveSquadMembership(row))),
    findBySquadAndUser: async (squadId, userId) =>
      one(squadMemberships.where((row) => row.squadId === squadId && row.userId === userId)),
    findByLeagueAndUser: async (leagueId, userId) =>
      one(squadMemberships.where((row) => row.leagueId === leagueId && row.userId === userId)),
    create: async (row) => {
      if (squadMemberships.where((item) => item.leagueId === row.leagueId && item.userId === row.userId).length) {
        throw new Error(`Unique constraint: squad membership for ${row.userId} in ${row.leagueId} exists`);
      }
      return squadMemberships.insert(row);
    },
    update: async (id, updates) => squadMemberships.patch(id, updates),
  };

  const leagueInvitationRepo: LeagueInvitationRepository = {
    findById: async (id) => leagueInvitations.get(id),
    findByLeague: async (leagueId) => leagueInvitations.where((row) => row.leagueId === leagueId),
    findByCode: async (code) => one(leagueInvitations.where((row) => row.inviteCode === code)),
    findByEmail: async (leagueId, email) =>
      one(leagueInvitations.where((row) =>
        row.leagueId === leagueId && row.email === email && row.status === InvitationStatus.PENDING)),
    create: async (row) => leagueInvitations.insert(row),
    update: async (id, updates) => leagueInvitations.patch(id, updates),
  };

  const ownerInvitationRepo: SquadOwnerInvitationRepository = {
    findById: async (id) => ownerInvitations.get(id),
    findByLeague: async (leagueId) => ownerInvitations.where((row) => row.leagueId === leagueId),
    findByCode: async (code) => one(ownerInvitations.where((row) => row.inviteCode === code)),
    findPendingByLeagueAndEmail: async (leagueId, email) =>
      one(ownerInvitations.where((row) =>
        row.leagueId === leagueId && row.email === email && row.status === SquadOwnerInvitationStatus.PENDING)),
    create: async (row) => ownerInvitations.insert(row),
    update: async (id, updates) => ownerInvitations.patch(id, updates),
  };

  let userSequence = 0;
  let leagueSequence = 0;

  return {
    users: userRepo,
    leagues: leagueRepo,
    memberships: membershipRepo,
    squads: squadRepo,
    squadMemberships: squadMembershipRepo,
    leagueInvitations: leagueInvitationRepo,
    ownerInvitations: ownerInvitationRepo,
    tables: { users, leagues, memberships, squads, squadMemberships, leagueInvitations, ownerInvitations },
    addUser(overrides = {}) {
      userSequence += 1;
      return users.insert({
        email: `player${userSequence}@example.com`,
        username: `player${userSequence}`,
        firstName: 'Player',
        lastName: `Number${userSequence}`,
        isActive: true,
        ...overrides,
      });
    },
    addLeague(overrides = {}) {
      leagueSequence += 1;
      return leagues.insert({
        leagueCode: `LEAGUE${leagueSequence}`,
        name: `League ${leagueSequence}`,
        isActive: true,
        iconKey: LeagueIconKey.TROPHY,
        ...overrides,
      });
    },
    addMember({ league, user, role = LeagueRole.MEMBER, squadId }) {
      const membership = memberships.insert({
        leagueId: league.id,
        userId: user.id,
        role,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      const squad = squadId
        ? squads.get(squadId)!
        : squads.insert({
          leagueId: league.id,
          createdBy: user.id,
          name: `${user.firstName} ${user.lastName}`,
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          isActive: true,
        });
      squadMemberships.insert({
        squadId: squad.id,
        leagueId: league.id,
        userId: user.id,
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      return { membership, squad };
    },
    membershipOf: (leagueId, userId) =>
      one(memberships.where((row) => row.leagueId === leagueId && row.userId === userId)),
    squadMembershipOf: (leagueId, userId) =>
      one(squadMemberships.where((row) => row.leagueId === leagueId && row.userId === userId)),
  };
}
