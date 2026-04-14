/**
 * ContestService — contest creation, retrieval, update, and deletion.
 *
 * Implements the multi-step contest wizard: sport/event, draft config,
 * scoring rules, payout structure, and scheduling.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  ContestConfigurationRepository,
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import type {
  Contest,
  ContestEntry,
  ContestConfiguration,
} from '@poolmaster/shared/domain';
import {
  ContestStatus,
  ContestType,
  ScoringEngine,
  SelectionType,
  SquadMembershipStatus,
  SquadStatus,
} from '@poolmaster/shared/domain';
import type { ContestEntryDto } from '@poolmaster/shared/dto';
import {
  toContestEntryDto,
} from '../../mappers/contests.mapper';
import { buildDefaultSquadName } from '../../core/user-name';
export interface CreateContestInput {
  leagueId: string;
  createdBy: string;
  sportEventId?: string;
  name: string;
  contestType: ContestType;
  selectionType: SelectionType;
  contestConfiguration: Partial<Omit<ContestConfiguration, 'id' | 'contestId' | 'createdAt' | 'updatedAt'>>;
  scoringEngine: ScoringEngine;
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
  isExclusive?: boolean;
  scoringStopsOnElimination?: boolean;
}

export interface UpdateContestInput {
  name?: string;
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;
  isExclusive?: boolean;
}

export class ContestService {
  constructor(
    private readonly contestRepo: ContestRepository,
    private readonly contestConfigurationRepo: ContestConfigurationRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly leagueRepo: LeagueRepository,
    private readonly squadRepo?: SquadRepository,
    private readonly squadMembershipRepo?: SquadMembershipRepository,
    private readonly entryRepo?: ContestEntryRepository,
    private readonly prisma?: PrismaClient,
  ) {}

  /** Creates a contest and its selection configuration atomically. */
  async createContest(
    input: CreateContestInput,
  ): Promise<{ contest: Contest; contestConfiguration: ContestConfiguration }> {
    const league = await this.leagueRepo.findById(input.leagueId);
    if (!league) {
      throw new ContestOperationError('League not found', 'LEAGUE_NOT_FOUND');
    }
    const contest = await this.contestRepo.create({
      leagueId: input.leagueId,
      sportEventId: input.sportEventId || undefined,
      name: input.name,
      status: ContestStatus.DRAFT,
      contestType: input.contestType,
      selectionType: input.selectionType,
      scoringEngine: input.scoringEngine,
      isExclusive: input.isExclusive ?? false,
      scoringStopsOnElimination: input.scoringStopsOnElimination ?? false,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      lockAt: input.lockAt,
    } as Omit<Contest, 'id' | 'createdAt' | 'updatedAt'>);
    const contestConfiguration = await this.contestConfigurationRepo.create({
      contestId: contest.id,
      selectionType: input.selectionType,
      isExclusive:
        input.contestConfiguration.isExclusive
          ?? input.isExclusive
          ?? false,
      ...input.contestConfiguration,
    } as Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>);
    return { contest, contestConfiguration };
  }

  async getContest(
    contestId: string,
  ): Promise<{ contest: Contest; contestConfiguration: ContestConfiguration | null } | null> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      return null;
    }
    const contestConfiguration = await this.contestConfigurationRepo.findByContest(contestId);
    return { contest, contestConfiguration };
  }

  async listByLeague(leagueId: string): Promise<Contest[]> {
    return this.contestRepo.findByLeague(leagueId);
  }

  /** Updates a contest. Only allowed when status is DRAFT. */
  async updateContest(
    contestId: string,
    updates: UpdateContestInput,
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      throw new ContestOperationError(
        'Contest can only be edited in DRAFT status',
        'CONTEST_EDIT_STATUS_INVALID',
      );
    }
    return this.contestRepo.update(contestId, updates as Partial<Contest>);
  }

  /** Deletes a contest. Only allowed when status is DRAFT. */
  async deleteContest(contestId: string): Promise<void> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    if (contest.status !== ContestStatus.DRAFT) {
      throw new ContestOperationError(
        'Contest can only be deleted in DRAFT status',
        'CONTEST_DELETE_STATUS_INVALID',
      );
    }
    await this.contestRepo.delete(contestId);
  }

  async listEntries(
    contestId: string,
    userId: string,
  ): Promise<{
    entries: ContestEntryDto[];
    isJoined: boolean;
    myEntryId: string | null;
    myEntryIds: string[];
  }> {
    const context = await this.getEntryContext(contestId, userId);
    const squadId = context.squadMembership?.squadId ?? null;
    const entries = await this.loadEntryDtos(contestId);
    const myEntries = squadId
      ? entries.filter((entry) => entry.squadId === squadId)
      : [];
    const myEntry = myEntries[0] ?? null;
    const orderedEntries = [
      ...myEntries,
      ...entries.filter((entry) => entry.squadId !== squadId),
    ];

    return {
      entries: orderedEntries,
      isJoined: myEntry !== null,
      myEntryId: myEntry?.id ?? null,
      myEntryIds: myEntries.map((entry) => entry.id),
    };
  }

  async getMyEntry(
    contestId: string,
    userId: string,
  ): Promise<ContestEntryDto | null> {
    const context = await this.getEntryContext(contestId, userId);
    if (!context.squadMembership) {
      return null;
    }
    const entries = await this.loadEntryDtos(contestId);
    return entries.find((entry) => entry.squadId === context.squadMembership?.squadId) ?? null;
  }

  async createEntry(
    contestId: string,
    userId: string,
  ): Promise<{ entry: ContestEntryDto; created: boolean }> {
    const context = await this.getEntryContext(contestId, userId);
    const membership = context.membership;
    if (!membership) {
      throw new ContestEntryOperationError(
        'You must be an active league member to enter this contest',
        'LEAGUE_MEMBERSHIP_REQUIRED',
      );
    }
    if (!isContestJoinable(context.contest.status)) {
      throw new ContestEntryOperationError(
        'Contest entries can only be changed before the contest starts',
        'CONTEST_ENTRY_LOCKED',
      );
    }

    const squad = await this.resolveOrCreateSquadForEntry(
      context.contest.leagueId,
      userId,
      context.squadMembership,
    );
    const existingEntries = await this.findEntriesBySquad(contestId, squad.id);
    const maxEntriesPerSquad = await this.getMaxEntriesPerSquad(contestId);

    if (existingEntries.length >= maxEntriesPerSquad) {
      if (maxEntriesPerSquad === 1 && existingEntries[0]) {
        const dto = await this.loadEntryDtoById(existingEntries[0].id);
        return { entry: dto, created: false };
      }
      throw new ContestEntryOperationError(
        'This squad has already reached the entry limit for the contest',
        'CONTEST_ENTRY_LIMIT_REACHED',
      );
    }

    const nextEntryNumber = existingEntries.length + 1;
    const created = await this.requireEntryRepo().create({
      contestId,
      squadId: squad.id,
      entryNumber: nextEntryNumber,
      name: buildDefaultEntryName(squad.name, nextEntryNumber),
      status: 'ACTIVE',
      totalScore: 0,
      standingsPosition: undefined,
      isEliminated: false,
    });
    const dto = await this.loadEntryDtoById(created.id);
    return { entry: dto, created: true };
  }

  async deleteMyEntry(
    contestId: string,
    userId: string,
  ): Promise<void> {
    const context = await this.getEntryContext(contestId, userId);
    const membership = context.membership;
    if (!membership) {
      throw new ContestEntryOperationError(
        'You must be an active league member to leave this contest',
        'LEAGUE_MEMBERSHIP_REQUIRED',
      );
    }
    if (!isContestJoinable(context.contest.status)) {
      throw new ContestEntryOperationError(
        'Contest entries can only be changed before the contest starts',
        'CONTEST_ENTRY_LOCKED',
      );
    }
    if (!context.squadMembership) {
      throw new ContestEntryOperationError(
        'You do not manage a squad in this league',
        'SQUAD_MANAGER_REQUIRED',
      );
    }

    const existing = await this.findPrimaryEntryBySquad(contestId, context.squadMembership.squadId);
    if (!existing) {
      throw new ContestEntryNotFoundError(contestId, context.squadMembership.squadId);
    }

    const hasSelections = await this.entryHasSelections(existing.id);
    if (hasSelections) {
      throw new ContestEntryOperationError(
        'Cannot leave a contest after making picks or draft selections',
        'CONTEST_ENTRY_SELECTIONS_EXIST',
      );
    }

    await this.requireEntryRepo().delete(existing.id);
  }

  private async getEntryContext(
    contestId: string,
    userId: string,
  ): Promise<{
    contest: Contest;
    membership: Awaited<ReturnType<LeagueMembershipRepository['findByLeagueAndUser']>>;
    squadMembership: Awaited<ReturnType<SquadMembershipRepository['findByLeagueAndUser']>>;
  }> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new ContestNotFoundError(contestId);
    }
    const membership = await this.membershipRepo.findByLeagueAndUser(contest.leagueId, userId);
    const squadMembership = membership
      ? await this.requireSquadMembershipRepo().findByLeagueAndUser(contest.leagueId, userId)
      : null;
    return { contest, membership, squadMembership };
  }

  private async findEntriesBySquad(
    contestId: string,
    squadId: string,
  ): Promise<ContestEntry[]> {
    const entries = await this.requireEntryRepo().findBySquad(squadId);
    return entries
      .filter((entry) => entry.contestId === contestId && entry.status === 'ACTIVE')
      .sort((left, right) => left.entryNumber - right.entryNumber);
  }

  private async findPrimaryEntryBySquad(
    contestId: string,
    squadId: string,
  ): Promise<ContestEntry | null> {
    const entries = await this.findEntriesBySquad(contestId, squadId);
    return entries[0] ?? null;
  }

  private async loadEntryDtos(contestId: string): Promise<ContestEntryDto[]> {
    const prisma = this.requirePrisma();
    const rows = await prisma.contestEntry.findMany({
      where: { contestId },
      include: {
        squad: true,
      },
      orderBy: [
        { standingsPosition: 'asc' },
        { entryNumber: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return rows.map((row) =>
      toContestEntryDto({
        ...row,
        status: row.status as ContestEntry['status'],
      }, {
        name: row.squad.name,
      }),
    );
  }

  private async loadEntryDtoById(entryId: string): Promise<ContestEntryDto> {
    const prisma = this.requirePrisma();
    const row = await prisma.contestEntry.findUnique({
      where: { id: entryId },
      include: {
        squad: true,
      },
    });

    if (!row) {
      throw new ContestEntryOperationError(
        `Contest entry not found: ${entryId}`,
        'CONTEST_ENTRY_NOT_FOUND',
      );
    }

    return toContestEntryDto({
      ...row,
      status: row.status as ContestEntry['status'],
    }, {
      name: row.squad.name,
    });
  }

  private async entryHasSelections(entryId: string): Promise<boolean> {
    const prisma = this.requirePrisma();
    const [rosterPickCount, draftPickHistoryCount] = await Promise.all([
      prisma.rosterPick.count({ where: { entryId } }),
      prisma.draftPickHistory.count({ where: { entryId } }),
    ]);
    return rosterPickCount + draftPickHistoryCount > 0;
  }

  private async resolveOrCreateSquadForEntry(
    leagueId: string,
    userId: string,
    existingSquadMembership: Awaited<ReturnType<SquadMembershipRepository['findByLeagueAndUser']>>,
  ) {
    const prisma = this.requirePrisma();
    if (existingSquadMembership?.status === SquadMembershipStatus.ACTIVE) {
      const squad = await this.requireSquadRepo().findById(existingSquadMembership.squadId);
      if (squad) {
        return squad;
      }
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.firstName || !user?.lastName) {
      throw new ContestEntryOperationError(
        'Unable to resolve the squad owner',
        'SQUAD_OWNER_RESOLUTION_FAILED',
      );
    }
    const squad = await this.requireSquadRepo().create({
      leagueId,
      createdBy: userId,
      name: buildDefaultSquadName(user.firstName, user.lastName),
      iconUrl: undefined,
      status: SquadStatus.ACTIVE,
    });
    await this.requireSquadMembershipRepo().create({
      squadId: squad.id,
      leagueId,
      userId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    return squad;
  }

  private async getMaxEntriesPerSquad(contestId: string): Promise<number> {
    const prisma = this.requirePrisma();
    const configuration = await prisma.contestConfiguration.findUnique({
      where: { contestId },
      select: { maxEntriesPerSquad: true },
    });
    return configuration?.maxEntriesPerSquad ?? 1;
  }

  private requireEntryRepo(): ContestEntryRepository {
    if (!this.entryRepo) {
      throw new ContestEntryOperationError(
        'Contest entry repository is unavailable',
        'CONTEST_ENTRY_REPOSITORY_UNAVAILABLE',
      );
    }
    return this.entryRepo;
  }

  private requireSquadRepo(): SquadRepository {
    if (!this.squadRepo) {
      throw new ContestEntryOperationError(
        'Squad repository is unavailable',
        'SQUAD_REPOSITORY_UNAVAILABLE',
      );
    }
    return this.squadRepo;
  }

  private requireSquadMembershipRepo(): SquadMembershipRepository {
    if (!this.squadMembershipRepo) {
      throw new ContestEntryOperationError(
        'Squad membership repository is unavailable',
        'SQUAD_MEMBERSHIP_REPOSITORY_UNAVAILABLE',
      );
    }
    return this.squadMembershipRepo;
  }

  private requirePrisma(): PrismaClient {
    if (!this.prisma) {
      throw new ContestEntryOperationError('Prisma client is unavailable', 'PRISMA_UNAVAILABLE');
    }
    return this.prisma;
  }
}

export class ContestNotFoundError extends Error {
  constructor(contestId: string) {
    super(`Contest not found: ${contestId}`);
    this.name = 'ContestNotFoundError';
  }
}

export class ContestOperationError extends Error {
  code: string;

  constructor(reason: string, code = 'CONTEST_OPERATION_INVALID') {
    super(reason);
    this.name = 'ContestOperationError';
    this.code = code;
  }
}

export class ContestEntryOperationError extends Error {
  code: string;

  constructor(reason: string, code = 'CONTEST_ENTRY_OPERATION_INVALID') {
    super(reason);
    this.name = 'ContestEntryOperationError';
    this.code = code;
  }
}

export class ContestEntryNotFoundError extends Error {
  constructor(contestId: string, squadId: string) {
    super(`Contest entry not found for contest ${contestId} and squad ${squadId}`);
    this.name = 'ContestEntryNotFoundError';
  }
}

function buildDefaultEntryName(squadName: string, entryNumber: number): string {
  return `${squadName} Entry ${entryNumber}`;
}

function isContestJoinable(status: ContestStatus): boolean {
  return status === ContestStatus.DRAFT || status === ContestStatus.OPEN;
}
