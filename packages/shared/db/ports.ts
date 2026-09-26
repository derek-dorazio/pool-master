/**
 * Repository port interfaces.
 *
 * These interfaces define the contract that all database adapters must implement.
 * Services depend on these ports — never on concrete adapter implementations.
 */

import type {
  ActionItem,
  Contest,
  ContestEntry,
  DraftPickHistory,
  DraftSession,
  League,
  LeagueInvitation,
  LeagueMembership,
  Participant,
  ParticipantProviderMapping,
  Season,
  SportConfig,
  Squad,
  SquadMembership,
  SquadOwnerInvitation,
  User,
} from '../domain';

import type { ParticipantStatus, Sport } from '../domain';

// --- Identity ---

/** Filters for the unscoped user read. Access rule A1 restricts that read to rootAdmin. */
export interface UserSearchFilters {
  /**
   * Case-insensitive substring matched against email, username, firstName and lastName.
   * One `search` term across all four, because that is what the management UI offers.
   */
  search?: string;
  isActive?: boolean;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;

  /**
   * Every user, optionally filtered, newest first.
   *
   * **This is the unscoped read — access rule A1 permits it to rootAdmin only.** The port
   * does not enforce that; the route does. Added in #202 because its absence is what sent
   * `admin/user-service.ts` straight to `prisma.user.findMany`, and from there to a
   * hand-rolled result shape (§2y).
   *
   * Not paged, by product decision — see §16, "No paging in the API". Filter to narrow a
   * result set; do not slice it.
   */
  findAll(filters?: UserSearchFilters): Promise<User[]>;

  /**
   * Users holding a `LeagueMembership` in the given league, ordered by name.
   *
   * This is the **scoped** peer read that access rules A4 and A6 require: a league member
   * may read other members' user data, but only indirectly, through the league join. The
   * league is the scope, so it is a parameter rather than a filter — there is no way to
   * call this without one.
   *
   * Returns every membership status. Callers that want active members only filter on the
   * membership, which they must already load to know the role.
   */
  findByLeague(leagueId: string): Promise<User[]>;

  /**
   * `credentials` is a second parameter rather than a field on `User` because the domain
   * `User` deliberately carries no `passwordHash` — it is a secret, and nothing that reads
   * a user should be handed one. Registration still has to set it, so the create operation
   * takes it separately. Omit it for a provider-authenticated account.
   */
  create(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
    credentials?: { passwordHash?: string },
  ): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
}

// --- League ---

/** Filters for the unscoped league read. Access rule A1 restricts that read to rootAdmin. */
export interface LeagueSearchFilters {
  /** Case-insensitive substring matched against the league name. */
  search?: string;
  isActive?: boolean;
}

export interface LeagueRepository {
  findById(id: string): Promise<League | null>;
  findByCode(code: string): Promise<League | null>;

  /**
   * Every league, optionally filtered. **Unscoped — A1 permits it to rootAdmin only.**
   *
   * Not paged, unlike `UserRepository.findAll`: the admin league surface does not page,
   * and adding an unused page parameter would be a shape nobody asked for.
   */
  findAll(filters?: LeagueSearchFilters): Promise<League[]>;

  /**
   * Leagues the user holds a `LeagueMembership` in — the scoped read access rule A2
   * requires, where a member sees only their own leagues.
   *
   * Added in #202. `LeagueService.findByUser` already existed and did this join in
   * application code: `membershipRepo.findByUser` followed by a `findById` per membership,
   * which is N+1 and had to log and skip memberships whose league had vanished. One query
   * cannot produce that orphan case, because the join only returns rows that exist.
   */
  findByUser(userId: string): Promise<League[]>;

  create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt'>): Promise<League>;
  update(id: string, updates: Partial<League>): Promise<League>;
  delete(id: string): Promise<void>;
}

export interface LeagueMembershipRepository {
  findByLeague(leagueId: string): Promise<LeagueMembership[]>;
  findByUser(userId: string): Promise<LeagueMembership[]>;
  findByLeagueAndUser(leagueId: string, userId: string): Promise<LeagueMembership | null>;
  create(membership: Omit<LeagueMembership, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueMembership>;
  update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership>;
  delete(id: string): Promise<void>;
}

export interface SquadRepository {
  findById(id: string): Promise<Squad | null>;
  findByLeague(leagueId: string, includeInactive?: boolean): Promise<Squad[]>;
  /**
   * Resolves a squad by its name within a league. Squad names are unique per league
   * (`@@unique([leagueId, name])`, #202), so this returns at most one row, and it
   * spans active AND inactive squads because the constraint does.
   *
   * The predicate belongs here rather than in a caller scanning `findByLeague`: the
   * database holds the constraint, so the database should answer the question.
   */
  findByLeagueAndName(leagueId: string, name: string): Promise<Squad | null>;
  create(squad: Omit<Squad, 'id' | 'createdAt' | 'updatedAt'>): Promise<Squad>;
  update(id: string, updates: Partial<Squad>): Promise<Squad>;
  delete(id: string): Promise<void>;
}

export interface SquadMembershipRepository {
  findBySquad(squadId: string, includeInactive?: boolean): Promise<SquadMembership[]>;
  findBySquadAndUser(squadId: string, userId: string): Promise<SquadMembership | null>;
  findByLeagueAndUser(leagueId: string, userId: string): Promise<SquadMembership | null>;
  create(
    membership: Omit<SquadMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SquadMembership>;
  update(id: string, updates: Partial<SquadMembership>): Promise<SquadMembership>;
  delete(id: string): Promise<void>;
}

export interface SquadOwnerInvitationRepository {
  findById(id: string): Promise<SquadOwnerInvitation | null>;
  findByLeague(leagueId: string): Promise<SquadOwnerInvitation[]>;
  findByCode(inviteCode: string): Promise<SquadOwnerInvitation | null>;
  findPendingByLeagueAndEmail(
    leagueId: string,
    email: string,
  ): Promise<SquadOwnerInvitation | null>;
  create(
    invitation: Omit<SquadOwnerInvitation, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SquadOwnerInvitation>;
  update(id: string, updates: Partial<SquadOwnerInvitation>): Promise<SquadOwnerInvitation>;
  delete(id: string): Promise<void>;
}

export interface LeagueInvitationRepository {
  findById(id: string): Promise<LeagueInvitation | null>;
  findByLeague(leagueId: string): Promise<LeagueInvitation[]>;
  findByCode(inviteCode: string): Promise<LeagueInvitation | null>;
  findByEmail(leagueId: string, email: string): Promise<LeagueInvitation | null>;
  create(invitation: Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueInvitation>;
  update(id: string, updates: Partial<LeagueInvitation>): Promise<LeagueInvitation>;
  delete(id: string): Promise<void>;
}

// --- Sport & Participant ---

export interface SportRepository {
  findById(id: string): Promise<SportConfig | null>;
  findAll(): Promise<SportConfig[]>;
  create(sport: Omit<SportConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SportConfig>;
}

export interface SeasonRepository {
  findById(id: string): Promise<Season | null>;
  findBySport(sportId: string): Promise<Season[]>;
  create(season: Omit<Season, 'id' | 'createdAt' | 'updatedAt'>): Promise<Season>;
}

export interface ParticipantSearchFilters {
  sport?: Sport;
  sportId?: string;
  status?: ParticipantStatus[];
  position?: string[];
  teamAffiliation?: string[];
  nationality?: string[];
}

export interface ParticipantRepository {
  findById(id: string): Promise<Participant | null>;
  findBySport(sportId: string): Promise<Participant[]>;
  findByExternalId(providerId: string, externalId: string): Promise<Participant | null>;
  search(query: string, filters: ParticipantSearchFilters, limit?: number, offset?: number): Promise<{ participants: Participant[]; total: number }>;
  create(participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Participant>;
  createMany(participants: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<number>;
  update(id: string, updates: Partial<Participant>): Promise<Participant>;
}

export interface ParticipantProviderMappingRepository {
  findByProvider(providerId: string, externalId: string): Promise<ParticipantProviderMapping | null>;
  findByParticipant(participantId: string): Promise<ParticipantProviderMapping[]>;
  create(mapping: Omit<ParticipantProviderMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParticipantProviderMapping>;
}

// --- Contest ---

export interface ContestRepository {
  findById(id: string): Promise<Contest | null>;
  findByLeague(leagueId: string): Promise<Contest[]>;
  create(contest: Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contest>;
  update(id: string, updates: Partial<Contest>): Promise<Contest>;
  delete(id: string): Promise<void>;
}

// --- Entries & Picks ---

export interface ContestEntryRepository {
  findById(id: string): Promise<ContestEntry | null>;
  findByContest(contestId: string): Promise<ContestEntry[]>;
  findBySquad(squadId: string): Promise<ContestEntry[]>;
  create(entry: Omit<ContestEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContestEntry>;
  update(id: string, updates: Partial<ContestEntry>): Promise<ContestEntry>;
  delete(id: string): Promise<void>;
}

// --- Draft Session (Snake Draft only) ---

export interface DraftSessionRepository {
  findById(id: string): Promise<DraftSession | null>;
  findByContest(contestId: string): Promise<DraftSession | null>;
  create(session: Omit<DraftSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<DraftSession>;
  update(id: string, updates: Partial<DraftSession>): Promise<DraftSession>;
  getPickHistories(sessionId: string): Promise<DraftPickHistory[]>;
  addPickHistory(
    pickHistory: Omit<DraftPickHistory, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<DraftPickHistory>;
}

// --- Commissioner Action Items ---

export interface ActionItemRepository {
  findByLeague(leagueId: string, includeResolved?: boolean): Promise<ActionItem[]>;
  findUnresolved(leagueId: string): Promise<ActionItem[]>;
  create(item: Omit<ActionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ActionItem>;
  resolve(id: string): Promise<ActionItem>;
  delete(id: string): Promise<void>;
}
