import * as SharedDomainEnums from '@poolmaster/shared/domain/enums';
import {
  ContestService,
  ContestNotFoundError,

  type ContestServiceDeps,
} from '../../../packages/core-api/src/modules/contests/service';
import type {
  ContestConfigurationRepository,
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  PARTICIPANT_SCORING_DEFINITIONS,


  ContestFormat,
  LeagueMembershipStatus,
  Sport,
  SquadMembershipStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import { buildContest, buildMembership, buildUser } from '../../factories';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeContestEntryStandingRepo,
  fakeContestRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
  fakeParticipantContestScoringRuleRepo,
  fakeSportEventRepo,
  fakeSquadMembershipRepo,
  fakeSquadRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return fakeContestRepo({
    update: mockFn<ContestRepository['update']>(async (id, updates) => ({
      ...buildContest({ id }),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockContestConfigurationRepo(
  overrides: Partial<ContestConfigurationRepository> = {},
): ContestConfigurationRepository {
  return fakeContestConfigurationRepo({
    create: mockFn<ContestConfigurationRepository['create']>(async (input) => ({
      ...input,
      id: 'new-config-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: mockFn<ContestConfigurationRepository['update']>(async (id, updates) => ({
      id,
      contestId: 'c-1',
      selectionType: SharedDomainEnums.SelectionType.TIERED,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    create: jest.fn().mockResolvedValue(buildMembership()),
    update: jest.fn().mockResolvedValue(buildMembership()),
    ...overrides,
  });
}

const DEFAULT_ENTRY_WITH_SQUAD = {
  id: 'entry-1',
  contestId: 'contest-1',
  squadId: 'squad-1',
  entryNumber: 1,
  name: "Derek's Squad Entry 1",
  status: 'ACTIVE' as const,
  tiebreakerValue: undefined,
  isEliminated: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  squadName: "Derek's Squad",
};

function createMockEntryRepo(overrides: Partial<ContestEntryRepository> = {}): ContestEntryRepository {
  return fakeContestEntryRepo({
    findByIdWithSquad: jest.fn().mockResolvedValue(DEFAULT_ENTRY_WITH_SQUAD),
    findByContestWithSquad: jest.fn().mockResolvedValue([DEFAULT_ENTRY_WITH_SQUAD]),
    create: mockFn<ContestEntryRepository['create']>(async (input) => ({
      ...input,
      id: 'entry-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    })),
    update: mockFn<ContestEntryRepository['update']>(async (id, updates) => ({
      id,
      contestId: 'contest-1',
      squadId: 'squad-1',
      entryNumber: 1,
      name: 'Ace Squad Entry 1',
      status: 'ACTIVE',
      isEliminated: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return fakeSquadRepo({
    findById: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: "Derek's Squad",
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    create: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: "Derek's Squad",
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    ...overrides,
  });
}

function createMockSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return fakeSquadMembershipRepo({
    create: jest.fn().mockResolvedValue({
      id: 'squad-membership-1',
      squadId: 'squad-1',
      leagueId: 'league-1',
      userId: 'user-1',
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date('2026-01-01'),
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    ...overrides,
  });
}

/**
 * A ContestService on port fakes. The defaults stand in for an event with a loaded field, a
 * user who can be emailed, and a league; a test passes the ports its behaviour depends on.
 */
function buildService(deps: Partial<ContestServiceDeps> = {}): ContestService {
  return new ContestService({
    contests: createMockContestRepo(),
    configurations: createMockContestConfigurationRepo(),
    scoringRules: fakeParticipantContestScoringRuleRepo(),
    entries: createMockEntryRepo(),
    picks: fakeContestEntryPickRepo(),
    standings: fakeContestEntryStandingRepo(),
    memberships: createMockMembershipRepo(),
    squads: createMockSquadRepo(),
    squadMemberships: createMockSquadMembershipRepo(),
    leagues: fakeLeagueRepo({
      findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Big Dawgs', leagueCode: 'BIGDAWGS' }),
    }),
    users: fakeUserRepo({
      findById: jest.fn().mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' })),
    }),
    sportEvents: fakeSportEventRepo({
      findById: jest.fn().mockResolvedValue({ id: 'event-1', sport: Sport.GOLF }),
      countParticipants: jest.fn().mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, 1]))),
    }),
    eventParticipants: { listEventParticipants: jest.fn().mockResolvedValue([]) },
    tiers: { getEffectiveValuationsForSportEvent: jest.fn().mockResolvedValue([]) },
    ...deps,
  });
}

const ACTIVE_SQUAD_MEMBERSHIP = {
  id: 'squad-membership-1',
  squadId: 'squad-1',
  leagueId: 'league-1',
  userId: 'user-1',
  status: SquadMembershipStatus.ACTIVE,
  joinedAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const RECEIPT_USER = buildUser({
  id: 'user-1',
  email: 'derek@example.com',
  firstName: 'Derek',
  lastName: 'Dorazio',
  username: 'derek',
});

/** The squad's entry before the tiebreaker is saved. */
const UNSUBMITTED_ENTRY = {
  id: 'entry-1',
  contestId: 'contest-1',
  squadId: 'squad-1',
  entryNumber: 1,
  name: "Derek's Squad Entry 1",
  status: 'ACTIVE' as const,
  tiebreakerValue: undefined,
  isEliminated: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/** The same entry once the tiebreaker is saved, as the receipt reads it. */
function submittedEntry(tiebreakerValue: number) {
  return {
    ...DEFAULT_ENTRY_WITH_SQUAD,
    tiebreakerValue,
    updatedAt: new Date('2026-01-02T12:00:00.000Z'),
  };
}

/** A pick with its golfer, as `ContestEntryPickRepository.findByEntriesWithParticipant` returns it. */
function buildReceiptPick(
  id: string,
  sportEventParticipantId: string,
  participantId: string,
  participantName: string,
  pickedAt: string,
) {
  return {
    id,
    entryId: 'entry-1',
    sportEventParticipantId,
    contestFormat: ContestFormat.ROSTER,
    isAutoPicked: false,
    pickedAt: new Date(pickedAt),
    createdAt: new Date(pickedAt),
    updatedAt: new Date(pickedAt),
    participant: {
      participantId,
      participantName,
      isActive: true,
      inactiveReason: null,
      role: null,
      teamAffiliation: null,
    },
  };
}

/** One golfer as `SportEventParticipantService.listEventParticipants` returns them. */
function buildGolfFieldView(input: {
  id: string;
  participantName: string;
  eventScoreToPar: number;
  eventStrokes: number;
  status: string;
  currentRound?: number;
  currentRoundThru?: number;
  rounds?: Array<{
    round: number;
    strokes: number;
    scoreToPar: number;
    thru: number | null;
    status: string;
  }>;
}) {
  return {
    entry: {
      id: input.id,
      participantId: `participant-${input.id}`,
      isActive: true,
      inactiveReason: undefined,
      ranking: undefined,
      oddsToWin: undefined,
      seedNumber: undefined,
    },
    participant: {
      id: `participant-${input.id}`,
      name: input.participantName,
      shortName: undefined,
    },
    valuation: null,
    standing: {
      standing: {
        currentRound: input.currentRound ?? 2,
        status: input.status,
        position: undefined,
        displayPosition: undefined,
        asOf: new Date('2026-05-31T18:00:00.000Z'),
      },
      golf: {
        eventScoreToPar: input.eventScoreToPar,
        eventStrokes: input.eventStrokes,
        currentRoundThru: input.currentRoundThru ?? 18,
      },
    },
    rounds: (input.rounds ?? []).map((round) => ({
      round: { status: round.status, roundNumber: round.round },
      golf: { strokes: round.strokes, scoreToPar: round.scoreToPar, thru: round.thru },
    })),
    affiliatedWithSportLeague: true,
  };
}

function buildGolfLeaderboardPick(id: string, entryId: string, sportEventParticipantId: string) {
  return {
    id,
    entryId,
    sportEventParticipantId,
    pickedAt: new Date(`2026-05-30T12:00:0${id.slice(-1)}.000Z`),
    slot: undefined,
    tier: undefined,
    createdAt: new Date('2026-05-30T12:00:00.000Z'),
  };
}

describe('ContestService', () => {
  describe('updateContest', () => {
    it('updates a DRAFT contest', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.DRAFT });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      await service.updateContest('c-1', { name: 'Updated Name' });
      expect(contestRepo.update).toHaveBeenCalledWith('c-1', { name: 'Updated Name' });
    });

    it('throws when contest is not in DRAFT status', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.ACTIVE });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      await expect(
        service.updateContest('c-1', { name: 'Updated' }),
      ).rejects.toThrow('DRAFT status');
    });

    it('throws ContestNotFoundError for missing contest', async () => {
      const service = buildService({
        contests: createMockContestRepo(),
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      await expect(
        service.updateContest('missing', { name: 'X' }),
      ).rejects.toThrow(ContestNotFoundError);
    });
  });

  describe('deleteContest', () => {
    it('deletes a DRAFT contest', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.DRAFT });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      await service.deleteContest('c-1');
      expect(contestRepo.delete).toHaveBeenCalledWith('c-1');
    });

    it('throws when contest is ACTIVE', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.ACTIVE });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      await expect(service.deleteContest('c-1')).rejects.toThrow(
        'DRAFT status',
      );
    });
  });

  describe('listByLeague', () => {
    it('returns contests for the league', async () => {
      const contests = [buildContest(), buildContest()];
      const contestRepo = createMockContestRepo({
        findByLeague: jest.fn().mockResolvedValue(contests),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      const result = await service.listByLeague('league-1');
      expect(result).toHaveLength(2);
    });

    it('pool-master-d0v counts entries for league contest summaries', async () => {
      const [firstContest, secondContest] = [
        buildContest({ id: 'contest-1' }),
        buildContest({ id: 'contest-2' }),
      ];
      const contestRepo = createMockContestRepo({
        findByLeague: jest.fn().mockResolvedValue([firstContest, secondContest]),
      });
      const entryRepo = createMockEntryRepo({
        findByContest: jest.fn()
          .mockResolvedValueOnce([
            { id: 'entry-1' },
            { id: 'entry-2' },
          ])
          .mockResolvedValueOnce([{ id: 'entry-3' }]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
        entries: entryRepo,
      });

      const counts = await service.countEntriesByContest(['contest-1', 'contest-2']);

      expect(counts).toEqual(new Map([
        ['contest-1', 2],
        ['contest-2', 1],
      ]));
      expect(entryRepo.findByContest).toHaveBeenCalledWith('contest-1');
      expect(entryRepo.findByContest).toHaveBeenCalledWith('contest-2');
    });
  });

  describe('getContest', () => {
    it('returns contest with selection config', async () => {
      const contest = buildContest({ id: 'c-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const configRepo = createMockContestConfigurationRepo({
        findByContest: jest.fn().mockResolvedValue({ id: 'cfg-1', contestId: 'c-1' }),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: configRepo,
        memberships: createMockMembershipRepo(),
      });
      const result = await service.getContest('c-1');
      expect(result).not.toBeNull();
      expect(result!.contest.id).toBe('c-1');
      expect(result!.contestConfiguration).toBeDefined();
    });

    it('returns null for missing contest', async () => {
      const service = buildService({
        contests: createMockContestRepo(),
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      const result = await service.getContest('missing');
      expect(result).toBeNull();
    });
  });

  describe('contest entries', () => {
    it('creates a real contest entry for the current league member', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'squad-membership-1',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: squadMembershipRepo,
        entries: entryRepo,
      });

      const result = await service.createEntry('contest-1', 'user-1');

      expect(result.id).toBe('entry-1');
      expect(entryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: "Derek's Squad Entry 1",
      }));
    });

    it('rejects contest entry creation when the league member has no active squad', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(null),
        }),
        entries: createMockEntryRepo(),
      });

      await expect(service.createEntry('contest-1', 'user-1')).rejects.toMatchObject({
        code: 'SQUAD_MEMBERSHIP_REQUIRED',
      });
    });

    it('rejects contest entry creation once the squad reaches the configured entry cap', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'squad-membership-1',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo({
          findByContest: jest.fn().mockResolvedValue({ maxEntriesPerSquad: 1 }),
        }),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: squadMembershipRepo,
        entries: entryRepo,
      });

      await expect(service.createEntry('contest-1', 'user-1')).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_LIMIT_REACHED',
      });
      expect(entryRepo.create).not.toHaveBeenCalled();
    });

    it('pool-master-284 rejects contest entry creation when the event field has not synced', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventId: 'sport-event-1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'squad-membership-1',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const sportEventRepo = fakeSportEventRepo({
        countParticipants: jest.fn().mockResolvedValue(new Map([['sport-event-1', 0]])),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: squadMembershipRepo,
        entries: entryRepo,
        sportEvents: sportEventRepo,
      });

      await expect(service.createEntry('contest-1', 'user-1')).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_FIELD_NOT_LOADED',
        message: 'Contest entries are not available until the event participant field has loaded.',
      });
      expect(sportEventRepo.countParticipants).toHaveBeenCalledWith(['sport-event-1']);
      expect(entryRepo.create).not.toHaveBeenCalled();
    });

    it('allows additional entry creation when the contest configuration is unlimited', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'squad-membership-1',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date('2026-01-01'),
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      entryRepo.findByIdWithSquad = jest.fn().mockResolvedValue({
        ...DEFAULT_ENTRY_WITH_SQUAD,
        id: 'entry-2',
        entryNumber: 2,
        name: "Derek's Squad Entry 2",
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo({
          findByContest: jest.fn().mockResolvedValue({
            configJson: { rosterSize: 6, countedScores: 4 },
            maxEntriesPerSquad: null,
          }),
        }),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: squadMembershipRepo,
        entries: entryRepo,
      });

      const result = await service.createEntry('contest-1', 'user-1');

      expect(result.entryNumber).toBe(2);
      expect(entryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 2,
        name: "Derek's Squad Entry 2",
      }));
    });

    it('returns the joined entry state for pre-draft contest views', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.DRAFT });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        entries: createMockEntryRepo(),
      });

      const result = await service.listEntries('contest-1', 'user-1');

      expect(result.isJoined).toBe(true);
      expect(result.myEntryId).toBe('entry-1');
      expect(result.entries[0].squadName).toBe("Derek's Squad");
    });

    it('pool-master-eux.4: computes the Golf leaderboard from event standings instead of ContestEntry totals', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventId: 'event-1',
        status: ContestStatus.ACTIVE,
      });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(
          buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' }),
        ),
      });
      const configurationRepo = createMockContestConfigurationRepo({
        findByContest: jest.fn().mockResolvedValue({
          id: 'config-1',
          contestId: 'contest-1',
          configJson: { countedScores: 2 },
          rosterSize: 3,
          pickCount: 3,
          rounds: 4,
        }),
      });
      // Every configuration carries its scoring rule (#246); there is no golf fallback.
      const scoringRuleRepo = fakeParticipantContestScoringRuleRepo({
        findByContestConfiguration: jest.fn().mockResolvedValue([
          { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true },
        ]),
      });
      const listEventParticipants = jest.fn().mockResolvedValue([
        buildGolfFieldView({
          id: 'sep-1',
          participantName: 'Rory McIlroy',
          eventScoreToPar: -5,
          eventStrokes: 139,
          status: 'IN_PROGRESS',
          currentRound: 2,
          currentRoundThru: 9,
          rounds: [
            { round: 1, strokes: 69, scoreToPar: -3, thru: null, status: 'COMPLETED' },
            { round: 2, strokes: 47, scoreToPar: -2, thru: 9, status: 'IN_PROGRESS' },
          ],
        }),
        buildGolfFieldView({
          id: 'sep-2',
          participantName: 'Scottie Scheffler',
          eventScoreToPar: -2,
          eventStrokes: 142,
          status: 'COMPLETE',
          currentRound: 2,
          currentRoundThru: 18,
        }),
        buildGolfFieldView({
          id: 'sep-3',
          participantName: 'Jordan Spieth',
          eventScoreToPar: 1,
          eventStrokes: 145,
          status: 'COMPLETE',
        }),
        buildGolfFieldView({
          id: 'sep-4',
          participantName: 'Ludvig Aberg',
          eventScoreToPar: -7,
          eventStrokes: 137,
          status: 'COMPLETE',
        }),
      ]);
      const entryRepo = createMockEntryRepo({
        findByContestWithSquad: jest.fn().mockResolvedValue([
          {
            ...DEFAULT_ENTRY_WITH_SQUAD,
            id: 'entry-1',
            entryNumber: 1,
            name: 'Legacy Inflated Entry',
            squadId: 'squad-1',
            squadName: 'Ryans Gonna Win',
          },
          {
            ...DEFAULT_ENTRY_WITH_SQUAD,
            id: 'entry-2',
            entryNumber: 2,
            name: 'Live Standing Entry',
            squadId: 'squad-2',
            squadName: 'Lets Go Cam!',
          },
        ]),
      });
      const pickRepo = fakeContestEntryPickRepo({
        findByEntries: jest.fn().mockResolvedValue([
          buildGolfLeaderboardPick('pick-1', 'entry-1', 'sep-1'),
          buildGolfLeaderboardPick('pick-2', 'entry-1', 'sep-2'),
          buildGolfLeaderboardPick('pick-3', 'entry-1', 'sep-3'),
          buildGolfLeaderboardPick('pick-4', 'entry-2', 'sep-4'),
          buildGolfLeaderboardPick('pick-5', 'entry-2', 'sep-2'),
          buildGolfLeaderboardPick('pick-6', 'entry-2', 'sep-3'),
        ]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: configurationRepo,
        scoringRules: scoringRuleRepo,
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo(),
        entries: entryRepo,
        picks: pickRepo,
        eventParticipants: { listEventParticipants },
      });

      const result = await service.getGolfLeaderboard('contest-1', 'user-1');

      expect(result.scoringDefinitionId).toBe('GOLF_RELATIVE_TO_PAR_TOTAL');
      expect(result.countingRule).toEqual({ type: 'BEST_N_GOLFERS', count: 2 });
      expect(result.entries.map((entry) => [entry.entryId, entry.score, entry.position])).toEqual([
        ['entry-2', -9, 1],
        ['entry-1', -7, 2],
      ]);
      expect(result.entries[0].picks.map((pick) => ({
        pickId: pick.pickId,
        isCounting: pick.isCounting,
        isDropped: pick.isDropped,
      }))).toEqual([
        { pickId: 'pick-4', isCounting: true, isDropped: false },
        { pickId: 'pick-5', isCounting: true, isDropped: false },
        { pickId: 'pick-6', isCounting: false, isDropped: true },
      ]);
      // The field is the event's own rows, passed through; the server no longer preformats
      // rounds (#248). Rendered through the definition the leaderboard names, they read as the
      // deleted displayValue did: strokes once complete, to par while in progress.
      expect(result.participants).toBe(await listEventParticipants.mock.results[0].value);
      const rory = result.participants.find((participant) => participant.entry.id === 'sep-1');
      const { formatRound } = PARTICIPANT_SCORING_DEFINITIONS[result.scoringDefinitionId];
      expect(rory?.rounds.map(({ round, golf }) => formatRound({ status: round.status, ...golf! })))
        .toEqual(['69', '-2']);
      // Entry order is the port's contract (entryNumber, then createdAt); only active entries count.
      expect(entryRepo.findByContestWithSquad).toHaveBeenCalledWith('contest-1', { activeOnly: true });
      expect(listEventParticipants).toHaveBeenCalledWith('event-1');
    });

    it('rejects leaving a contest after picks already exist', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const pickRepo = fakeContestEntryPickRepo({
        countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 1]])),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        entries: entryRepo,
        picks: pickRepo,
      });

      await expect(service.deleteMyEntry('contest-1', 'user-1')).rejects.toThrow(
        'Cannot leave a contest after making picks or draft selections',
      );
      expect(entryRepo.delete).not.toHaveBeenCalled();
    });

    it('renames a team-owned contest entry while the contest is still open', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: "Derek's Squad Entry 2",
            status: 'ACTIVE',
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
        update: jest.fn().mockImplementation(async (id, updates) => ({
          id,
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: id === 'entry-1' ? 1 : 2,
          name: updates.name ?? "Derek's Squad Entry 1",
          status: 'ACTIVE',
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        })),
      });
      entryRepo.findByIdWithSquad = jest.fn().mockResolvedValue({
        ...DEFAULT_ENTRY_WITH_SQUAD,
        name: 'Renamed Entry',
        updatedAt: new Date('2026-01-02'),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        entries: entryRepo,
      });

      const result = await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        name: '  Renamed Entry  ',
      });

      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { name: 'Renamed Entry' });
      expect(result.name).toBe('Renamed Entry');
    });

    it('rejects renaming a contest entry to a duplicate team entry name', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            tiebreakerValue: null,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: 'Second Bullet',
            status: 'ACTIVE',
            tiebreakerValue: null,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        entries: entryRepo,
      });

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', {
        name: ' second bullet ',
      })).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_NAME_DUPLICATE',
      });
      expect(entryRepo.update).not.toHaveBeenCalled();
    });

    it('rejects renaming a contest entry after the contest locks', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.LOCKED });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        entries: createMockEntryRepo(),
      });

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', {
        name: 'Renamed Entry',
      })).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_LOCKED',
      });
    });

    it('updates the contest-entry tiebreaker prediction without renaming the entry', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            tiebreakerValue: null,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      entryRepo.findByIdWithSquad = jest.fn().mockResolvedValue({
        ...DEFAULT_ENTRY_WITH_SQUAD,
        tiebreakerValue: 271,
        updatedAt: new Date('2026-01-02'),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
        }),
        entries: entryRepo,
      });

      const result = await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { tiebreakerValue: 271 });
      expect(result.tiebreakerValue).toBe(271);
    });

    it('pool-master-95b sends confirmation email after a completed entry is saved', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Masters Pick 2',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn().mockResolvedValue({ provider: 'smtp' as const, messageId: 'mail-1' }),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        configurations: createMockContestConfigurationRepo({
          findByContest: jest.fn().mockResolvedValue({
            tierConfig: [
              {
                tierId: 'tier-a',
                tierName: 'Tier A',
                tierNumber: 1,
                picksFromTier: 1,
                participantIds: ['participant-1'],
              },
              {
                tierId: 'tier-b',
                tierName: 'Tier B',
                tierNumber: 2,
                picksFromTier: 1,
                participantIds: ['participant-2'],
              },
            ],
            rosterSize: 2,
          }),
        }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS' }),
        }),
        users: fakeUserRepo({ findById: jest.fn().mockResolvedValue(RECEIPT_USER) }),
        memberships: createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
        }),
        entries: createMockEntryRepo({
          findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
          findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(271)),
        }),
        picks: fakeContestEntryPickRepo({
          countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 2]])),
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
            buildReceiptPick('pick-2', 'sport-event-participant-2', 'participant-2', 'Tommy Fleetwood', '2026-01-01T12:01:00.000Z'),
          ]),
        }),
        mailDelivery: mailDelivery,
        appBaseUrl: 'https://app.primetimecommissioner.com',
      });

      await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
      expect(mailDelivery.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'derek@example.com',
        subject: 'Entry submitted: Masters Pick 2',
        metadata: {
          templateKey: 'CONTEST_ENTRY_COMPLETED',
          leagueId: 'league-1',
          contestId: 'contest-1',
          entryId: 'entry-1',
        },
      }));
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('Tier A: Rory McIlroy');
      expect(sentMessage.text).toContain('Tier B: Tommy Fleetwood');
      expect(sentMessage.text).toContain('Tiebreaker: +271');
      expect(sentMessage.text).toContain(
        'Review entry: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1/entries/entry-1',
      );
      expect(sentMessage.html).toContain('Prime Time Commissioner');
    });

    it('pool-master-piv falls back to SportEventTierService for the email tier grouping when the contest has no typed tierConfig', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventId: 'event-1',
        name: 'Masters Pick 2',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      // The event's effective tiers, as SportEventTierService resolves them.
      const tiers = {
        getEffectiveValuationsForSportEvent: jest.fn().mockResolvedValue([
          { sportEventParticipantId: 'sport-event-participant-1', tierLabel: 'Tier A' },
          { sportEventParticipantId: 'sport-event-participant-2', tierLabel: 'Tier B' },
        ]),
      };
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn().mockResolvedValue({ provider: 'smtp' as const, messageId: 'mail-1' }),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        configurations: createMockContestConfigurationRepo({
          findByContest: jest.fn().mockResolvedValue({ rosterSize: 2 }),
        }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS' }),
        }),
        users: fakeUserRepo({ findById: jest.fn().mockResolvedValue(RECEIPT_USER) }),
        memberships: createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
        }),
        entries: createMockEntryRepo({
          findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
          findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(271)),
        }),
        picks: fakeContestEntryPickRepo({
          countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 2]])),
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
            buildReceiptPick('pick-2', 'sport-event-participant-2', 'participant-2', 'Tommy Fleetwood', '2026-01-01T12:01:00.000Z'),
          ]),
        }),
        tiers,
        mailDelivery: mailDelivery,
        appBaseUrl: 'https://app.primetimecommissioner.com',
      });

      await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(tiers.getEffectiveValuationsForSportEvent).toHaveBeenCalledWith('event-1');
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('Tier A: Rory McIlroy');
      expect(sentMessage.text).toContain('Tier B: Tommy Fleetwood');
    });

    it('pool-master-95b skips confirmation email until roster and tiebreaker are complete', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Masters Pick 2',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn(),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        configurations: createMockContestConfigurationRepo({
          findByContest: jest.fn().mockResolvedValue({
            tierConfig: [
              { tierName: 'Tier A', tierNumber: 1, picksFromTier: 1, participantIds: ['participant-1'] },
              { tierName: 'Tier B', tierNumber: 2, picksFromTier: 1, participantIds: ['participant-2'] },
            ],
            rosterSize: 2,
          }),
        }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS' }),
        }),
        memberships: createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
        }),
        entries: createMockEntryRepo({
          findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
          findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(271)),
        }),
        // One of the two roster spots is filled.
        picks: fakeContestEntryPickRepo({
          countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 1]])),
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
          ]),
        }),
        mailDelivery: mailDelivery,
      });

      await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(mailDelivery.send).not.toHaveBeenCalled();
    });

    it('pool-master-95b keeps the saved entry when confirmation email delivery fails', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Masters Pick 1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
        findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(-12)),
      });
      const mailDelivery = {
        providerName: 'ses' as const,
        send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        configurations: createMockContestConfigurationRepo({
          findByContest: jest.fn().mockResolvedValue({
            tierConfig: [{ tierName: 'Tier A', tierNumber: 1, picksFromTier: 1, participantIds: ['participant-1'] }],
            rosterSize: 1,
          }),
        }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS' }),
        }),
        users: fakeUserRepo({ findById: jest.fn().mockResolvedValue(RECEIPT_USER) }),
        memberships: createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
        }),
        entries: entryRepo,
        picks: fakeContestEntryPickRepo({
          countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 1]])),
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
          ]),
        }),
        mailDelivery: mailDelivery,
      });

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: -12,
      })).resolves.toEqual(expect.objectContaining({ id: 'entry-1' }));
      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { tiebreakerValue: -12 });
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEntryDetail', () => {
    // pool-master-uvc — proves this call site delegates to the shared
    // deriveLegacyParticipantStatus derivation rather than a second copy of the
    // same ternary; the derivation's own branches are covered directly in
    // tests/unit/shared/domain-models.test.ts.
    it('derives participantStatus via the shared deriveLegacyParticipantStatus function', async () => {
      const deriveSpy = jest.spyOn(SharedDomainEnums, 'deriveLegacyParticipantStatus');

      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ id: 'contest-1', leagueId: 'league-1' })),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership()),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: membershipRepo,
        squads: createMockSquadRepo(),
        squadMemberships: squadMembershipRepo,
        entries: createMockEntryRepo({
          findByIdWithSquad: jest.fn().mockResolvedValue({
            ...DEFAULT_ENTRY_WITH_SQUAD,
            name: 'Withdrawn Golfer Entry',
          }),
        }),
        picks: fakeContestEntryPickRepo({
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            {
              ...buildReceiptPick('pick-1', 'sep-1', 'participant-1', 'Withdrawn Golfer', '2026-05-01T00:00:00.000Z'),
              participant: {
                participantId: 'participant-1',
                participantName: 'Withdrawn Golfer',
                isActive: false,
                inactiveReason: 'WITHDRAWN',
                role: null,
                teamAffiliation: null,
              },
            },
          ]),
        }),
      });

      const { entry } = await service.getEntryDetail('contest-1', 'entry-1', 'user-1');

      expect(deriveSpy).toHaveBeenCalledWith(false, 'WITHDRAWN');
      deriveSpy.mockRestore();
      expect(entry.participants).toEqual([
        expect.objectContaining({ participantName: 'Withdrawn Golfer', participantStatus: 'WITHDRAWN' }),
      ]);
    });
  });

  describe('listEntries', () => {
    // pool-master-uvc — same shared-function proof as getEntryDetail above, for
    // the other contests/service.ts call site (loadParticipantsForEntries).
    it('derives participantStatus via the shared deriveLegacyParticipantStatus function', async () => {
      const deriveSpy = jest.spyOn(SharedDomainEnums, 'deriveLegacyParticipantStatus');

      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(
          buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.ACTIVE }),
        ),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo(),
        entries: createMockEntryRepo({
          findByContestWithSquad: jest.fn().mockResolvedValue([
            { ...DEFAULT_ENTRY_WITH_SQUAD, name: 'Cut Golfer Entry' },
          ]),
        }),
        picks: fakeContestEntryPickRepo({
          countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 1]])),
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            {
              ...buildReceiptPick('pick-1', 'sep-1', 'participant-1', 'Cut Golfer', '2026-05-01T00:00:00.000Z'),
              participant: {
                participantId: 'participant-1',
                participantName: 'Cut Golfer',
                isActive: false,
                inactiveReason: 'ELIMINATED',
                role: null,
                teamAffiliation: null,
              },
            },
          ]),
        }),
      });

      const { entries } = await service.listEntries('contest-1', 'user-1');

      expect(deriveSpy).toHaveBeenCalledWith(false, 'ELIMINATED');
      deriveSpy.mockRestore();
      expect(entries[0].participants).toEqual([
        expect.objectContaining({ participantName: 'Cut Golfer', participantStatus: 'ELIMINATED' }),
      ]);
    });
  });

  /**
   * #291 — getEntryContext is the one resolver behind every entry operation, and it hands out only
   * ACTIVE memberships. Leaving a league keeps both rows as INACTIVE, so before this a removed
   * member could still rename or delete their former squad's entries.
   */
  describe('entry access resolves only ACTIVE memberships (#291)', () => {
    const openContest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });

    function serviceFor(options: {
      league: ReturnType<typeof buildMembership> | null;
      squad: Awaited<ReturnType<SquadMembershipRepository['findByLeagueAndUser']>>;
      entries?: ContestEntryRepository;
    }) {
      return buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(openContest) }),
        memberships: createMockMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(options.league),
        }),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(options.squad),
        }),
        entries: options.entries ?? createMockEntryRepo({
          findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
        }),
      });
    }

    const inactiveLeague = buildMembership({ status: LeagueMembershipStatus.INACTIVE });
    const inactiveSquad = { ...ACTIVE_SQUAD_MEMBERSHIP, status: SquadMembershipStatus.INACTIVE as SquadMembershipStatus };

    it.each([
      ['updateEntry', (service: ContestService) => service.updateEntry('contest-1', 'entry-1', 'user-1', { name: 'Renamed' })],
      ['deleteMyEntry', (service: ContestService) => service.deleteMyEntry('contest-1', 'user-1')],
      ['createEntry', (service: ContestService) => service.createEntry('contest-1', 'user-1')],
    ])('%s refuses a former league member with LEAGUE_MEMBERSHIP_INACTIVE and writes nothing', async (_name, act) => {
      const entries = createMockEntryRepo({ findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]) });
      const service = serviceFor({ league: inactiveLeague, squad: inactiveSquad, entries });

      await expect(act(service)).rejects.toMatchObject({
        name: 'ContestEntryAccessError',
        code: 'LEAGUE_MEMBERSHIP_INACTIVE',
      });
      expect(entries.update).not.toHaveBeenCalled();
      expect(entries.delete).not.toHaveBeenCalled();
      expect(entries.create).not.toHaveBeenCalled();
    });

    it('refuses a non-member with LEAGUE_MEMBERSHIP_REQUIRED, a different code from an ended membership', async () => {
      const service = serviceFor({ league: null, squad: null });

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', { name: 'Renamed' }))
        .rejects.toMatchObject({ name: 'ContestEntryAccessError', code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
    });

    it('refuses an active league member whose squad membership has ended with SQUAD_MEMBERSHIP_INACTIVE', async () => {
      const entries = createMockEntryRepo({ findBySquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]) });
      const service = serviceFor({ league: buildMembership(), squad: inactiveSquad, entries });

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', { name: 'Renamed' }))
        .rejects.toMatchObject({ name: 'ContestEntryAccessError', code: 'SQUAD_MEMBERSHIP_INACTIVE' });
      expect(entries.update).not.toHaveBeenCalled();
    });

    it('keeps "no squad at all" distinct: SQUAD_MANAGER_REQUIRED for a change, SQUAD_MEMBERSHIP_REQUIRED for a create', async () => {
      await expect(serviceFor({ league: buildMembership(), squad: null })
        .updateEntry('contest-1', 'entry-1', 'user-1', { name: 'Renamed' }))
        .rejects.toMatchObject({ code: 'SQUAD_MANAGER_REQUIRED' });
      await expect(serviceFor({ league: buildMembership(), squad: null })
        .createEntry('contest-1', 'user-1'))
        .rejects.toMatchObject({ code: 'SQUAD_MEMBERSHIP_REQUIRED' });
    });

    it('getMyEntry returns null, not an error, both for no squad and for an ended squad membership', async () => {
      await expect(serviceFor({ league: buildMembership(), squad: null }).getMyEntry('contest-1', 'user-1'))
        .resolves.toBeNull();
      await expect(serviceFor({ league: buildMembership(), squad: inactiveSquad }).getMyEntry('contest-1', 'user-1'))
        .resolves.toBeNull();
    });
  });
});
