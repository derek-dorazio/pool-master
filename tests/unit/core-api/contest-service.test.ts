import type { ContestEntryCreateLimits } from '@poolmaster/shared/db';
import * as SharedDomainEnums from '@poolmaster/shared/domain/enums';
import {
  ContestService,
  ContestNotFoundError,

  type ContestServiceDeps,
  type EntrySubmittedReceiptInput,
} from '../../../packages/core-api/src/modules/contests/service';
import type { ParticipantValuationView } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
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
  LeaguePlan,
  LeagueRole,
  SelectionType,
  Sport,
  SportEventStatus,
  SquadMembershipStatus,
  TeamIconKey,
  parseContestScoringSettings,
  type Contest,
  type ContestConfiguration,
  type ParticipantContestScoringRule,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { buildContest, buildMembership, buildUser } from '../../factories';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeContestEntryEventStandingRepo,
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
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';
import { expectDefined } from '../../support/expect-defined';
import { deliverQueuedEmail, emailServiceOver } from '../../support/email-service';
import { platinumEntitlements } from '../../support/plan-entitlements';

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
  events: [{ sportEventId: 'event-1', status: 'SUBMITTED' as const }],
  tiebreakerValue: undefined,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  squadName: "Derek's Squad",
};

function createMockEntryRepo(overrides: Partial<ContestEntryRepository> = {}): ContestEntryRepository {
  return fakeContestEntryRepo({
    findByIdWithSquad: jest.fn().mockResolvedValue(DEFAULT_ENTRY_WITH_SQUAD),
    findByContestWithSquad: jest.fn().mockResolvedValue([DEFAULT_ENTRY_WITH_SQUAD]),
    create: mockFn<ContestEntryRepository['create']>(async (input) => ({
      status: 'created',
      entry: {
        ...input,
        events: [],
        id: 'entry-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    })),
    update: mockFn<ContestEntryRepository['update']>(async (id, updates) => ({
      id,
      contestId: 'contest-1',
      squadId: 'squad-1',
      entryNumber: 1,
      name: 'Ace Squad Entry 1',
      events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
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

/** The default contest event: a golf event already under way, so a live contest's picks are revealed. */
const STARTED_EVENT = {
  id: 'event-1',
  name: 'The Masters',
  sportLeagueId: 'pga-tour',
  sport: Sport.GOLF,
  status: SportEventStatus.IN_PROGRESS,
  startDate: new Date('2026-01-01T12:00:00.000Z'),
} as SportEvent;

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
    expansions: { findHighestBands: async () => new Map() },
    picks: fakeContestEntryPickRepo(),
    predictions: { findByEntriesAndEvent: jest.fn().mockResolvedValue([]), findByEntriesAndEvents: jest.fn().mockResolvedValue([]) },
    matches: { findBySportEvent: jest.fn().mockResolvedValue([]), findBySportEvents: jest.fn().mockResolvedValue([]) },
    participants: { findByIds: jest.fn().mockResolvedValue([]) },
    standings: fakeContestEntryStandingRepo(),
    eventStandings: fakeContestEntryEventStandingRepo(),
    memberships: createMockMembershipRepo(),
    squads: createMockSquadRepo(),
    squadMemberships: createMockSquadMembershipRepo(),
    leagues: fakeLeagueRepo({
      findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Big Dawgs', leagueCode: 'BIGDAWGS' }),
    }),
    planEntitlements: platinumEntitlements(),
    users: fakeUserRepo({
      findById: jest.fn().mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' })),
    }),
    sportEvents: fakeSportEventRepo({
      findById: jest.fn().mockResolvedValue(STARTED_EVENT),
      findByIds: jest.fn().mockImplementation(async (ids: readonly string[]) => (ids.includes(STARTED_EVENT.id) ? [STARTED_EVENT] : [])),
      countParticipants: jest.fn().mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, 1]))),
    }),
    sportLeagues: { findById: jest.fn().mockResolvedValue({ id: 'pga-tour', name: 'PGA Tour' }) },
    eventParticipants: { listEventParticipants: jest.fn().mockResolvedValue([]) },
    tiers: { listTiers: jest.fn().mockResolvedValue([]) },
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
  events: [{ sportEventId: 'event-1', status: 'SUBMITTED' as const }],
  tiebreakerValue: undefined,
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
    sportEventId: 'event-1',
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

/** An effective valuation as `SportEventTierService` resolves one: untiered and unpriced unless given. */
function receiptValuation(
  sportEventParticipantId: string,
  overrides: { tierLabel?: string; price?: number } = {},
): ParticipantValuationView {
  return {
    sportEventParticipantId,
    participantId: `participant-of-${sportEventParticipantId}`,
    tierId: null,
    tierKey: null,
    tierLabel: overrides.tierLabel ?? null,
    tierNumber: null,
    tierOrderIndex: null,
    price: overrides.price ?? null,
  };
}

/** A contest configuration holding the given typed rules. */
function receiptConfiguration(configJson: NonNullable<ContestConfiguration['configJson']>): ContestConfiguration {
  return {
    id: 'configuration-1',
    contestId: 'contest-1',
    selectionType: configJson.selectionType,
    configJson,
  } as ContestConfiguration;
}

/**
 * What the selection room hands the receipt for entry-1 in event-1: the contest, the event, no
 * configuration, no valuations and the squad's one owner, unless given.
 */
function receiptInput(contest: Contest, overrides: Partial<EntrySubmittedReceiptInput> = {}): EntrySubmittedReceiptInput {
  return {
    contest,
    sportEvent: STARTED_EVENT,
    configuration: null,
    valuations: [],
    squadMemberships: [ACTIVE_SQUAD_MEMBERSHIP],
    entryIds: ['entry-1'],
    ...overrides,
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
    raceResult: null,
    matches: [],
    affiliatedWithSportLeague: true,
  };
}

function buildGolfLeaderboardPick(id: string, entryId: string, sportEventParticipantId: string) {
  return {
    id,
    entryId,
    sportEventId: 'event-1',
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

  describe('getContest', () => {
    it.each([
      ['a member', LeagueRole.MEMBER, false],
      ['a commissioner', LeagueRole.COMMISSIONER, true],
    ] as const)('reads a draft contest as missing for anyone but its commissioners: %s finds it = %s', async (_who, role, found) => {
      const service = buildService({
        contests: createMockContestRepo({
          findById: jest.fn().mockResolvedValue(buildContest({ id: 'draft', status: ContestStatus.DRAFT })),
        }),
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({ role })),
        }),
      });

      const result = await service.getContest('draft', { userId: 'user-1', isRootAdmin: false });

      expect(result !== null).toBe(found);
    });
  });

  describe('listByLeague', () => {
    it('lists the current contests as of now by default (#1161)', async () => {
      const now = new Date('2026-06-10T12:00:00.000Z');
      const contestRepo = createMockContestRepo({
        findCurrentByLeague: jest.fn().mockResolvedValue([buildContest(), buildContest()]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
        now: () => now,
      });

      const result = await service.listByLeague('league-1', { userId: 'user-1', isRootAdmin: true });

      expect(result).toHaveLength(2);
      expect(contestRepo.findCurrentByLeague).toHaveBeenCalledWith('league-1', now);
      expect(contestRepo.findFinishedByLeague).not.toHaveBeenCalled();
    });

    it('lists the contests that went final in a finished year, from midnight 1 January in New York to the next (#1161)', async () => {
      const finished = buildContest({ id: 'finished', status: ContestStatus.COMPLETED });
      const contestRepo = createMockContestRepo({
        findFinishedByLeague: jest.fn().mockResolvedValue([finished]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });

      const result = await service.listByLeague('league-1', { userId: 'user-1', isRootAdmin: false }, 2025);

      expect(result).toEqual([finished]);
      expect(contestRepo.findFinishedByLeague).toHaveBeenCalledWith(
        'league-1',
        new Date('2025-01-01T05:00:00.000Z'),
        new Date('2026-01-01T05:00:00.000Z'),
      );
      expect(contestRepo.findCurrentByLeague).not.toHaveBeenCalled();
    });

    it.each([
      ['a member', LeagueRole.MEMBER, false, ['open']],
      ['a commissioner', LeagueRole.COMMISSIONER, false, ['draft', 'open']],
      ['a root admin who is not a member', null, true, ['draft', 'open']],
    ] as const)('lists draft contests only to their commissioners: %s sees %j', async (_who, role, isRootAdmin, expected) => {
      const contestRepo = createMockContestRepo({
        findCurrentByLeague: jest.fn().mockResolvedValue([
          buildContest({ id: 'draft', status: ContestStatus.DRAFT }),
          buildContest({ id: 'open', status: ContestStatus.OPEN }),
        ]),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(
            role === null ? null : buildMembership({ role }),
          ),
        }),
      });

      const result = await service.listByLeague('league-1', { userId: 'user-1', isRootAdmin });

      expect(result.map((contest) => contest.id)).toEqual(expected);
    });

    it('counts the listed contests\' submitted entries in one grouped read, never reading entries one contest at a time (#1161)', async () => {
      const entryRepo = createMockEntryRepo({
        countSubmittedByContests: jest.fn().mockResolvedValue(new Map([['contest-1', 2], ['contest-2', 1]])),
      });
      const service = buildService({
        contests: createMockContestRepo(),
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
        entries: entryRepo,
      });

      const counts = await service.countEntriesByContest(['contest-1', 'contest-2']);

      expect(counts).toEqual(new Map([['contest-1', 2], ['contest-2', 1]]));
      expect(entryRepo.countSubmittedByContests).toHaveBeenCalledTimes(1);
      expect(entryRepo.findByContest).not.toHaveBeenCalled();
    });
  });

  describe('getContest', () => {
    it('returns the contest', async () => {
      const contest = buildContest({ id: 'c-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = buildService({
        contests: contestRepo,
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo(),
      });
      const result = await service.getContest('c-1');
      expect(expectDefined(result).id).toBe('c-1');
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
        findByContestAndSquad: jest.fn().mockResolvedValue([]),
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
      }), expect.anything());
      // A Platinum league's contest takes 500 entries, or more once expanded past that.
      const limits: ContestEntryCreateLimits = jest.mocked(entryRepo.create).mock.calls[0][1];
      expect([limits.entriesPerContest(null), limits.entriesPerContest(200), limits.entriesPerContest(1000)]).toEqual([500, 500, 1000]);
    });

    it('refuses an entry in a DRAFT contest with CONTEST_ENTRY_LOCKED and writes nothing, until the commissioner opens it', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.DRAFT });
      const entryRepo = createMockEntryRepo({
        findByContestAndSquad: jest.fn().mockResolvedValue([]),
      });
      const service = buildService({
        contests: createMockContestRepo({
          findById: jest.fn().mockResolvedValue(contest),
        }),
        configurations: createMockContestConfigurationRepo(),
        memberships: createMockMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(
            buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' }),
          ),
        }),
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

      await expect(service.createEntry('contest-1', 'user-1'))
        .rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
      expect(entryRepo.create).not.toHaveBeenCalled();
    });

    describe('when a random draw closes the contest while the write is on its way', () => {
      const activeSquadMembership = {
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };

      function serviceWithEntries(entries: ContestEntryRepository) {
        return buildService({
          contests: createMockContestRepo({
            findById: jest.fn().mockResolvedValue(
              buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN }),
            ),
          }),
          configurations: createMockContestConfigurationRepo(),
          memberships: createMockMembershipRepo({
            findByLeagueAndUser: jest.fn().mockResolvedValue(
              buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' }),
            ),
          }),
          squads: createMockSquadRepo(),
          squadMemberships: createMockSquadMembershipRepo({
            findByLeagueAndUser: jest.fn().mockResolvedValue(activeSquadMembership),
          }),
          entries,
        });
      }

      it('refuses the new entry with CONTEST_ENTRY_LOCKED when the repository finds the contest drawn', async () => {
        const service = serviceWithEntries(createMockEntryRepo({
          findByContestAndSquad: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ status: 'contestDrawn' }),
        }));

        await expect(service.createEntry('contest-1', 'user-1'))
          .rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
      });

      it('refuses to leave with CONTEST_ENTRY_LOCKED when the repository finds the contest drawn', async () => {
        const service = serviceWithEntries(createMockEntryRepo({
          findByContestAndSquad: jest.fn().mockResolvedValue([{
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'DRAFT',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }]),
          delete: jest.fn().mockResolvedValue({ status: 'contestDrawn' }),
        }));

        await expect(service.deleteMyEntry('contest-1', 'user-1'))
          .rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
      });
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
        findByContestAndSquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
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
        sportEventIds: ['sport-event-1'],
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
        findByContestAndSquad: jest.fn().mockResolvedValue([]),
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

    it("allows additional entry creation when the contest configuration is unlimited, numbering it from one read of the squad's entries in that contest (#1167)", async () => {
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
        findByContestAndSquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
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
            configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
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
      }), expect.anything());
      expect(entryRepo.findByContestAndSquad).toHaveBeenCalledTimes(1);
      expect(entryRepo.findByContestAndSquad).toHaveBeenCalledWith('contest-1', 'squad-1');
      // A Platinum league's contest takes 500 entries, or more once expanded past that.
      const limits: ContestEntryCreateLimits = jest.mocked(entryRepo.create).mock.calls[0][1];
      expect([limits.entriesPerContest(null), limits.entriesPerContest(200), limits.entriesPerContest(1000)]).toEqual([500, 500, 1000]);
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
        sportEventIds: ['event-1'],
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
          rounds: 4,
        }),
      });
      // Every configuration carries its scoring rule (#246); there is no golf fallback.
      const scoringRuleRepo = fakeParticipantContestScoringRuleRepo({
        findByContestConfiguration: jest.fn().mockResolvedValue([
          storedScoringRule({ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true }),
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
          {
            ...DEFAULT_ENTRY_WITH_SQUAD,
            id: 'entry-3',
            entryNumber: 3,
            name: 'Never Submitted Entry',
            squadId: 'squad-3',
            squadName: 'Still Drafting',
            events: [{ sportEventId: 'event-1', status: 'DRAFT' as const }],
          },
        ]),
      });
      const pickRepo = fakeContestEntryPickRepo({
        findByEntriesAndEvents: jest.fn().mockResolvedValue([
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

      const result = await service.getLeaderboard('contest-1', 'user-1');

      expect(result.scoringDefinitionId).toBe('GOLF_RELATIVE_TO_PAR_TOTAL');
      expect(result.countingRule).toEqual({ type: 'BEST_N', count: 2 });
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
      const formatRound = expectDefined(PARTICIPANT_SCORING_DEFINITIONS[result.scoringDefinitionId].formatRound);
      expect(rory?.rounds.map(({ round, golf }) => formatRound({ status: round.status, ...expectDefined(golf) })))
        .toEqual(['69', '-2']);
      // Only the entries that submitted the event count: entry 3 is still a draft, so off the board.
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
        findByContestAndSquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
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
        findByContestAndSquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: "Derek's Squad Entry 2",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
        update: mockFn<ContestEntryRepository['update']>(async (id, updates) => ({
          id,
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: id === 'entry-1' ? 1 : 2,
          name: updates.name ?? "Derek's Squad Entry 1",
          events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
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
        findByContestAndSquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
            tiebreakerValue: null,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: 'Second Bullet',
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
            tiebreakerValue: null,
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

    it('rejects renaming a contest entry once the contest is live', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.ACTIVE });
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
        findByContestAndSquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            events: [{ sportEventId: 'event-1', status: 'SUBMITTED' }],
            tiebreakerValue: null,
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

    it('sends the Entry submitted confirmation with each tier\'s golfer, the tiebreaker and a link to the entry', async () => {
      const picks = fakeContestEntryPickRepo({
        countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 2]])),
        findByEntriesWithParticipant: jest.fn().mockResolvedValue([
          buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
          buildReceiptPick('pick-2', 'sport-event-participant-2', 'participant-2', 'Tommy Fleetwood', '2026-01-01T12:01:00.000Z'),
        ]),
      });
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventIds: ['event-1'],
        name: 'Masters Pick 2',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS', plan: LeaguePlan.PLATINUM }),
        }),
        users: fakeUserRepo({ findByIds: jest.fn().mockResolvedValue([RECEIPT_USER]) }),
        memberships: createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
          findBySquad: jest.fn().mockResolvedValue([ACTIVE_SQUAD_MEMBERSHIP]),
        }),
        entries: createMockEntryRepo({
          findByContestAndSquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
          findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(271)),
        }),
        picks,
        email: emailServiceOver(mailDelivery),
        appBaseUrl: 'https://app.primetimecommissioner.com',
      });

      // The event's effective tiers, as the selection room already holds them.
      await service.sendEntrySubmittedEmails(receiptInput(contest, {
        valuations: [
          receiptValuation('sport-event-participant-1', { tierLabel: 'Tier A' }),
          receiptValuation('sport-event-participant-2', { tierLabel: 'Tier B' }),
        ],
      }));

      expect(picks.findByEntriesWithParticipant).toHaveBeenCalledWith(['entry-1'], { sportEventId: 'event-1' });
      await deliverQueuedEmail();
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
      expect(sentMessage.html).toContain('Primetime Commissioner');
    });

    it('adds the salary a budget lineup spent to its confirmation, and no tiebreaker line where the sport has none', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventIds: ['event-1'],
        name: 'Daytona Budget',
        status: ContestStatus.OPEN,
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS', plan: LeaguePlan.PLATINUM }),
        }),
        users: fakeUserRepo({ findByIds: jest.fn().mockResolvedValue([RECEIPT_USER]) }),
        squadMemberships: createMockSquadMembershipRepo({
          findBySquad: jest.fn().mockResolvedValue([ACTIVE_SQUAD_MEMBERSHIP]),
        }),
        entries: createMockEntryRepo({ findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(150)) }),
        picks: fakeContestEntryPickRepo({
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Kyle Larson', '2026-01-01T12:00:00.000Z'),
            buildReceiptPick('pick-2', 'sport-event-participant-2', 'participant-2', 'Chase Elliott', '2026-01-01T12:01:00.000Z'),
          ]),
        }),
        email: emailServiceOver(mailDelivery),
        appBaseUrl: 'https://app.primetimecommissioner.com',
      });

      await service.sendEntrySubmittedEmails(receiptInput(contest, {
        sportEvent: { ...STARTED_EVENT, sport: Sport.AUTO_RACING },
        configuration: receiptConfiguration({
          selectionType: SharedDomainEnums.SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 50_000, countedScores: 2,
        }),
        valuations: [
          receiptValuation('sport-event-participant-1', { price: 26_000 }),
          receiptValuation('sport-event-participant-2', { price: 22_500 }),
        ],
      }));

      await deliverQueuedEmail();
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('- Salary: $48,500 of $50,000');
      expect(sentMessage.text).not.toContain('Tiebreaker');
    });

    it('sends a quick pick entry its dealt picks with no submit time and no tiebreaker line it never gave', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventIds: ['event-1'],
        name: 'Masters Quick Pick',
        status: ContestStatus.OPEN,
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS', plan: LeaguePlan.PLATINUM }),
        }),
        users: fakeUserRepo({ findByIds: jest.fn().mockResolvedValue([RECEIPT_USER]) }),
        squadMemberships: createMockSquadMembershipRepo({
          findBySquad: jest.fn().mockResolvedValue([ACTIVE_SQUAD_MEMBERSHIP]),
        }),
        entries: createMockEntryRepo({ findByIdWithSquad: jest.fn().mockResolvedValue({ ...DEFAULT_ENTRY_WITH_SQUAD, tiebreakerValue: null }) }),
        picks: fakeContestEntryPickRepo({
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
            buildReceiptPick('pick-2', 'sport-event-participant-2', 'participant-2', 'Tommy Fleetwood', '2026-01-01T12:01:00.000Z'),
          ]),
        }),
        email: emailServiceOver(mailDelivery),
        appBaseUrl: 'https://app.primetimecommissioner.com',
      });

      await service.sendEntrySubmittedEmails(receiptInput(contest, {
        configuration: receiptConfiguration({
          selectionType: SharedDomainEnums.SelectionType.RANDOM_DRAW, picksPerEntry: 2, countedScores: 2,
        }),
      }));

      await deliverQueuedEmail();
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.subject).toBe('Your quick picks: Masters Quick Pick');
      expect(sentMessage.text).toContain('- Pick 1: Rory McIlroy');
      expect(sentMessage.text).toContain('- Pick 2: Tommy Fleetwood');
      expect(sentMessage.text).not.toContain('Submitted:');
      expect(sentMessage.text).not.toContain('Tiebreaker');
    });

    it('sends a draw\'s every entry its own receipt to its own owners, reading the entries, their picks, the league and the owners once for all of them', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventIds: ['event-1'],
        name: 'Masters Quick Pick',
        status: ContestStatus.OPEN,
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail-1' })),
      };
      const otherOwner = buildUser({ id: 'user-2', email: 'olive@example.com', firstName: 'Olive', lastName: 'Owner', username: 'olive' });
      const users = fakeUserRepo({ findByIds: jest.fn().mockResolvedValue([RECEIPT_USER, otherOwner]) });
      const entries = createMockEntryRepo({
        findByContestWithSquad: jest.fn().mockResolvedValue([
          DEFAULT_ENTRY_WITH_SQUAD,
          { ...DEFAULT_ENTRY_WITH_SQUAD, id: 'entry-2', squadId: 'squad-2', name: "Olive's Entry", squadName: "Olive's Squad" },
        ]),
      });
      const leagues = fakeLeagueRepo({
        findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS', plan: LeaguePlan.PLATINUM }),
      });
      const picks = fakeContestEntryPickRepo({
        findByEntriesWithParticipant: jest.fn().mockResolvedValue([
          buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
          { ...buildReceiptPick('pick-2', 'sport-event-participant-2', 'participant-2', 'Tommy Fleetwood', '2026-01-01T12:00:00.000Z'), entryId: 'entry-2' },
        ]),
      });
      const service = buildService({
        entries,
        leagues,
        picks,
        users,
        email: emailServiceOver(mailDelivery),
        appBaseUrl: 'https://app.primetimecommissioner.com',
      });

      await service.sendEntrySubmittedEmails(receiptInput(contest, {
        configuration: receiptConfiguration({
          selectionType: SharedDomainEnums.SelectionType.RANDOM_DRAW, picksPerEntry: 1, countedScores: 1,
        }),
        squadMemberships: [ACTIVE_SQUAD_MEMBERSHIP, { ...ACTIVE_SQUAD_MEMBERSHIP, id: 'squad-membership-2', squadId: 'squad-2', userId: 'user-2' }],
        entryIds: ['entry-1', 'entry-2'],
      }));

      expect(entries.findByContestWithSquad).toHaveBeenCalledTimes(1);
      expect(entries.findByIdWithSquad).not.toHaveBeenCalled();
      expect(leagues.findById).toHaveBeenCalledTimes(1);
      expect(users.findByIds).toHaveBeenCalledTimes(1);
      expect(users.findByIds).toHaveBeenCalledWith(['user-1', 'user-2']);
      expect(users.findById).not.toHaveBeenCalled();
      expect(picks.findByEntriesWithParticipant).toHaveBeenCalledTimes(1);
      expect(picks.findByEntriesWithParticipant).toHaveBeenCalledWith(['entry-1', 'entry-2'], { sportEventId: 'event-1' });
      await deliverQueuedEmail();
      const sent = mailDelivery.send.mock.calls.map(([message]) => [message.to, message.text.includes('Rory McIlroy'), message.text.includes('Tommy Fleetwood')]);
      expect(sent).toEqual([
        ['derek@example.com', true, false],
        ['olive@example.com', false, true],
      ]);
    });

    it('resolves rather than throwing when confirmation delivery fails, so the submit it follows still succeeds', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Masters Pick 1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const entryRepo = createMockEntryRepo({
        findByContestAndSquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
        findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(-12)),
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        configurations: createMockContestConfigurationRepo(),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS', plan: LeaguePlan.PLATINUM }),
        }),
        users: fakeUserRepo({ findByIds: jest.fn().mockResolvedValue([RECEIPT_USER]) }),
        memberships: createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
        squads: createMockSquadRepo(),
        squadMemberships: createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue(ACTIVE_SQUAD_MEMBERSHIP),
          findBySquad: jest.fn().mockResolvedValue([ACTIVE_SQUAD_MEMBERSHIP]),
        }),
        entries: entryRepo,
        picks: fakeContestEntryPickRepo({
          countByEntries: jest.fn().mockResolvedValue(new Map([['entry-1', 1]])),
          findByEntriesWithParticipant: jest.fn().mockResolvedValue([
            buildReceiptPick('pick-1', 'sport-event-participant-1', 'participant-1', 'Rory McIlroy', '2026-01-01T12:00:00.000Z'),
          ]),
        }),
        email: emailServiceOver(mailDelivery),
      });

      await expect(service.sendEntrySubmittedEmails(receiptInput(contest))).resolves.toBeUndefined();
      await deliverQueuedEmail();
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
      expect(entryRepo.update).not.toHaveBeenCalled();
    });

    it('sends no confirmation when a complete entry\'s tiebreaker is saved: only submitting the entry sends it', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        name: 'Masters Pick 1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const entryRepo = createMockEntryRepo({
        findByContestAndSquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
        findByIdWithSquad: jest.fn().mockResolvedValue(submittedEntry(-12)),
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'ses', messageId: 'mail-1' })),
      };
      const service = buildService({
        contests: createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        configurations: createMockContestConfigurationRepo(),
        leagues: fakeLeagueRepo({
          findById: jest.fn().mockResolvedValue({ id: 'league-1', name: 'Mathworks', leagueCode: 'MATHWORKS', plan: LeaguePlan.PLATINUM }),
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
        email: emailServiceOver(mailDelivery),
      });

      await service.updateEntry('contest-1', 'entry-1', 'user-1', { tiebreakerValue: -12 });

      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { tiebreakerValue: -12 });
      await deliverQueuedEmail();
      expect(mailDelivery.send).not.toHaveBeenCalled();
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
          buildContest({ id: 'contest-1', leagueId: 'league-1', sportEventIds: ['event-1'], status: ContestStatus.ACTIVE }),
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
          findByContestAndSquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]),
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
      const entries = createMockEntryRepo({ findByContestAndSquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]) });
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
      const entries = createMockEntryRepo({ findByContestAndSquad: jest.fn().mockResolvedValue([UNSUBMITTED_ENTRY]) });
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
  });
});

// The contest leaderboard refuses what it cannot rank honestly, and a settled contest answers from
// its frozen standings.
describe('ContestService.getLeaderboard — refusals and the settled read', () => {
  const member = () => createMockMembershipRepo({
    findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' })),
  });
  const contestRepoFor = (overrides: Parameters<typeof buildContest>[0] = {}) => createMockContestRepo({
    findById: jest.fn().mockResolvedValue(buildContest({
      id: 'contest-1',
      leagueId: 'league-1',
      sportEventIds: ['event-1'],
      status: ContestStatus.ACTIVE,
      ...overrides,
    })),
  });
  const configuration = (overrides: Record<string, unknown> = {}) => createMockContestConfigurationRepo({
    findByContest: jest.fn().mockResolvedValue({
      id: 'config-1',
      contestId: 'contest-1',
      configJson: { countedScores: 2 },
      rounds: 4,
      ...overrides,
    }),
  });
  const rules = (rows: StoredScoringRuleInput[]) =>
    fakeParticipantContestScoringRuleRepo({ findByContestConfiguration: jest.fn().mockResolvedValue(rows.map(storedScoringRule)) });
  const golfRule = [{ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: true }];

  it.each([ContestStatus.DRAFT, ContestStatus.OPEN])('refuses to show a %s contest\'s leaderboard while picks are hidden', async (status) => {
    const service = buildService({ contests: contestRepoFor({ status }), memberships: member() });

    await expect(service.getLeaderboard('contest-1', 'user-1'))
      .rejects.toMatchObject({ code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN' });
  });

  it('refuses a contest with no sport event', async () => {
    const service = buildService({ contests: contestRepoFor({ sportEventIds: [] }), memberships: member() });

    await expect(service.getLeaderboard('contest-1', 'user-1'))
      .rejects.toMatchObject({ code: 'CONTEST_LEADERBOARD_EVENT_REQUIRED' });
  });

  it('refuses a contest whose sport event no longer exists', async () => {
    const service = buildService({
      contests: contestRepoFor(),
      memberships: member(),
      sportEvents: fakeSportEventRepo({ findById: jest.fn().mockResolvedValue(null), findByIds: jest.fn().mockResolvedValue([]) }),
    });

    await expect(service.getLeaderboard('contest-1', 'user-1'))
      .rejects.toMatchObject({ code: 'CONTEST_LEADERBOARD_EVENT_REQUIRED' });
  });

  it('refuses a contest whose configuration sets no count of golfers to score', async () => {
    const service = buildService({
      contests: contestRepoFor(),
      memberships: member(),
      configurations: configuration({ configJson: {} }),
      scoringRules: rules(golfRule),
    });

    await expect(service.getLeaderboard('contest-1', 'user-1'))
      .rejects.toMatchObject({ code: 'CONTEST_LEADERBOARD_COUNTING_RULE_MISSING' });
  });

  it('refuses a contest whose scoring rule names a definition the registry does not know, rather than guessing a direction', async () => {
    const service = buildService({
      contests: contestRepoFor(),
      memberships: member(),
      configurations: configuration(),
      scoringRules: rules([{ participantScoringDefinitionId: 'STABLEFORD_POINTS', sortOrder: 1, active: true }]),
    });

    await expect(service.getLeaderboard('contest-1', 'user-1'))
      .rejects.toMatchObject({ code: 'CONTEST_LEADERBOARD_SCORING_DEFINITION_UNKNOWN' });
  });

  it('refuses a contest whose scoring rule settings are not a settings object for its definition with 400 CONTEST_LEADERBOARD_SCORING_SETTINGS_INVALID, rather than scoring with defaults', async () => {
    const service = buildService({
      contests: contestRepoFor(),
      memberships: member(),
      configurations: configuration(),
      scoringRules: rules([{ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: ['points'], sortOrder: 1, active: true }]),
    });

    await expect(service.getLeaderboard('contest-1', 'user-1'))
      .rejects.toMatchObject({ code: 'CONTEST_LEADERBOARD_SCORING_SETTINGS_INVALID' });
  });

  it('answers a COMPLETED contest from its frozen standings, not from the live scores', async () => {
    const entryRepo = createMockEntryRepo({
      findByContestWithSquad: jest.fn().mockResolvedValue([
        { ...DEFAULT_ENTRY_WITH_SQUAD, id: 'entry-1', entryNumber: 1, name: 'Live Leader' },
        { ...DEFAULT_ENTRY_WITH_SQUAD, id: 'entry-2', entryNumber: 2, name: 'Settled Winner' },
      ]),
    });
    const settledAt = new Date('2026-05-31T22:00:00.000Z');
    const standingRow = (contestEntryId: string, position: number, score: number) => ({
      id: `standing-${contestEntryId}`,
      contestId: 'contest-1',
      contestEntryId,
      position,
      displayPosition: String(position),
      countingPickLimit: 4,
      scoredPickCount: 4,
      asOf: settledAt,
      settledAt,
      totalScore: score,
    });
    const service = buildService({
      contests: contestRepoFor({ status: ContestStatus.COMPLETED }),
      memberships: member(),
      configurations: configuration(),
      scoringRules: rules(golfRule),
      entries: entryRepo,
      standings: fakeContestEntryStandingRepo({
        findByContest: jest.fn().mockResolvedValue([standingRow('entry-2', 1, -9), standingRow('entry-1', 2, -4)]),
      }),
      // Settlement froze the event's standings with the contest's (#713).
      eventStandings: fakeContestEntryEventStandingRepo({
        findByContest: jest.fn().mockResolvedValue([
          { ...standingRow('entry-2', 1, -9), sportEventId: 'event-1' },
          { ...standingRow('entry-1', 2, -4), sportEventId: 'event-1' },
        ]),
      }),
    });

    const result = await service.getLeaderboard('contest-1', 'user-1');

    expect(result.countingRule).toEqual({ type: 'BEST_N', count: 4 });
    expect(result.asOf).toEqual(settledAt);
    expect(result.entries.map((entry) => [entry.entryId, entry.position, entry.score])).toEqual([
      ['entry-2', 1, -9],
      ['entry-1', 2, -4],
    ]);
  });

  it('computes a COMPLETED contest live when it has no frozen standings, such as one force-closed by its commissioner', async () => {
    const service = buildService({
      contests: contestRepoFor({ status: ContestStatus.COMPLETED }),
      memberships: member(),
      configurations: configuration(),
      scoringRules: rules(golfRule),
      standings: fakeContestEntryStandingRepo({ findByContest: jest.fn().mockResolvedValue([]) }),
    });

    const result = await service.getLeaderboard('contest-1', 'user-1');

    expect(result.countingRule).toEqual({ type: 'BEST_N', count: 2 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ score: null, position: null });
  });
});

interface StoredScoringRuleInput {
  participantScoringDefinitionId: string;
  /** The stored `config` column; an empty object when omitted. */
  config?: unknown;
  sortOrder: number;
  active: boolean;
}

/** A scoring rule as the adapter reads a stored row: its id and config through the definition's schema. */
function storedScoringRule(input: StoredScoringRuleInput): ParticipantContestScoringRule {
  return {
    id: `rule-${input.sortOrder}`,
    contestConfigurationId: 'config-1',
    sortOrder: input.sortOrder,
    active: input.active,
    scoring: parseContestScoringSettings(input.participantScoringDefinitionId, 'config' in input ? input.config : {}),
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  };
}
