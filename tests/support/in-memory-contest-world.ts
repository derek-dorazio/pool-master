/**
 * A stateful, in-memory contest world for ContestService tests.
 *
 * The repo-fakes in `repo-fakes.ts` answer each call with a canned value, so a test of a
 * multi-step flow (enter, rename, leave, enter again) ends up asserting the calls it scripted.
 * This world keeps rows instead: a write is visible to the next read, and the tests assert the
 * stored state. Each repository mirrors its Prisma adapter's filters and the schema's unique
 * constraints that the flows under test can hit — a fake that is looser than the database hides
 * exactly the defects these tests exist to find. Where a defect lives in the adapter's query
 * itself, it still needs a real-database test; this world cannot see it.
 *
 * Scaffolding only: no assertions and no test-specific data here.
 */
import type {
  ContestConfigurationRepository,
  ContestEntryEventStandingRepository,
  ContestEntryEventStandingResult,
  ContestEntryPickRepository,
  ContestEntryPickWithParticipant,
  ContestEntryRepository,
  ContestEntryStandingRepository,
  ContestEntryStandingResult,
  ContestEntryWithSquad,
  ContestRepository,
  ContestSeasonFull,
  ContestSeasonLimits,
  LeagueMembershipRepository,
  LeagueRepository,
  ParticipantContestScoringRuleRepository,
  SportEventRepository,
  SportLeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  ContestEntryStatus,
  League,
  LeagueMembership,
  SportEvent,
  SportEventTier,
  SportLeague,
  Squad,
  SquadMembership,
  User,
} from '@poolmaster/shared/domain';
import {
  ContestFormat,
  ContestStatus,
  CupWeight,
  LeagueMembershipStatus,
  LeagueRole,
  SelectionType,
  Sport,
  SportEventStatus,
  SquadMembershipStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import type { ContestServiceDeps } from '../../packages/core-api/src/modules/contests/service';
import { buildLeague, buildUser } from '../factories';
import {
  fakeLeagueRepo,
  fakeParticipantContestScoringRuleRepo,
  fakeSportEventRepo,
  fakeUserRepo,
} from './repo-fakes';
import type { PlanConfig } from '@poolmaster/shared/dto';
import type { PlanEntitlementsService } from '../../packages/core-api/src/modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from '../../packages/core-api/src/modules/plans/plan-settings';
import { planEntitlementsOver } from './plan-entitlements';

/** Thrown where Postgres would reject the write with a unique-constraint violation (P2002). */
export class UniqueConstraintViolation extends Error {
  constructor(constraint: string) {
    super(`Unique constraint failed: ${constraint}`);
    this.name = 'UniqueConstraintViolation';
  }
}

const T0 = new Date('2026-04-01T12:00:00Z');

export class InMemoryContestWorld {
  readonly contests = new Map<string, Contest>();
  readonly configurations = new Map<string, ContestConfiguration>();
  readonly entries = new Map<string, ContestEntry>();
  readonly picks = new Map<string, ContestEntryPickWithParticipant>();
  /** Settled per-event standings, keyed by entry and event (#713). */
  readonly eventStandings = new Map<string, ContestEntryEventStandingResult>();
  /** Settled contest standings, one per entry. */
  readonly standings = new Map<string, ContestEntryStandingResult>();
  readonly leagues = new Map<string, League>();
  readonly users = new Map<string, User>();
  readonly memberships = new Map<string, LeagueMembership>();
  readonly squads = new Map<string, Squad>();
  readonly squadMemberships = new Map<string, SquadMembership>();
  /** Loaded field size per sport event — what `countParticipants` answers. */
  readonly fieldSizes = new Map<string, number>();
  readonly sportEvents = new Map<string, SportEvent>();
  /** The event's tiers, per sport event — what `listTiers` answers. */
  readonly eventTiers = new Map<string, SportEventTier[]>();
  /** Each contest's expansion bands, in the order they were added (#980); the highest applies. */
  readonly contestExpansions = new Map<string, number[]>();
  /** The PLAN_CONFIG its leagues' plans read (#947): the shipped defaults until a test sets one. */
  planConfig: PlanConfig = PLAN_SETTINGS.defaults({});

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private tick(): Date {
    return new Date(T0.getTime() + this.sequence * 1000);
  }

  // --- Seeding ---

  addLeague(overrides: Partial<League> = {}): League {
    const league = buildLeague({ id: this.nextId('league'), ...overrides });
    this.leagues.set(league.id, league);
    return league;
  }

  addUser(overrides: Partial<User> = {}): User {
    const user = buildUser({ id: this.nextId('user'), ...overrides });
    this.users.set(user.id, user);
    return user;
  }

  addMember(
    leagueId: string,
    userId: string,
    overrides: Partial<LeagueMembership> = {},
  ): LeagueMembership {
    const membership: LeagueMembership = {
      id: this.nextId('membership'),
      leagueId,
      userId,
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: T0,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
    this.memberships.set(membership.id, membership);
    return membership;
  }

  addSquad(leagueId: string, name: string, overrides: Partial<Squad> = {}): Squad {
    const squad: Squad = {
      id: this.nextId('squad'),
      leagueId,
      createdBy: 'seed',
      name,
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
    this.squads.set(squad.id, squad);
    return squad;
  }

  addSquadMember(
    squadId: string,
    userId: string,
    overrides: Partial<SquadMembership> = {},
  ): SquadMembership {
    const squad = this.squads.get(squadId);
    if (!squad) throw new Error(`seed: unknown squad ${squadId}`);
    const membership: SquadMembership = {
      id: this.nextId('squad-membership'),
      squadId,
      leagueId: squad.leagueId,
      userId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: T0,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
    this.squadMemberships.set(membership.id, membership);
    return membership;
  }

  /** Raises the contest's cap to `entriesPerContest`, as a contest_expansions row does (#980). */
  addContestExpansion(contestId: string, entriesPerContest: number): void {
    this.contestExpansions.set(contestId, [...(this.contestExpansions.get(contestId) ?? []), entriesPerContest]);
  }

  addContest(leagueId: string, overrides: Partial<Contest> = {}): Contest {
    const contest: Contest = {
      id: this.nextId('contest'),
      leagueId,
      sportEventIds: [],
      name: 'Masters Pool',
      seasonYear: 2026,
      cupWeight: CupWeight.NORMAL,
      status: ContestStatus.OPEN,
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
    this.contests.set(contest.id, contest);
    return contest;
  }

  addConfiguration(
    contestId: string,
    overrides: Partial<ContestConfiguration> = {},
  ): ContestConfiguration {
    const configuration: ContestConfiguration = {
      id: this.nextId('configuration'),
      contestId,
      selectionType: SelectionType.TIERED,
      // A managed tiered configuration stores picks per tier, never a roster size (#479).
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      maxEntriesPerSquad: null,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
    this.configurations.set(configuration.id, configuration);
    return configuration;
  }

  /** Seeds the contest's sport event with a loaded field. Only what the entry rules read matters. */
  addSportEvent(overrides: Partial<SportEvent> & { startDate: Date }): SportEvent {
    const event = {
      id: this.nextId('event'),
      name: 'The Masters',
      sport: Sport.GOLF,
      status: SportEventStatus.SCHEDULED,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    } as SportEvent;
    this.sportEvents.set(event.id, event);
    this.fieldSizes.set(event.id, 40);
    return event;
  }

  /** Seeds an event's tiers, numbered 1..tierCount. A tiered roster is tierCount × picksPerTier. */
  addEventTiers(sportEventId: string, tierCount: number): SportEventTier[] {
    const tiers = Array.from({ length: tierCount }, (_, index): SportEventTier => ({
      id: this.nextId('tier'),
      sportEventId,
      tierKey: `tier-${index + 1}`,
      label: `Tier ${index + 1}`,
      tierNumber: index + 1,
      createdAt: T0,
      updatedAt: T0,
    }));
    this.eventTiers.set(sportEventId, tiers);
    return tiers;
  }

  /**
   * Seeds a pick directly; production picks come only through ContestEntryPickService. The pick
   * is in `sportEventId`, or by default the first event of the entry's contest.
   */
  addPick(entryId: string, sportEventParticipantId: string, sportEventId?: string): ContestEntryPickWithParticipant {
    const contestId = this.entries.get(entryId)?.contestId;
    const pick: ContestEntryPickWithParticipant = {
      id: this.nextId('pick'),
      entryId,
      sportEventId: sportEventId
        ?? (contestId !== undefined ? this.contests.get(contestId)?.sportEventIds.at(0) : undefined)
        ?? 'event-unset',
      sportEventParticipantId,
      contestFormat: ContestFormat.ROSTER,
      isAutoPicked: false,
      pickedAt: this.tick(),
      createdAt: T0,
      updatedAt: T0,
      participant: {
        participantId: `participant-of-${sportEventParticipantId}`,
        participantName: `Golfer ${sportEventParticipantId}`,
        isActive: true,
        inactiveReason: null,
        role: null,
        teamAffiliation: null,
      },
    };
    this.picks.set(pick.id, pick);
    return pick;
  }

  /** The stored entries of one squad in one contest, in entry-number order. */
  entriesOf(contestId: string, squadId: string): ContestEntry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.contestId === contestId && entry.squadId === squadId)
      .sort((left, right) => left.entryNumber - right.entryNumber);
  }

  // --- Repositories ---

  private withSquad(entry: ContestEntry): ContestEntryWithSquad {
    return { ...entry, squadName: this.squads.get(entry.squadId)?.name ?? '' };
  }

  private byEntryOrder(left: ContestEntry, right: ContestEntry): number {
    return left.entryNumber - right.entryNumber
      || left.createdAt.getTime() - right.createdAt.getTime();
  }

  /** The adapter's season check (#947): the league's contests of the season, their sports leagues. */
  private seasonFull(leagueId: string, seasonYear: number, limits: ContestSeasonLimits): ContestSeasonFull | null {
    if (limits.sportLeaguesPerYear === null) return null;
    const used = this.sportLeagueIdsBySeason(leagueId, seasonYear);
    return used.includes(limits.sportLeagueId) || used.length < limits.sportLeaguesPerYear
      ? null
      : { status: 'sportsLeagueLimitReached', sportLeaguesPerYear: limits.sportLeaguesPerYear, sportLeagueCount: used.length };
  }

  private sportLeagueIdsBySeason(leagueId: string, seasonYear: number): string[] {
    return [...new Set([...this.contests.values()]
      .filter((contest) => contest.leagueId === leagueId && contest.seasonYear === seasonYear)
      .flatMap((contest) => contest.sportEventIds.flatMap((id) => this.sportEvents.get(id)?.sportLeagueId ?? [])))];
  }

  contestRepo(): ContestRepository {
    return {
      findById: async (id) => this.contests.get(id) ?? null,
      findByLeague: async (leagueId) =>
        [...this.contests.values()].filter((contest) => contest.leagueId === leagueId),
      findOpenByLeague: async (leagueId) =>
        [...this.contests.values()]
          .filter((contest) => contest.leagueId === leagueId && contest.status === ContestStatus.OPEN)
          .map(({ id, name }) => ({ id, name })),
      findSportLeagueIdsBySeason: async (leagueId, seasonYear) => this.sportLeagueIdsBySeason(leagueId, seasonYear),
      findBySportEvent: async (sportEventId, filter) =>
        [...this.contests.values()].filter((contest) =>
          contest.sportEventIds.includes(sportEventId)
          && (!filter?.statuses || filter.statuses.includes(contest.status))
          && (!filter?.excludeStatuses || !filter.excludeStatuses.includes(contest.status))),
      findByStatuses: async (statuses) =>
        [...this.contests.values()].filter((contest) => statuses.includes(contest.status)),
      create: async (input, limits) => this.seasonFull(input.leagueId, input.seasonYear, limits)
        ?? { status: 'created', contest: this.addContest(input.leagueId, input) },
      moveToSeason: async (id, seasonYear, limits) => {
        const existing = this.contests.get(id);
        if (!existing) throw new Error(`Record to update not found: contest ${id}`);
        const full = this.seasonFull(existing.leagueId, seasonYear, limits);
        if (full) return full;
        this.contests.set(id, { ...existing, seasonYear, updatedAt: this.tick() });
        return { status: 'moved' };
      },
      update: async (id, updates) => {
        const existing = this.contests.get(id);
        if (!existing) throw new Error(`Record to update not found: contest ${id}`);
        const updated = { ...existing, ...updates, updatedAt: this.tick() };
        this.contests.set(id, updated);
        return updated;
      },
      // Mirrors the adapter: removed events take their picks and entry statuses with them, and
      // every entry gets a DRAFT status for each added event.
      replaceSportEvents: async (id, sportEventIds) => {
        const existing = this.contests.get(id);
        if (!existing) throw new Error(`Record to update not found: contest ${id}`);
        const removed = existing.sportEventIds.filter((eventId) => !sportEventIds.includes(eventId));
        this.contests.set(id, { ...existing, sportEventIds: [...sportEventIds] });
        for (const [pickId, pick] of this.picks) {
          if (this.entries.get(pick.entryId)?.contestId === id && removed.includes(pick.sportEventId)) {
            this.picks.delete(pickId);
          }
        }
        for (const entry of this.entries.values()) {
          if (entry.contestId !== id) continue;
          const kept = entry.events.filter((event) => !removed.includes(event.sportEventId));
          const added = sportEventIds
            .filter((eventId) => !kept.some((event) => event.sportEventId === eventId))
            .map((sportEventId) => ({ sportEventId, status: 'DRAFT' as const }));
          this.entries.set(entry.id, { ...entry, events: [...kept, ...added] });
        }
      },
      setCupWeight: async (id, cupWeight, whileIn) => {
        const existing = this.contests.get(id);
        if (!existing || !whileIn.includes(existing.status)) return false;
        this.contests.set(id, { ...existing, cupWeight });
        return true;
      },
      transitionStatus: async (id, transition) => {
        const existing = this.contests.get(id);
        if (!existing || !transition.from.includes(existing.status)) return false;
        this.contests.set(id, {
          ...existing,
          status: transition.to,
          ...(transition.openedAt && { openedAt: transition.openedAt }),
          ...(transition.startsAt && { startsAt: transition.startsAt }),
          ...(transition.endsAt && { endsAt: transition.endsAt }),
        });
        return true;
      },
      delete: async (id) => {
        this.contests.delete(id);
      },
    };
  }

  configurationRepo(): ContestConfigurationRepository {
    return {
      findByContest: async (contestId) =>
        [...this.configurations.values()].find((row) => row.contestId === contestId) ?? null,
      findByTemplateEventSeries: async () => [],
      create: async (input) => this.addConfiguration(input.contestId, input),
      update: async (id, updates) => {
        const existing = this.configurations.get(id);
        if (!existing) throw new Error(`Record to update not found: configuration ${id}`);
        const updated = { ...existing, ...updates };
        this.configurations.set(id, updated);
        return updated;
      },
    };
  }

  entryRepo(): ContestEntryRepository {
    return {
      findByIdWithSquad: async (id) => {
        const entry = this.entries.get(id);
        return entry ? this.withSquad(entry) : null;
      },
      findByContest: async (contestId) =>
        [...this.entries.values()].filter((entry) => entry.contestId === contestId),
      findByContestWithSquad: async (contestId, options) =>
        [...this.entries.values()]
          .filter((entry) =>
            entry.contestId === contestId
            && (options?.submittedFor === undefined
              || entry.events.some((event) =>
                event.sportEventId === options.submittedFor && event.status === 'SUBMITTED')))
          .sort((left, right) => this.byEntryOrder(left, right))
          .map((entry) => this.withSquad(entry)),
      findByContestAndSquad: async (contestId, squadId) =>
        [...this.entries.values()]
          .filter((entry) => entry.contestId === contestId && entry.squadId === squadId)
          .sort((left, right) => left.entryNumber - right.entryNumber),
      countByContests: async (contestIds) => new Map(contestIds.map((contestId) =>
        [contestId, [...this.entries.values()].filter((entry) => entry.contestId === contestId).length])),
      create: async (input, limits) => {
        // The adapter refuses an entry once the contest is drawn, or holds its plan's entries.
        if (this.contests.get(input.contestId)?.drawnAt !== undefined) return { status: 'contestDrawn' };
        // The cap comes from the contest's highest expansion, read under the contest's lock (#980).
        const bands = this.contestExpansions.get(input.contestId) ?? [];
        const entriesPerContest = limits.entriesPerContest(bands.length > 0 ? Math.max(...bands) : null);
        if (entriesPerContest !== null
          && [...this.entries.values()].filter((entry) => entry.contestId === input.contestId).length >= entriesPerContest) {
          return { status: 'contestFull', entriesPerContest };
        }
        // @@unique([contestId, squadId, entryNumber]) on contest_entries.
        const clash = [...this.entries.values()].some((entry) =>
          entry.contestId === input.contestId
          && entry.squadId === input.squadId
          && entry.entryNumber === input.entryNumber);
        if (clash) {
          throw new UniqueConstraintViolation('contest_entries(contest_id, squad_id, entry_number)');
        }
        const now = this.tick();
        const entry: ContestEntry = {
          ...input,
          // The adapter gives a new entry a DRAFT status in each of its contest's events.
          events: (this.contests.get(input.contestId)?.sportEventIds ?? [])
            .map((sportEventId) => ({ sportEventId, status: 'DRAFT' as const })),
          id: this.nextId('entry'),
          createdAt: now,
          updatedAt: now,
        };
        this.entries.set(entry.id, entry);
        return { status: 'created', entry };
      },
      update: async (id, updates) => {
        const existing = this.entries.get(id);
        if (!existing) throw new Error(`Record to update not found: entry ${id}`);
        const updated = { ...existing, ...updates, updatedAt: this.tick() };
        this.entries.set(id, updated);
        return updated;
      },
      setEventStatus: async (id, sportEventId, status: ContestEntryStatus, at) => {
        const existing = this.entries.get(id);
        if (!existing) throw new Error(`Record to update not found: entry ${id}`);
        // As the adapter's upsert does, the row's tiebreaker is kept.
        const kept = existing.events.find((row) => row.sportEventId === sportEventId)?.tiebreakerValue;
        const event = {
          sportEventId,
          status,
          ...(status === 'SUBMITTED' && { submittedAt: at }),
          ...(kept !== undefined && { tiebreakerValue: kept }),
        };
        const updated: ContestEntry = {
          ...existing,
          events: [...existing.events.filter((row) => row.sportEventId !== sportEventId), event],
        };
        this.entries.set(id, updated);
        return updated;
      },
      delete: async (id) => {
        const contestId = this.entries.get(id)?.contestId;
        if (contestId !== undefined && this.contests.get(contestId)?.drawnAt !== undefined) return { status: 'contestDrawn' };
        // The adapter deletes an entry's picks with it.
        for (const [pickId, pick] of this.picks) {
          if (pick.entryId === id) this.picks.delete(pickId);
        }
        this.entries.delete(id);
        return { status: 'deleted' };
      },
    };
  }

  pickRepo(): ContestEntryPickRepository {
    const ordered = () => [...this.picks.values()].sort((left, right) =>
      left.pickedAt.getTime() - right.pickedAt.getTime() || left.id.localeCompare(right.id));
    return {
      findByEntries: async (entryIds) => ordered().filter((pick) => entryIds.includes(pick.entryId)),
      findByEntriesWithParticipant: async (entryIds) =>
        ordered().filter((pick) => entryIds.includes(pick.entryId)),
      countByEntries: async (entryIds) => {
        const counts = new Map<string, number>();
        for (const pick of this.picks.values()) {
          if (entryIds.includes(pick.entryId)) {
            counts.set(pick.entryId, (counts.get(pick.entryId) ?? 0) + 1);
          }
        }
        return counts;
      },
      countByContest: async (contestId) =>
        [...this.picks.values()].filter((pick) =>
          this.entries.get(pick.entryId)?.contestId === contestId).length,
    };
  }

  membershipRepo(): LeagueMembershipRepository {
    return {
      findByLeague: async (leagueId) =>
        [...this.memberships.values()].filter((row) => row.leagueId === leagueId),
      findByUser: async (userId) =>
        [...this.memberships.values()].filter((row) => row.userId === userId),
      countActiveByLeagues: async () => new Map(),
      findActiveJoinedSince: async (since) => [...this.memberships.values()]
        .filter((row) => row.status === LeagueMembershipStatus.ACTIVE && row.joinedAt >= since)
        .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime() || left.id.localeCompare(right.id)),
      findByLeagueAndUser: async (leagueId, userId) =>
        [...this.memberships.values()].find((row) =>
          row.leagueId === leagueId && row.userId === userId) ?? null,
      create: async (input) => this.addMember(input.leagueId, input.userId, input),
      update: async (id, updates) => {
        const existing = this.memberships.get(id);
        if (!existing) throw new Error(`Record to update not found: membership ${id}`);
        const updated = { ...existing, ...updates };
        this.memberships.set(id, updated);
        return updated;
      },
    };
  }

  squadRepo(): SquadRepository {
    return {
      findById: async (id) => this.squads.get(id) ?? null,
      findByLeague: async (leagueId, includeInactive = false) =>
        [...this.squads.values()].filter((squad) =>
          squad.leagueId === leagueId && (includeInactive || squad.isActive)),
      findByLeagueAndName: async (leagueId, name) =>
        [...this.squads.values()].find((squad) =>
          squad.leagueId === leagueId && squad.name === name) ?? null,
      create: async (input) => this.addSquad(input.leagueId, input.name, input),
      update: async (id, updates) => {
        const existing = this.squads.get(id);
        if (!existing) throw new Error(`Record to update not found: squad ${id}`);
        const updated = { ...existing, ...updates };
        this.squads.set(id, updated);
        return updated;
      },
    };
  }

  squadMembershipRepo(): SquadMembershipRepository {
    const active = (row: SquadMembership, includeInactive: boolean) =>
      includeInactive || row.status === SquadMembershipStatus.ACTIVE;
    return {
      findBySquad: async (squadId, includeInactive = false) =>
        [...this.squadMemberships.values()].filter((row) =>
          row.squadId === squadId && active(row, includeInactive)),
      findBySquads: async (squadIds, includeInactive = false) =>
        [...this.squadMemberships.values()].filter((row) =>
          squadIds.includes(row.squadId) && active(row, includeInactive)),
      findBySquadAndUser: async (squadId, userId) =>
        [...this.squadMemberships.values()].find((row) =>
          row.squadId === squadId && row.userId === userId) ?? null,
      // The adapter prefers the ACTIVE row when a user has several in a league.
      findByLeagueAndUser: async (leagueId, userId) => {
        const rows = [...this.squadMemberships.values()].filter((row) =>
          row.leagueId === leagueId && row.userId === userId);
        return rows.find((row) => row.status === SquadMembershipStatus.ACTIVE) ?? rows.at(0) ?? null;
      },
      create: async (input) => this.addSquadMember(input.squadId, input.userId, input),
      update: async (id, updates) => {
        const existing = this.squadMemberships.get(id);
        if (!existing) throw new Error(`Record to update not found: squad membership ${id}`);
        const updated = { ...existing, ...updates };
        this.squadMemberships.set(id, updated);
        return updated;
      },
    };
  }

  leagueRepo(): LeagueRepository {
    return fakeLeagueRepo({
      findById: async (id) => this.leagues.get(id) ?? null,
      findAll: async (filters = {}) => [...this.leagues.values()]
        .filter((league) => filters.isActive === undefined || league.isActive === filters.isActive),
    });
  }

  userRepo(): UserRepository {
    return fakeUserRepo({
      findById: async (id) => this.users.get(id) ?? null,
      // Every membership status, as the port says.
      findByLeague: async (leagueId) => {
        const memberIds = new Set([...this.memberships.values()]
          .filter((membership) => membership.leagueId === leagueId)
          .map((membership) => membership.userId));
        return [...this.users.values()].filter((user) => memberIds.has(user.id));
      },
    });
  }

  /** Every sport league, named by its id: the emails about an event name its sport league. */
  sportLeagueRepo(): Pick<SportLeagueRepository, 'findById'> {
    return { findById: async (id) => ({ id, name: id }) as SportLeague };
  }

  sportEventRepo(): SportEventRepository {
    return fakeSportEventRepo({
      findById: async (id) => this.sportEvents.get(id) ?? null,
      findByIds: async (ids) => ids.flatMap((id) => this.sportEvents.get(id) ?? []),
      // Ordered by start, as the database orders them.
      findAll: async (filters) => [...this.sportEvents.values()]
        .filter((event) => (filters.status === undefined || event.status === filters.status)
          && (filters.sportLeagueId === undefined || event.sportLeagueId === filters.sportLeagueId)
          && (filters.eventYear === undefined || event.eventYear === filters.eventYear)
          && (filters.startsFrom === undefined || event.startDate >= filters.startsFrom)
          && (filters.startsBefore === undefined || event.startDate < filters.startsBefore))
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
      countParticipants: async (ids) =>
        new Map(ids.map((id) => [id, this.fieldSizes.get(id) ?? 0])),
    });
  }

  scoringRuleRepo(): ParticipantContestScoringRuleRepository {
    return fakeParticipantContestScoringRuleRepo();
  }

  standingRepo(): ContestEntryStandingRepository {
    return {
      findByContest: async (contestId) =>
        [...this.standings.values()].filter((row) => row.contestId === contestId),
      // One per entry, as the adapter's upsert on contest_entry_id.
      upsert: async (write) => {
        this.standings.set(write.contestEntryId, { id: this.standings.get(write.contestEntryId)?.id ?? this.nextId('standing'), ...write });
      },
    };
  }

  eventStandingRepo(): ContestEntryEventStandingRepository {
    return {
      findByContest: async (contestId) =>
        [...this.eventStandings.values()].filter((row) => row.contestId === contestId),
      upsert: async (write) => {
        const key = `${write.contestEntryId}:${write.sportEventId}`;
        this.eventStandings.set(key, { id: this.eventStandings.get(key)?.id ?? this.nextId('event-standing'), ...write });
      },
    };
  }

  /** The real plan entitlements service over this world's leagues and `planConfig`. */
  planEntitlements(): PlanEntitlementsService {
    return planEntitlementsOver(this.leagueRepo(), () => this.planConfig);
  }

  /**
   * Everything ContestService needs, wired to this world. The world keeps no games, so a test of
   * game picks passes `predictions` and `matches` from an `InMemoryGamePicks` over it.
   */
  contestServiceDeps(overrides: Partial<ContestServiceDeps> = {}): ContestServiceDeps {
    return {
      contests: this.contestRepo(),
      configurations: this.configurationRepo(),
      scoringRules: this.scoringRuleRepo(),
      entries: this.entryRepo(),
      picks: this.pickRepo(),
      predictions: { findByEntriesAndEvent: async () => [], findByEntriesAndEvents: async () => [] },
      expansions: {
        findHighestBands: async (contestIds) => new Map(contestIds.flatMap((contestId) => {
          const bands = this.contestExpansions.get(contestId) ?? [];
          return bands.length > 0 ? [[contestId, Math.max(...bands)] as const] : [];
        })),
      },
      participants: { findByIds: async () => [] },
      matches: { findBySportEvent: async () => [], findBySportEvents: async () => [] },
      standings: this.standingRepo(),
      eventStandings: this.eventStandingRepo(),
      memberships: this.membershipRepo(),
      squads: this.squadRepo(),
      squadMemberships: this.squadMembershipRepo(),
      leagues: this.leagueRepo(),
      users: this.userRepo(),
      sportEvents: this.sportEventRepo(),
      sportLeagues: this.sportLeagueRepo(),
      eventParticipants: { listEventParticipants: async () => [] },
      tiers: {
        getEffectiveValuationsForSportEvent: async () => [],
        listTiers: async (sportEventId: string) => this.eventTiers.get(sportEventId) ?? [],
      },
      planEntitlements: this.planEntitlements(),
      ...overrides,
    };
  }
}
