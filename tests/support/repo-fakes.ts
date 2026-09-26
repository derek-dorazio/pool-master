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
 *
 * A test that needs a specific value passes it in `overrides`, exactly as the local
 * factories took them, so migrating a call site is usually deleting the factory and
 * changing an import.
 *
 * **Each default is chosen from the method's declared RETURN TYPE, not its name.** Three of
 * these were wrong in the first draft because they were guessed from the name:
 * `LeagueInvitationRepository.findByEmail`, `ParticipantProviderMappingRepository
 * .findByProvider` and `ContestEntryAggregationRuleRepository.findByContestConfiguration`
 * all return a single row despite reading like collections. The first of those made every
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
  ActionItemRepository,
  ContestConfigTemplateRepository,
  ContestConfigurationRepository,
  ContestCoreRepository,
  ContestEntryAggregationRuleRepository,
  ContestEntryRepository,
  ContestPrizeDefinitionRepository,
  ContestRepository,
  DraftSessionRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  ParticipantContestScoringRuleRepository,
  ParticipantProviderMappingRepository,
  ParticipantRepository,
  SeasonRepository,
  SportEventParticipantRepository,
  SportRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';

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
    findByEmail: one(),
    findAll: many(),
    findByLeague: many(),
    create: echoCreate('user'),
    update: echoUpdate(),
    delete: nothing(),
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
    delete: nothing(),
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
    create: echoCreate('league-membership'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: one(),
    findByLeague: many(),
    findByLeagueAndName: one(),
    create: echoCreate('squad'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return {
    findBySquad: many(),
    findBySquadAndUser: one(),
    findByLeagueAndUser: one(),
    create: echoCreate('squad-membership'),
    update: echoUpdate(),
    delete: nothing(),
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
    create: echoCreate('squad-owner-invitation'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeLeagueInvitationRepo(
  overrides: Partial<LeagueInvitationRepository> = {},
): LeagueInvitationRepository {
  return {
    findById: one(),
    findByLeague: many(),
    findByCode: one(),
    // Single row despite the plural-sounding name — the port declares
    // `Promise<LeagueInvitation | null>`. Defaulting this to [] made every email look
    // like a duplicate and silently turned bulk import into a no-op.
    findByEmail: one(),
    create: echoCreate('league-invitation'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeSportRepo(overrides: Partial<SportRepository> = {}): SportRepository {
  return {
    findById: one(),
    findAll: many(),
    create: echoCreate('sport'),
    ...overrides,
  };
}

export function fakeSeasonRepo(overrides: Partial<SeasonRepository> = {}): SeasonRepository {
  return {
    findById: one(),
    findBySport: many(),
    create: echoCreate('season'),
    ...overrides,
  };
}

export function fakeParticipantRepo(
  overrides: Partial<ParticipantRepository> = {},
): ParticipantRepository {
  return {
    findById: one(),
    findBySport: many(),
    findByExternalId: one(),
    search: jest.fn().mockResolvedValue({ participants: [], total: 0 }),
    create: echoCreate('participant'),
    createMany: jest.fn().mockResolvedValue(0),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeParticipantProviderMappingRepo(
  overrides: Partial<ParticipantProviderMappingRepository> = {},
): ParticipantProviderMappingRepository {
  return {
    // findByProvider is a single row per the port; findByParticipant is a collection.
    findByProvider: one(),
    findByParticipant: many(),
    create: echoCreate('participant-provider-mapping'),
    ...overrides,
  };
}

export function fakeContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return {
    findById: one(),
    findByLeague: many(),
    create: echoCreate('contest'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeContestEntryRepo(
  overrides: Partial<ContestEntryRepository> = {},
): ContestEntryRepository {
  return {
    findById: one(),
    findByContest: many(),
    findBySquad: many(),
    create: echoCreate('contest-entry'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeDraftSessionRepo(
  overrides: Partial<DraftSessionRepository> = {},
): DraftSessionRepository {
  return {
    findById: one(),
    findByContest: one(),
    create: echoCreate('draft-session'),
    update: echoUpdate(),
    getPickHistories: many(),
    addPickHistory: echoCreate('draft-pick-history'),
    ...overrides,
  };
}

export function fakeActionItemRepo(
  overrides: Partial<ActionItemRepository> = {},
): ActionItemRepository {
  return {
    findByLeague: many(),
    findUnresolved: many(),
    create: echoCreate('action-item'),
    resolve: jest.fn().mockImplementation(async (id: string) => ({
      id,
      resolvedAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeContestCoreRepo(
  overrides: Partial<ContestCoreRepository> = {},
): ContestCoreRepository {
  return {
    findById: one(),
    findByLeague: many(),
    create: echoCreate('contest'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeSportEventParticipantRepo(
  overrides: Partial<SportEventParticipantRepository> = {},
): SportEventParticipantRepository {
  return {
    findById: one(),
    findBySportEvent: many(),
    create: echoCreate('sport-event-participant'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeContestConfigurationRepo(
  overrides: Partial<ContestConfigurationRepository> = {},
): ContestConfigurationRepository {
  return {
    findById: one(),
    findByContest: one(),
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
    listBySportAndContestFormat: many(),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeParticipantContestScoringRuleRepo(
  overrides: Partial<ParticipantContestScoringRuleRepository> = {},
): ParticipantContestScoringRuleRepository {
  return {
    findById: one(),
    findByContestConfiguration: many(),
    create: echoCreate('participant-contest-scoring-rule'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}

export function fakeContestEntryAggregationRuleRepo(
  overrides: Partial<ContestEntryAggregationRuleRepository> = {},
): ContestEntryAggregationRuleRepository {
  return {
    findById: one(),
    // Single row here, unlike the same-named method on the scoring-rule and prize ports.
    findByContestConfiguration: one(),
    create: echoCreate('contest-entry-aggregation-rule'),
    update: echoUpdate(),
    ...overrides,
  };
}

export function fakeContestPrizeDefinitionRepo(
  overrides: Partial<ContestPrizeDefinitionRepository> = {},
): ContestPrizeDefinitionRepository {
  return {
    findById: one(),
    findByContestConfiguration: many(),
    create: echoCreate('contest-prize-definition'),
    update: echoUpdate(),
    delete: nothing(),
    ...overrides,
  };
}
