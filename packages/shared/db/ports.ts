/**
 * Repository port interfaces.
 *
 * These interfaces define the contract that all database adapters must implement.
 * Services depend on these ports — never on concrete adapter implementations.
 */

import type {
  Contest,
  ContestEntry,
  ContestEntryMatchPrediction,
  ContestEntryStatus,
  PredictedChoice,
  PredictedResult,
  League,
  LeaguePlan,
  LeagueInvitation,
  LeagueMembership,
  Participant,
  ParticipantProviderMapping,
  Squad,
  SquadMembership,
  SquadOwnerInvitation,
  User, DateFormat, ParticipantStatus, TimeFormat
} from '../domain';

import type { ParticipantMatchQuery } from './sport-catalog-ports';

// --- Identity ---

/** Filters for the unscoped user read. Access rule A1 restricts that read to rootAdmin. */
export interface UserSearchFilters {
  /**
   * Case-insensitive substring matched against email, username, firstName and lastName.
   * One `search` term across all four, because that is what the management UI offers.
   */
  search?: string;
  isActive?: boolean;
  /** Only root admins (true) or only everyone else (false). */
  isRootAdmin?: boolean;
}

/**
 * The writable fields of a `User`, as an update.
 *
 * `passwordHash` is absent by design — it is a secret, set through `create`'s separate
 * `credentials` parameter and rotated by the password operations, never by a general update.
 * `email` and `username` are here because they are ordinary profile fields; uniqueness is
 * the caller's check, via `findHolderOtherThan`.
 */
export interface UserUpdate {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  isRootAdmin?: boolean;
  /** `null` clears it. */
  timezone?: string | null;
  /** `null` clears it. */
  locale?: string | null;
  /** `null` clears it. */
  timeFormat?: TimeFormat | null;
  /** `null` clears it. */
  dateFormat?: DateFormat | null;
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
   * Resolves a user by an identifier that may be either their email or their username.
   *
   * Login accepts either, so "is this string taken" is one question rather than two. Each
   * column is `@unique` on its own, so one account's email and another's username can both
   * match (two renames racing make it); this returns one of them. Written out by hand in FOUR
   * places before #202: `auth-service`'s login, its registration collision check, and
   * `account/service`'s two near-identical email- and username-availability checks.
   */
  findByIdentifier(identifier: string): Promise<User | null>;

  /**
   * A user other than `exceptUserId` holding `identifier` as their email or username: the
   * availability check for a rename. Not `findByIdentifier` and an id comparison, which can be
   * handed the subject's own row when another account also matches (#1012).
   */
  findHolderOtherThan(identifier: string, exceptUserId: string): Promise<User | null>;

  /**
   * How many ACTIVE users hold `isRootAdmin`.
   *
   * Exists so the platform always keeps at least one active root admin, so administering it never depends on someone first reactivating an account.
   * Inactive root admins do not count: counting them let the only active root admin disable
   * or demote themselves while an inactive one remained.
   */
  countActiveRootAdmins(): Promise<number>;

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

  /**
   * Applies the given fields. A field left out is untouched; a nullable field set to `null`
   * is CLEARED.
   *
   * That distinction is why this takes `UserUpdate` rather than `Partial<User>`. On the
   * domain type the optional preferences are `string | undefined`, so `Partial<User>` has no
   * way to say "clear my timezone" — and clearing them is a real operation the preferences
   * surface offers.
   */
  update(id: string, updates: UserUpdate): Promise<User>;
}

// --- League ---

/** Filters for the unscoped league read. Access rule A1 restricts that read to rootAdmin. */
export interface LeagueSearchFilters {
  /** Case-insensitive substring matched against the league name. */
  search?: string;
  isActive?: boolean;
}

/** One logged move of a league to another plan (#945); `changedById` is null for the end of a gift. */
export interface LeaguePlanChange {
  fromPlan: LeaguePlan;
  toPlan: LeaguePlan;
  changedById: string | null;
  changedAt: Date;
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
   * Leagues the user holds an ACTIVE `LeagueMembership` in — the scoped read access rule A2
   * requires, where a member sees only their own leagues. A removed member's INACTIVE row
   * does not count.
   *
   * Added in #202. `LeagueService.findByUser` already existed and did this join in
   * application code: `membershipRepo.findByUser` followed by a `findById` per membership,
   * which is N+1 and had to log and skip memberships whose league had vanished. One query
   * cannot produce that orphan case, because the join only returns rows that exist.
   */
  findByUser(userId: string): Promise<League[]>;

  /**
   * The points table starts STANDARD, the plan PREMIUM renewing six months from now, no sport
   * league muted and event emails per event, from the database defaults.
   */
  create(league: Omit<League, 'id' | 'createdAt' | 'updatedAt' | 'cupPointsScale' | 'cupCustomPoints' | 'hallOfLameVisible' | 'plan' | 'planRenewsAt' | 'mutedSportLeagueIds' | 'eventEmailDelivery'>): Promise<League>;
  update(id: string, updates: Partial<League>): Promise<League>;

  /**
   * Moves the league to `change.toPlan` and logs who moved it from which plan (#945), in one
   * transaction, so the plan never changes without its log row. Returns null, changing and
   * logging nothing, when the league is no longer on `change.fromPlan`.
   */
  changePlan(leagueId: string, change: { fromPlan: LeaguePlan; toPlan: LeaguePlan; changedById: string }): Promise<League | null>;

  /**
   * Moves the league's renewal date out to `change.renewsAt` and logs who moved it from which
   * date (#986), in one transaction. A date already at or past `renewsAt` is left alone and
   * nothing is logged, so an extension never shortens a gift. With `restorePlan`, a league still on
   * its `fromPlan` also moves to its `toPlan`, logged as a plan change by `changedById` (#1026).
   * Returns null for a missing league.
   */
  extendPlanRenewal(
    leagueId: string,
    change: { renewsAt: Date; changedById: string; restorePlan?: { fromPlan: LeaguePlan; toPlan: LeaguePlan } },
  ): Promise<League | null>;

  /** The league's latest plan change, or null when its plan never changed. */
  findLastPlanChange(leagueId: string): Promise<LeaguePlanChange | null>;

  /**
   * The same for every league whose gift still runs at `change.now` (its renewal date is later),
   * in one transaction: each one moved is logged. Returns how many moved.
   */
  extendRunningPlanRenewals(change: { renewsAt: Date; now: Date; changedById: string }): Promise<number>;

  /**
   * Every active league not on Free whose renewal date is after `after` and at or before
   * `through`, soonest first: the leagues whose commissioners hear their preview period is ending (#986).
   */
  findPlansEndingBetween(after: Date, through: Date): Promise<League[]>;

  /**
   * Moves every league not on Free whose renewal date is at or before `now` to Free (#986), each
   * logged as a plan change made by no one, in one transaction. Returns the leagues moved and the
   * plan each was on; run again, it finds none.
   */
  moveEndedPlansToFree(now: Date): Promise<Array<{ leagueId: string; fromPlan: LeaguePlan }>>;
}

export interface LeagueMembershipRepository {
  findByLeague(leagueId: string): Promise<LeagueMembership[]>;
  findByUser(userId: string): Promise<LeagueMembership[]>;

  /**
   * Active member counts for several leagues at once, keyed by league id. Leagues with no
   * active members are absent from the map rather than present with 0.
   *
   * One grouped query for a list, instead of a count per row. Added in #202 so the admin
   * league list can be assembled from `LeagueRepository.findAll` plus this, rather than
   * from one hand-written `findMany` with nested `select`s — which is what produced the
   * shape that service invented (§2y).
   */
  countActiveByLeagues(leagueIds: string[]): Promise<Map<string, number>>;
  findByLeagueAndUser(leagueId: string, userId: string): Promise<LeagueMembership | null>;
  /**
   * Every league's active memberships that joined at or after `since`, in the order they joined:
   * the next day's "New member joined" email lists a busy day's joins (#903).
   */
  findActiveJoinedSince(since: Date): Promise<LeagueMembership[]>;
  create(membership: Omit<LeagueMembership, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueMembership>;
  update(id: string, updates: Partial<LeagueMembership>): Promise<LeagueMembership>;
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
}

export interface SquadMembershipRepository {
  findBySquad(squadId: string, includeInactive?: boolean): Promise<SquadMembership[]>;
  /**
   * The memberships of several squads at once, join order then id. One grouped query instead of
   * one per squad — added in #324 so a selection room can resolve every entry's owner without a
   * query per entry, the same reason `countActiveByLeagues` exists above.
   */
  findBySquads(squadIds: readonly string[], includeInactive?: boolean): Promise<SquadMembership[]>;
  findBySquadAndUser(squadId: string, userId: string): Promise<SquadMembership | null>;
  findByLeagueAndUser(leagueId: string, userId: string): Promise<SquadMembership | null>;
  create(
    membership: Omit<SquadMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SquadMembership>;
  update(id: string, updates: Partial<SquadMembership>): Promise<SquadMembership>;
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
}

/**
 * The repositories a league-membership change writes through, all bound to one transaction.
 *
 * Ending a membership touches up to four tables: the league membership, the squad membership,
 * the squad's `isActive`, and the squad's pending co-owner invitations. They commit together or
 * not at all, so a failure part way never leaves a member removed while their team keeps open
 * invitations, or a team inactive while it is being handed to a new owner.
 */
export interface MembershipRepositories {
  leagueMemberships: LeagueMembershipRepository;
  squads: SquadRepository;
  squadMemberships: SquadMembershipRepository;
  squadOwnerInvitations: SquadOwnerInvitationRepository;
}

/** Runs `work` in one transaction: every write it makes commits when it resolves, none if it throws. */
export interface MembershipTransaction {
  run<T>(work: (repos: MembershipRepositories) => Promise<T>): Promise<T>;
}

export interface LeagueInvitationRepository {
  findById(id: string): Promise<LeagueInvitation | null>;
  findByLeague(leagueId: string): Promise<LeagueInvitation[]>;
  findByCode(inviteCode: string): Promise<LeagueInvitation | null>;
  findByEmail(leagueId: string, email: string): Promise<LeagueInvitation | null>;
  create(invitation: Omit<LeagueInvitation, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeagueInvitation>;
  update(id: string, updates: Partial<LeagueInvitation>): Promise<LeagueInvitation>;
}

// --- Sport & Participant ---

export interface ParticipantSearchFilters {
  sportId?: string;
  status?: ParticipantStatus;
}

export interface ParticipantRepository {
  findById(id: string): Promise<Participant | null>;
  findByIds(ids: readonly string[]): Promise<Participant[]>;
  /** Whole result, narrowed by the query and filters — never paged (§16). Ordered by name. */
  search(query: string, filters: ParticipantSearchFilters): Promise<Participant[]>;
  /** Candidates for an upload row within one sport; exact match on each identifier given. */
  findMatching(sportId: string, query: ParticipantMatchQuery): Promise<Participant[]>;
  create(participant: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Participant>;
  update(id: string, updates: Partial<Participant>): Promise<Participant>;
}

export interface ParticipantProviderMappingRepository {
  findByParticipant(participantId: string): Promise<ParticipantProviderMapping[]>;
  /** Every mapping a provider has for these of its identifiers. */
  findByProviderExternalIds(providerId: string, externalIds: readonly string[]): Promise<ParticipantProviderMapping[]>;
  /**
   * Binds a provider identity to a participant. A provider identity maps to one participant,
   * so an identity already bound elsewhere moves to this one.
   */
  bind(mapping: Omit<ParticipantProviderMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParticipantProviderMapping>;
}

// --- Contest ---

/**
 * The one port for `Contest` (#247 merged the contest-management copy into it). `create` is
 * called by the one creation path, `ContestManagementService.createContest` (#245).
 */
export interface ContestRepository {
  findById(id: string): Promise<Contest | null>;
  findByLeague(leagueId: string): Promise<Contest[]>;
  /** The league's contests open for entries, oldest first, by id and name only: the welcome email lists them (#903). */
  findOpenByLeague(leagueId: string): Promise<Array<Pick<Contest, 'id' | 'name'>>>;
  /**
   * The different sports leagues of the league's contests of one season (#947), drafts included
   * (a deleted contest is gone, so it no longer counts): what the plan's sports leagues a year counts.
   */
  findSportLeagueIdsBySeason(leagueId: string, seasonYear: number): Promise<string[]>;
  /** The event's contests, oldest first, optionally narrowed to or away from some statuses. */
  findBySportEvent(sportEventId: string, filter?: ContestStatusFilter): Promise<Contest[]>;
  /** Every contest in one of `statuses`, oldest first, across leagues: the entry reminders' sweep reads it (#845). */
  findByStatuses(statuses: readonly Contest['status'][]): Promise<Contest[]>;
  /**
   * Creates the contest unless the league's plan has no room for its sports league in its season
   * (#947): under the league's row lock, the season's sports leagues are counted as
   * `findSportLeagueIdsBySeason` does, so two contests racing for the last one cannot both get it.
   */
  create(contest: ContestCreate, limits: ContestSeasonLimits): Promise<ContestCreateResult>;
  update(id: string, updates: ContestUpdate): Promise<Contest>;
  /**
   * Moves the contest to `seasonYear` (#841: a new first event of another year), under the same
   * league row lock and count as `create`, unless that season has no room for its sports league.
   */
  moveToSeason(id: string, seasonYear: number, limits: ContestSeasonLimits): Promise<ContestSeasonMoveResult>;
  /**
   * Sets the events the contest covers to `sportEventIds`, in that order (#713). In one
   * transaction under the contest row lock: each entry gets a DRAFT status row for every added
   * event, and loses its status row and its picks (roster and game picks) on every removed one.
   */
  replaceSportEvents(id: string, sportEventIds: readonly string[]): Promise<void>;
  /**
   * Moves a contest to `to` (with its start or end time), but only while it is in one of the
   * `from` statuses. Returns whether this call made the change: a guarded single write, so two
   * runs of the same event transition (a provider re-sending it) cannot both apply it.
   */
  transitionStatus(id: string, transition: ContestStatusTransition): Promise<boolean>;
  /**
   * Sets how much the contest counts toward its cup and the championship (#841), but only while
   * it is in one of `whileIn`: a guarded single write, so it cannot land after settlement has
   * moved the contest to COMPLETED. Returns whether this call made the change.
   */
  setCupWeight(id: string, cupWeight: Contest['cupWeight'], whileIn: readonly Contest['status'][]): Promise<boolean>;
  /** Deletes a contest with its entries, picks, selection state, configuration and rules. */
  delete(id: string): Promise<void>;
}

export interface ContestStatusFilter {
  statuses?: readonly Contest['status'][];
  excludeStatuses?: readonly Contest['status'][];
}

export interface ContestStatusTransition {
  from: readonly Contest['status'][];
  to: Contest['status'];
  openedAt?: Date;
  startsAt?: Date;
  endsAt?: Date;
}

/** A new contest; `sportEventIds` are its events in sequence order. */
export type ContestCreate = Pick<
  Contest,
  'leagueId' | 'sportEventIds' | 'name' | 'status' | 'contestFormat' | 'selectionType' | 'squaresGameMatchId' | 'seasonYear'
>;

/**
 * What can change on a contest row itself; its events change through `replaceSportEvents` and
 * its season through `moveToSeason`.
 */
export type ContestUpdate = Partial<Pick<Contest, 'name' | 'status' | 'startsAt' | 'endsAt'>>;

/**
 * The plan's sports leagues a year (#947) for a contest's season, with the contest's own sports
 * league, which the season may already use; null is no limit.
 */
export type ContestSeasonLimits =
  | { sportLeaguesPerYear: null }
  | { sportLeaguesPerYear: number; sportLeagueId: string };

/** A season without room: its cap, and how many sports leagues its contests already use. */
export interface ContestSeasonFull {
  status: 'sportsLeagueLimitReached';
  sportLeaguesPerYear: number;
  sportLeagueCount: number;
}

export type ContestCreateResult =
  | { status: 'created'; contest: Contest }
  | ContestSeasonFull;

export type ContestSeasonMoveResult =
  | { status: 'moved' }
  | ContestSeasonFull;

/** A new entry; it is born a DRAFT in every event of its contest. */
export type ContestEntryCreate = Pick<ContestEntry, 'contestId' | 'squadId' | 'entryNumber' | 'name' | 'tiebreakerValue'>;

// --- Entries & Picks ---

/** An entry with its squad's name: every contest read shows whose entry it is. */
export interface ContestEntryWithSquad extends ContestEntry {
  squadName: string;
}

/**
 * An entry write the contest's draw may have closed (#644). Creating and deleting an entry take
 * the contest row lock, as recording a draw does, so a write and a draw never interleave: the
 * one that runs second sees the other.
 */
export type ContestEntryCreateResult =
  | { status: 'created'; entry: ContestEntry }
  | { status: 'contestDrawn' }
  /** The contest already holds its most entries (#947), drafts included: the cap that applied. */
  | { status: 'contestFull'; entriesPerContest: number };

/** What an entry write is checked against besides the draw: the contest's entry cap (#947, #980). */
export interface ContestEntryCreateLimits {
  /**
   * The most entries the contest may hold, drafts included, or null for no limit, given the
   * contest's expansion (its highest band, or null for none). The adapter reads the expansion
   * under the contest's lock and asks this, so an expansion landing meanwhile is never missed.
   */
  entriesPerContest: (expandedTo: number | null) => number | null;
}
export type ContestEntryDeleteResult = { status: 'deleted' } | { status: 'contestDrawn' };

export interface ContestEntryRepository {
  findByIdWithSquad(id: string): Promise<ContestEntryWithSquad | null>;
  findByContest(contestId: string): Promise<ContestEntry[]>;
  /**
   * In entry-number order, then creation order. `submittedFor` keeps the entries that submitted
   * that event alone (#481, per event since #713).
   */
  findByContestWithSquad(contestId: string, options?: { submittedFor?: string }): Promise<ContestEntryWithSquad[]>;
  findBySquad(squadId: string): Promise<ContestEntry[]>;
  /** Every entry each contest holds, drafts included, by contest id (#972); 0 for one with none. */
  countByContests(contestIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Creates the entry with a DRAFT status row for each of its contest's events (#713). The
   * contest's entries are counted under its row lock (#947), so two entries taking the last place
   * at once cannot both get in.
   */
  create(entry: ContestEntryCreate, limits: ContestEntryCreateLimits): Promise<ContestEntryCreateResult>;
  update(id: string, updates: Partial<Pick<ContestEntry, 'name' | 'tiebreakerValue'>>): Promise<ContestEntry>;
  /**
   * Sets the entry's status for one event of its contest (#713), stamping `submittedAt` when it
   * becomes SUBMITTED and clearing it when it returns to DRAFT. Answers with the entry.
   */
  setEventStatus(id: string, sportEventId: string, status: ContestEntryStatus, at: Date): Promise<ContestEntry>;
  delete(id: string): Promise<ContestEntryDeleteResult>;
}

/** An entry's place in a live standings email (#877); null for an entry not ranked yet. */
export interface StandingsEmailPosition {
  contestEntryId: string;
  position: number | null;
}

/**
 * Each entry's place in the last live standings email of its contest (#877), which the next
 * one's movement is measured from.
 */
export interface StandingsEmailPositionRepository {
  /** By entry id: the entries of the contest that have a recorded place. */
  findByContest(contestId: string): Promise<Map<string, number>>;
  record(positions: readonly StandingsEmailPosition[]): Promise<void>;
}

/** One game's pick as it is saved (#716): replaces the entry's pick on that game, if any. */
export type ContestEntryMatchPredictionWrite = PredictedChoice & {
  sportEventMatchId: string;
  confidence: number | null;
};

/** A change to an entry's picks for one event's games, written all or none. */
export interface ContestEntryMatchPredictionSave {
  contestEntryId: string;
  sportEventId: string;
  saves: readonly ContestEntryMatchPredictionWrite[];
  /** Games whose pick is removed. */
  clearedMatchIds: readonly string[];
  /** The entry's status for the event after the change, when it changes; stamped as `setEventStatus` does. */
  eventStatus: ContestEntryStatus | null;
  /** The entry's tiebreaker guess for the event after the change, when it changes (#717): kept on its row for the event. */
  tiebreakerValue?: number | null;
  at: Date;
}

/** A pick read across several events (#719): which event its game is in, and the participant its field row stands for (null for a tie pick, #792). */
export type ContestEntrySeasonPrediction = ContestEntryMatchPrediction & { sportEventId: string } & (
  | { predictedResult: typeof PredictedResult.TEAM; participantId: string }
  | { predictedResult: typeof PredictedResult.TIE; participantId: null }
);

export interface ContestEntryMatchPredictionRepository {
  /** The entry's picks on the event's games. */
  findByEntryAndEvent(contestEntryId: string, sportEventId: string): Promise<ContestEntryMatchPrediction[]>;
  /** Several entries' picks on the event's games, in game order: a leaderboard's or settlement's read. */
  findByEntriesAndEvent(contestEntryIds: readonly string[], sportEventId: string): Promise<ContestEntryMatchPrediction[]>;
  /** Several entries' picks on several events' games, each with its event and team: a survivor season's read (#719). */
  findByEntriesAndEvents(contestEntryIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestEntrySeasonPrediction[]>;
  /** Whether any entry, in any contest, has a pick on the game: its spread is then fixed (#720). */
  hasAnyOnMatch(sportEventMatchId: string): Promise<boolean>;
  save(change: ContestEntryMatchPredictionSave): Promise<void>;
}

