/**
 * One fake per repository port (#208).
 *
 * Before this, every test file that needed a port double wrote its own factory: 50 of them
 * across 13 files, each an object literal of `jest.fn()`s spread with `...overrides`. Adding
 * one method to a port meant editing every fake of it — three consecutive commits in #202
 * paid that, editing 7, 5 and 10 fakes to add one method each.
 *
 * A port is a single interface. Its test double should be too.
 *
 * ## Defaults
 *
 * Every method is a `jest.fn()` with a NEUTRAL resolved default, so a test that does not
 * care about a call does not have to stub it:
 *
 *   - single-row reads (`findById`, `findByCode`, `findByLeagueAndUser`, …) → `null`
 *   - collection reads (`findAll`, `findByLeague`, `findBySquad`, …) → `[]`
 *   - `countActiveByLeagues` → an empty `Map`
 *   - `create` / `update` / `resolve` → echo the input back with id and timestamps, which
 *     is more useful than `undefined` and is what the richest local factories already did
 *   - `delete` → `undefined`
 *   - the entry port's `create` and `delete` return a result, so theirs are the write going
 *     through: `{ status: 'created', entry }` and `{ status: 'deleted' }`
 *
 * A test that needs a specific value passes it in `overrides`, exactly as the local
 * factories took them, so migrating a call site is usually deleting the factory and
 * changing an import.
 *
 * **Each default is chosen from the method's declared RETURN TYPE, not its name.** Three of
 * these were wrong in the first draft because they were guessed from the name:
 * `LeagueInvitationRepository.findByEmail`, `ParticipantProviderMappingRepository
 * .findByProvider` and a `findByContestConfiguration` on a since-deleted port all return a
 * single row despite reading like collections. The first of those made every
 * email look like an existing invitation and turned bulk member import into a silent
 * no-op — a test caught it; the other two had no test and were found by checking every
 * default against its port signature.
 *
 * ## Keeping these honest
 *
 * The return type is the port itself and the object literal is returned WITHOUT a cast, so a
 * fake missing a method is a compile error under `npm run typecheck:tests`. That gate (added
 * in #206) is what makes this file safe to rely on; before it, an out-of-date fake was
 * invisible until CI.
 *
 * Do not add `as SomeRepository` to these returns. The first draft of this file had them and
 * they silently suppressed exactly the check this file exists to provide: deleting a method
 * from a builder produced zero type errors. They were never needed — the literals satisfy the
 * ports on their own.
 *
 * Do NOT put assertions or test-specific data here. This is scaffolding — the behaviour
 * under test belongs in the test.
 */
import type {
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestEntryPickRepository,
  ContestEntryEventStandingRepository,
  ContestEntryRepository,
  ContestEntryStandingRepository,
  ContestRepository,
  ContestSquaresRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  MembershipRepositories,
  MembershipTransaction,
  ParticipantContestScoringRuleRepository,
  ParticipantLeagueAffiliationRepository,
  ParticipantProviderMappingRepository,
  ParticipantRepository,
  SportEventParticipantRepository,
  SportEventRepository,
  SportLeagueRepository,
  SportRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import type { Contest, ContestEntry } from '@poolmaster/shared/domain';

/** Echoes a create input back with the fields a repository would have assigned. */
function echoCreate(idPrefix: string) {
  let sequence = 0;
  return jest.fn().mockImplementation(async (input: Record<string, unknown>) => {
    sequence += 1;
    return {
      id: `${idPrefix}-${sequence}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...input,
    };
  });
}

/** Echoes each input of a batch create back as `echoCreate` does one, in order. */
function echoCreateMany(idPrefix: string) {
  const create = echoCreate(idPrefix);
  return jest.fn().mockImplementation(async (inputs: readonly Record<string, unknown>[]) => Promise.all(inputs.map((input): unknown => create(input))));
}

/** Echoes an update back as the id plus the patch, which is what callers read. */
function echoUpdate() {
  return jest.fn().mockImplementation(async (id: string, updates: Record<string, unknown>) => ({
    id,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...updates,
  }));
}

const one = () => jest.fn().mockResolvedValue(null);
const many = () => jest.fn().mockResolvedValue([]);
const nothing = () => jest.fn().mockResolvedValue(undefined);

export function fakeUserRepo(overrides: Partial<UserRepository> = {}): UserRepository {
  return {
    findById: one(),
    findByIds: many(),
    findByEmail: one(),
    findAll: many(),
    findActiveByLeague: many(),
    findByIdentifier: one(),
    findHolderOtherThan: one(),
    countActiveRootAdmins: jest.fn().mockResolvedValue(0),
    create: echoCreate('user'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: one(),
    findByCode: one(),
    findAll: many(),
    findByUser: many(),
    create: echoCreate('league'),
    update: echoUpdate(),
    changePlan: jest.fn().mockImplementation(async (id: string, change: { toPlan: string }) => ({ id, plan: change.toPlan })),
    extendPlanRenewal: jest.fn().mockImplementation(async (id: string, change: { renewsAt: Date }) => ({ id, planRenewsAt: change.renewsAt })),
    extendRunningPlanRenewals: jest.fn().mockResolvedValue(0),
    findPlansEndingBetween: many(),
    findLastPlanChange: one(),
    moveEndedPlansToFree: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

export function fakeLeagueMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: many(),
    findByUser: many(),
    countActiveByLeagues: jest.fn().mockResolvedValue(new Map()),
    findByLeagueAndUser: one(),
    findActiveJoinedSince: many(),
    create: echoCreate('league-membership'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: one(),
    findByLeague: many(),
    findDetailsById: one(),
    findDetailsByLeague: many(),
    countActiveByLeague: jest.fn().mockResolvedValue(0),
    findByLeagueAndName: one(),
    create: echoCreate('squad'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return {
    findBySquad: many(),
    findBySquads: many(),
    findBySquadAndUser: one(),
    findByLeagueAndUser: one(),
    findByLeagueAndUserWithSquadName: one(),
    create: echoCreate('squad-membership'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeSquadOwnerInvitationRepo(
  overrides: Partial<SquadOwnerInvitationRepository> = {},
): SquadOwnerInvitationRepository {
  return {
    findById: one(),
    findByLeague: many(),
    findByCode: one(),
    findPendingByLeagueAndEmail: one(),
    revokePendingBySquad: jest.fn().mockResolvedValue(0),
    create: echoCreate('squad-owner-invitation'),
    update: echoUpdate(),
    ...overrides,
  };
}

/**
 * A `MembershipTransaction` that runs its work straight against the service's own fakes, for
 * service tests that assert results rather than atomicity. It commits everything and rolls back
 * nothing; the in-memory league world's `transaction` is the one that rolls back.
 */
export function passThroughMembershipTransaction<D extends MembershipRepositories>(
  deps: D,
): D & { membershipTransaction: MembershipTransaction } {
  return {
    ...deps,
    membershipTransaction: {
      run: async (work) => work({
        leagueMemberships: deps.leagueMemberships,
        squads: deps.squads,
        squadMemberships: deps.squadMemberships,
        squadOwnerInvitations: deps.squadOwnerInvitations,
      }),
    },
  };
}

export function fakeLeagueInvitationRepo(
  overrides: Partial<LeagueInvitationRepository> = {},
): LeagueInvitationRepository {
  return {
    findById: one(),
    findOutstandingByLeague: many(),
    findByCode: one(),
    // Single row despite the plural-sounding name — the port declares
    // `Promise<LeagueInvitation | null>`. Defaulting this to [] made every email look
    // like a duplicate and silently turned bulk import into a no-op.
    findByEmail: one(),
    create: echoCreate('league-invitation'),
    update: echoUpdate(),
    ...overrides,
  };
}

const noCounts = () => jest.fn().mockResolvedValue(new Map());

export function fakeSportRepo(overrides: Partial<SportRepository> = {}): SportRepository {
  return {
    findById: one(),
    findBySport: one(),
    findAll: many(),
    ...overrides,
  };
}

export function fakeSportLeagueRepo(overrides: Partial<SportLeagueRepository> = {}): SportLeagueRepository {
  return {
    findById: one(),
    findByIds: many(),
    findAll: many(),
    findBySportAndName: one(),
    create: echoCreate('sport-league'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeParticipantLeagueAffiliationRepo(
  overrides: Partial<ParticipantLeagueAffiliationRepository> = {},
): ParticipantLeagueAffiliationRepository {
  return {
    findBySportLeague: many(),
    find: one(),
    // Takes two ids rather than an input object, so it cannot use echoCreate.
    create: jest.fn().mockImplementation(async (sportLeagueId: string, participantId: string) => ({
      id: `affiliation-${participantId}`,
      sportLeagueId,
      participantId,
      ranking: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
    delete: nothing(),
    updateRankings: nothing(),
    upsertRankings: nothing(),
    countBySportLeagues: noCounts(),
    ...overrides,
  };
}

export function fakeSportEventRepo(overrides: Partial<SportEventRepository> = {}): SportEventRepository {
  return {
    findById: one(),
    findByIds: many(),
    findByProviderRef: one(),
    findByProviderRefs: many(),
    findAll: many(),
    findEventYears: many(),
    createMany: echoCreateMany('sport-event'),
    update: echoUpdate(),
    transitionStatus: one(),
    delete: nothing(),
    countParticipants: noCounts(),
    countUntieredActiveParticipants: noCounts(),
    countUnpricedActiveParticipants: noCounts(),
    countTiers: noCounts(),
    findEmptyTierLabels: noCounts(),
    countContests: noCounts(),
    countBySportLeagues: noCounts(),
    sportLeagueHasLoadedBracket: jest.fn().mockResolvedValue(false),
    summarizeByProviders: noCounts(),
    findAutoLifecycleCandidates: many(),
    ...overrides,
  };
}

export function fakeSportEventParticipantRepo(
  overrides: Partial<SportEventParticipantRepository> = {},
): SportEventParticipantRepository {
  return {
    findById: one(),
    findByIds: many(),
    findBySportEvent: many(),
    findBySportEvents: many(),
    findFieldForEvent: many(),
    findFieldRow: one(),
    countDistinctParticipants: jest.fn().mockResolvedValue(0),
    createMany: nothing(),
    updateMany: nothing(),
    delete: nothing(),
    countPicks: jest.fn().mockResolvedValue(0),
    fillPlayInSlot: nothing(),
    replaceWithdrawn: jest.fn().mockResolvedValue('replacement-row'),
    ...overrides,
  };
}

export function fakeParticipantRepo(
  overrides: Partial<ParticipantRepository> = {},
): ParticipantRepository {
  return {
    findById: one(),
    findByIds: many(),
    search: many(),
    findMatchingAny: many(),
    create: echoCreate('participant'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeParticipantProviderMappingRepo(
  overrides: Partial<ParticipantProviderMappingRepository> = {},
): ParticipantProviderMappingRepository {
  return {
    // findByProvider is a single row per the port; findByParticipant is a collection.
    findByParticipant: many(),
    findByProviderExternalIds: many(),
    bind: echoCreate('participant-provider-mapping'),
    ...overrides,
  };
}

export function fakeContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return {
    findById: one(),
    findByLeague: many(),
    findCurrentByLeague: many(),
    findFinishedByLeague: many(),
    findFinishedYearsByLeague: many(),
    findOpenByLeague: many(),
    findSportLeagueIdsBySeason: many(),
    findBySportEvent: many(),
    findJoinableByReleasedEdition: many(),
    findByStatuses: many(),
    create: createdContest(echoCreate('contest')),
    update: echoUpdate(),
    moveToSeason: jest.fn().mockResolvedValue({ status: 'moved' }),
    replaceSportEvents: nothing(),
    transitionStatus: jest.fn().mockResolvedValue(true),
    setCupWeight: jest.fn().mockResolvedValue(true),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeContestEntryRepo(
  overrides: Partial<ContestEntryRepository> = {},
): ContestEntryRepository {
  return {
    findByIdWithSquad: one(),
    findByContest: many(),
    findByContestWithSquad: many(),
    findByContestAndSquad: many(),
    findIdsByContestAndSquad: many(),
    findBySquadAndContests: many(),
    countForContest: jest.fn().mockResolvedValue({ submittedEntryCount: 0, enteredSquadCount: 0, allEntryCount: 0 }),
    countByContests: jest.fn().mockResolvedValue(new Map()),
    countSubmittedByContests: jest.fn().mockResolvedValue(new Map()),
    create: createdEntry(echoCreate('contest-entry')),
    update: echoUpdate(),
    delete: jest.fn().mockResolvedValue({ status: 'deleted' }),
    ...overrides,
  };
}

/**
 * Wraps an echoing create in the entry port's result, as an entry written to an undrawn contest.
 * The echo carries no event rows: the adapter derives them from the contest, which this fake
 * cannot see; a test that reads them passes its own `create`.
 */
/** Wraps an echoed contest in the created result `create` answers with when the season has room. */
function createdContest(create: jest.Mock): ContestRepository['create'] {
  return jest.fn().mockImplementation(async (input: Record<string, unknown>) =>
    ({ status: 'created', contest: (await create(input)) as Contest }));
}

function createdEntry(create: jest.Mock): ContestEntryRepository['create'] {
  return jest.fn().mockImplementation(async (input: Record<string, unknown>) =>
    ({ status: 'created', entry: { events: [], ...((await create(input)) as Partial<ContestEntry>) } }));
}

/** Read-only, like the port: a pick is only ever inserted through ContestEntryPickService. */
export function fakeContestEntryPickRepo(
  overrides: Partial<ContestEntryPickRepository> = {},
): ContestEntryPickRepository {
  return {
    findByEntriesAndEvents: many(),
    findByEntriesWithParticipant: many(),
    countByEntries: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  };
}

export function fakeContestEntryStandingRepo(
  overrides: Partial<ContestEntryStandingRepository> = {},
): ContestEntryStandingRepository {
  return {
    findByContest: many(),
    upsert: nothing(),
    ...overrides,
  };
}

export function fakeContestEntryEventStandingRepo(
  overrides: Partial<ContestEntryEventStandingRepository> = {},
): ContestEntryEventStandingRepository {
  return {
    findByContest: many(),
    upsert: nothing(),
    ...overrides,
  };
}

export function fakeContestConfigurationRepo(
  overrides: Partial<ContestConfigurationRepository> = {},
): ContestConfigurationRepository {
  return {
    findByContest: one(),
    findByContests: many(),
    create: echoCreate('contest-configuration'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeContestConfigTemplateRepo(
  overrides: Partial<ContestConfigTemplateRepository> = {},
): ContestConfigTemplateRepository {
  return {
    findById: one(),
    list: many(),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeParticipantContestScoringRuleRepo(
  overrides: Partial<ParticipantContestScoringRuleRepository> = {},
): ParticipantContestScoringRuleRepository {
  return {
    findByContestConfiguration: many(),
    create: echoCreate('participant-contest-scoring-rule'),
    deleteByContestConfiguration: nothing(),
    ...overrides,
  };
}


export function fakeSquaresRepo(overrides: Partial<ContestSquaresRepository> = {}): ContestSquaresRepository {
  return {
    findSquares: many(),
    claim: jest.fn().mockResolvedValue('claimed'),
    clear: jest.fn().mockResolvedValue('cleared'),
    findDraw: one(),
    recordDraw: jest.fn().mockResolvedValue('drawn'),
    findWinners: many(),
    replaceWinners: nothing(),
    ...overrides,
  };
}
