import { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  ContestEntryPick,
  LeagueMembership,
  Participant,
  SportEventParticipant,
  SquadMembership,
} from '@poolmaster/shared/domain';
import type { ContestEntryPickWithParticipant } from '@poolmaster/shared/db';
import { DraftService } from '../../../packages/core-api/src/modules/drafts/service';
import type { DraftServiceDeps } from '../../../packages/core-api/src/modules/drafts/service';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeContestRepo,
  fakeLeagueMembershipRepo,
  fakeParticipantRepo,
  fakeSportEventParticipantRepo,
  fakeSportEventRepo,
  fakeSquadMembershipRepo,
} from '../../support/repo-fakes';

// #324 — DraftService over port fakes.
//
// This is the coverage the module could not have before: every one of the submission path's
// ten error codes, and — the part that matters most — the two outcomes a boolean guard cannot
// express. `plans/144` records that the first abstraction's `validatePick` returned
// `{ valid, reason }`, which is why the engines #323 deleted could enforce only three rules
// and, given a full tier, rejected the pick where the live route replaces it. So the replace
// and toggle-off assertions below are not incidental: they are the behaviour that the shape
// of this service exists to keep expressible.
//
// What these tests assert is the returned value, the typed error's code and statusCode, and
// the presence or absence of a pick write — per `rules/architecture-rules.md` §5 *Traps in the
// service layers*, not which repository method was called with what.

const CONTEST_ID = 'contest-1';
const LEAGUE_ID = 'league-1';
const EVENT_ID = 'event-1';
const ENTRY_ID = 'entry-1';
const OTHER_ENTRY_ID = 'entry-2';
const OWNER_USER_ID = 'user-owner';
const SQUAD_ID = 'squad-1';

const TIER_GROUPS = [
  {
    tierKey: 'tier-1',
    label: 'Tier 1',
    tierNumber: 1,
    defaultPickCount: 2,
    participants: [
      { sportEventParticipantId: 'sep-a', participantId: 'p-a', tierOrderIndex: 1, price: 100 },
      { sportEventParticipantId: 'sep-b', participantId: 'p-b', tierOrderIndex: 2, price: 90 },
      { sportEventParticipantId: 'sep-c', participantId: 'p-c', tierOrderIndex: 3, price: 80 },
    ],
  },
  {
    tierKey: 'tier-2',
    label: 'Tier 2',
    tierNumber: 2,
    defaultPickCount: 1,
    participants: [
      { sportEventParticipantId: 'sep-d', participantId: 'p-d', tierOrderIndex: 1, price: 40 },
    ],
  },
];

const VALUATIONS = [
  { sportEventParticipantId: 'sep-a', participantId: 'p-a', tierId: 't1', tierKey: 'tier-1', tierLabel: 'Tier 1', tierNumber: 1, tierOrderIndex: 1, price: 100 },
  { sportEventParticipantId: 'sep-b', participantId: 'p-b', tierId: 't1', tierKey: 'tier-1', tierLabel: 'Tier 1', tierNumber: 1, tierOrderIndex: 2, price: 90 },
  { sportEventParticipantId: 'sep-c', participantId: 'p-c', tierId: 't1', tierKey: 'tier-1', tierLabel: 'Tier 1', tierNumber: 1, tierOrderIndex: 3, price: 80 },
  { sportEventParticipantId: 'sep-d', participantId: 'p-d', tierId: 't2', tierKey: 'tier-2', tierLabel: 'Tier 2', tierNumber: 2, tierOrderIndex: 1, price: 40 },
];

const TIMESTAMPS = {
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function contest(overrides: Partial<Contest> = {}): Contest {
  return {
    id: CONTEST_ID,
    leagueId: LEAGUE_ID,
    sportEventId: EVENT_ID,
    name: 'Masters Pool',
    status: ContestStatus.OPEN,
    contestFormat: 'ROSTER_SELECTION',
    selectionType: SelectionType.TIERED,
    scoringEngine: 'GOLF_STROKE_PLAY',
    isExclusive: false,
    scoringStopsOnElimination: false,
    ...TIMESTAMPS,
    ...overrides,
  } as Contest;
}

function configuration(overrides: Partial<ContestConfiguration> = {}): ContestConfiguration {
  return {
    id: 'config-1',
    contestId: CONTEST_ID,
    selectionType: SelectionType.TIERED,
    isExclusive: false,
    ...TIMESTAMPS,
    ...overrides,
  } as ContestConfiguration;
}

function entry(id: string, squadId: string, name = `Entry ${id}`): ContestEntry {
  return {
    id,
    contestId: CONTEST_ID,
    squadId,
    entryNumber: 1,
    name,
    status: 'ACTIVE',
    tiebreakerValue: null,
    isEliminated: false,
    ...TIMESTAMPS,
  };
}

function fieldRow(id: string, participantId: string, isActive = true): SportEventParticipant {
  return {
    id,
    sportEventId: EVENT_ID,
    participantId,
    isActive,
    metadata: {},
    ...TIMESTAMPS,
  } as SportEventParticipant;
}

const FIELD = [
  fieldRow('sep-a', 'p-a'),
  fieldRow('sep-b', 'p-b'),
  fieldRow('sep-c', 'p-c'),
  fieldRow('sep-d', 'p-d'),
];

const PARTICIPANTS = ['p-a', 'p-b', 'p-c', 'p-d'].map(
  (id) =>
    ({
      id,
      sportId: 'sport-1',
      name: `Golfer ${id}`,
      participantType: 'INDIVIDUAL',
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: {},
      ...TIMESTAMPS,
    }) as Participant,
);

function pick(
  id: string,
  participantId: string,
  sportEventParticipantId: string,
  overrides: Partial<ContestEntryPick> = {},
): ContestEntryPickWithParticipant {
  return {
    id,
    entryId: ENTRY_ID,
    sportEventParticipantId,
    contestFormat: 'ROSTER_SELECTION',
    isAutoPicked: false,
    pickedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...TIMESTAMPS,
    ...overrides,
    participant: {
      participantId,
      participantName: `Golfer ${participantId}`,
      isActive: true,
      inactiveReason: null,
      role: 'GOLFER',
      teamAffiliation: null,
    },
  } as ContestEntryPickWithParticipant;
}

function squadMembership(squadId: string, userId: string): SquadMembership {
  return {
    id: `${squadId}-${userId}`,
    squadId,
    leagueId: LEAGUE_ID,
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: TIMESTAMPS.createdAt,
    ...TIMESTAMPS,
  } as SquadMembership;
}

interface SetupOptions {
  contest?: Partial<Contest>;
  configuration?: Partial<ContestConfiguration> | null;
  entries?: ContestEntry[];
  squadMemberships?: SquadMembership[];
  /** The picks every read of the room sees. */
  picks?: ContestEntryPickWithParticipant[];
  /** Picks of the submitted participant across the contest, for the exclusivity read. */
  contestPicksForParticipant?: ContestEntryPick[];
  actorMembership?: LeagueMembership | null;
  tierGroups?: unknown[];
  valuations?: unknown[];
  field?: SportEventParticipant[];
  /** The contest event's scheduled start; a week out unless a test says otherwise. */
  eventStartDate?: Date;
}

function setup(options: SetupOptions = {}) {
  const createPick = jest.fn().mockResolvedValue({ id: 'new-pick' });
  const deletePick = jest.fn().mockResolvedValue(undefined);

  const deps: DraftServiceDeps = {
    contests: fakeContestRepo({
      findById: jest.fn().mockResolvedValue(
        options.contest === undefined ? contest() : contest(options.contest),
      ),
    }),
    configurations: fakeContestConfigurationRepo({
      findByContest: jest.fn().mockResolvedValue(
        options.configuration === null ? null : configuration(options.configuration ?? {}),
      ),
    }),
    entries: fakeContestEntryRepo({
      findByContest: jest
        .fn()
        .mockResolvedValue(options.entries ?? [entry(ENTRY_ID, SQUAD_ID)]),
    }),
    memberships: fakeLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(options.actorMembership ?? null),
    }),
    squadMemberships: fakeSquadMembershipRepo({
      findBySquads: jest
        .fn()
        .mockResolvedValue(options.squadMemberships ?? [squadMembership(SQUAD_ID, OWNER_USER_ID)]),
    }),
    field: fakeSportEventParticipantRepo({
      findBySportEvent: jest.fn().mockResolvedValue(options.field ?? FIELD),
      findById: jest
        .fn()
        .mockImplementation(async (id: string) => (options.field ?? FIELD).find((row) => row.id === id) ?? null),
    }),
    participants: fakeParticipantRepo({
      findByIds: jest.fn().mockResolvedValue(PARTICIPANTS),
    }),
    picks: fakeContestEntryPickRepo({
      findByEntriesWithParticipant: jest.fn().mockResolvedValue(options.picks ?? []),
      findByContestAndParticipant: jest
        .fn()
        .mockResolvedValue(options.contestPicksForParticipant ?? []),
      countByContest: jest.fn().mockResolvedValue((options.picks ?? []).length),
    }),
    pickWrites: { createPick, deletePick } as never,
    sportEvents: fakeSportEventRepo({
      findById: jest.fn().mockResolvedValue({
        id: EVENT_ID,
        status: 'SCHEDULED',
        startDate: options.eventStartDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    }),
    tiers: {
      getEffectiveTiersForSportEvent: jest
        .fn()
        .mockResolvedValue(options.tierGroups ?? TIER_GROUPS),
      getEffectiveValuationsForSportEvent: jest
        .fn()
        .mockResolvedValue(options.valuations ?? VALUATIONS),
    } as unknown as SportEventTierService,
  };

  return { service: new DraftService(deps), deps, createPick, deletePick };
}

function submit(overrides: { entryId?: string; participantId?: string; actorUserId?: string } = {}) {
  return {
    contestId: CONTEST_ID,
    entryId: overrides.entryId ?? ENTRY_ID,
    participantId: overrides.participantId ?? 'sep-a',
    actorUserId: 'actorUserId' in overrides ? overrides.actorUserId : OWNER_USER_ID,
  };
}

describe('#324 DraftService.getDraftState', () => {
  it('answers 404 CONTEST_NOT_FOUND for a contest that does not exist', async () => {
    const { service, deps } = setup();
    (deps.contests.findById as jest.Mock).mockResolvedValue(null);

    await expect(service.getDraftState({ contestId: CONTEST_ID })).rejects.toMatchObject({
      code: 'CONTEST_NOT_FOUND',
      statusCode: 404,
      message: `Contest ${CONTEST_ID} was not found`,
    });
  });

  it('answers 501 DRAFT_MODE_UNSUPPORTED for a selection type this surface does not serve', async () => {
    const { service } = setup({ contest: { selectionType: SelectionType.SNAKE_DRAFT } });

    await expect(service.getDraftState({ contestId: CONTEST_ID })).rejects.toMatchObject({
      code: 'DRAFT_MODE_UNSUPPORTED',
      statusCode: 501,
      message: 'SNAKE_DRAFT draft-room endpoints are not implemented yet',
    });
  });

  it('builds a tiered room: roster size from the tiers, groups per tier, the actor\'s own entry selected', async () => {
    const { service } = setup();

    const view = await service.getDraftState({
      contestId: CONTEST_ID,
      actorUserId: OWNER_USER_ID,
    });

    expect(view.rosterSize).toBe(3);
    expect(view.totalRounds).toBe(3);
    expect(view.totalPicks).toBe(3);
    expect(view.myEntryId).toBe(ENTRY_ID);
    expect(view.selectedEntryId).toBe(ENTRY_ID);
    expect(view.canCurrentUserSubmit).toBe(true);
    expect(view.isComplete).toBe(false);
    expect(view.status).toBe('LIVE');
    expect(view.selectionGroups.map((group) => group.groupId)).toEqual(['tier-1', 'tier-2']);
    expect(view.selectionGroups[0].picksFromGroup).toBe(2);
    // Order index is within a tier, so sorting the field by it interleaves the tiers: both
    // tiers' first placed golfers come before tier 1's second.
    expect(view.availableSportEventParticipantIds).toEqual(['sep-a', 'sep-d', 'sep-b', 'sep-c']);
  });

  it('reports the actor as commissioner only when their league membership says so', async () => {
    const asMember = await setup().service.getDraftState({
      contestId: CONTEST_ID,
      actorUserId: OWNER_USER_ID,
    });
    expect(asMember.isCommissioner).toBe(false);

    const asCommissioner = await setup({
      actorMembership: { role: 'COMMISSIONER' } as LeagueMembership,
    }).service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });
    expect(asCommissioner.isCommissioner).toBe(true);
  });

  it('shows an anonymous reader the room with no entry of their own', async () => {
    const { service } = setup();

    const view = await service.getDraftState({ contestId: CONTEST_ID });

    expect(view.myEntryId).toBeNull();
    expect(view.selectedEntryId).toBeNull();
    expect(view.canCurrentUserSubmit).toBe(false);
    expect(view.isCommissioner).toBe(false);
  });

  it('honours an explicitly selected entry, and falls back to the actor\'s own for an unknown one', async () => {
    const entries = [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, 'squad-2', 'Challenger')];
    const squadMemberships = [
      squadMembership(SQUAD_ID, OWNER_USER_ID),
      squadMembership('squad-2', 'user-challenger'),
    ];

    const selected = await setup({ entries, squadMemberships }).service.getDraftState({
      contestId: CONTEST_ID,
      selectedEntryId: OTHER_ENTRY_ID,
      actorUserId: OWNER_USER_ID,
    });
    expect(selected.selectedEntryId).toBe(OTHER_ENTRY_ID);
    expect(selected.selectedEntryName).toBe('Challenger');
    expect(selected.myEntryId).toBe(ENTRY_ID);

    const unknown = await setup({ entries, squadMemberships }).service.getDraftState({
      contestId: CONTEST_ID,
      selectedEntryId: 'entry-nope',
      actorUserId: OWNER_USER_ID,
    });
    expect(unknown.selectedEntryId).toBe(ENTRY_ID);
  });

  it('marks the room complete once every entry holds a full roster', async () => {
    const { service } = setup({
      picks: [
        pick('pick-a', 'p-a', 'sep-a'),
        pick('pick-b', 'p-b', 'sep-b'),
        pick('pick-d', 'p-d', 'sep-d'),
      ],
    });

    const view = await service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.isComplete).toBe(true);
    expect(view.status).toBe('COMPLETE');
    expect(view.canCurrentUserSubmit).toBe(false);
    expect(view.currentEntryId).toBeNull();
  });

  it('closes submission for a COMPLETED contest even while the roster is short', async () => {
    const { service } = setup({ contest: { status: ContestStatus.COMPLETED } });

    const view = await service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.isComplete).toBe(false);
    expect(view.status).toBe('COMPLETE');
    expect(view.canCurrentUserSubmit).toBe(false);
  });

  it('hides a participant another entry has taken only when the contest is exclusive', async () => {
    const taken = [pick('pick-a', 'p-a', 'sep-a', { entryId: OTHER_ENTRY_ID })];

    const shared = await setup({ picks: taken }).service.getDraftState({ contestId: CONTEST_ID });
    expect(shared.availableSportEventParticipantIds).toContain('sep-a');

    const exclusive = await setup({
      configuration: { isExclusive: true },
      picks: taken,
    }).service.getDraftState({ contestId: CONTEST_ID });
    expect(exclusive.availableSportEventParticipantIds).not.toContain('sep-a');
  });

  it('leaves an inactive field row out of the available ids while keeping it in its group', async () => {
    const { service } = setup({
      field: [fieldRow('sep-a', 'p-a', false), fieldRow('sep-b', 'p-b'), fieldRow('sep-c', 'p-c'), fieldRow('sep-d', 'p-d')],
    });

    const view = await service.getDraftState({ contestId: CONTEST_ID });

    expect(view.availableSportEventParticipantIds).not.toContain('sep-a');
    expect(view.selectionGroups[0].participants.map((p) => p.sportEventParticipantId)).toContain('sep-a');
  });

  it('places each pick in the room\'s history in its tier\'s round', async () => {
    const { service } = setup({
      picks: [
        pick('pick-a', 'p-a', 'sep-a', { draftRound: 1, draftPickNumber: 1 }),
        pick('pick-d', 'p-d', 'sep-d', { draftRound: 3, draftPickNumber: 2 }),
      ],
    });

    const view = await service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.picks).toEqual([
      expect.objectContaining({ pickNumber: 1, round: 1, pickInRound: 1, tierId: 'tier-1', tierName: 'Tier 1', price: 100 }),
      expect.objectContaining({ pickNumber: 2, round: 2, pickInRound: 3, tierId: 'tier-2', tierName: 'Tier 2', price: 40 }),
    ]);
    expect(view.picks[0].entryName).toBe(`Entry ${ENTRY_ID}`);
  });

  it('builds a budget-pick room from the configuration\'s roster size', async () => {
    const { service } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, budget: 500 },
    });

    const view = await service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.rosterSize).toBe(2);
    expect(view.canCurrentUserSubmit).toBe(true);
  });
});

describe('#324 DraftService.submitSelection — the guards, in order', () => {
  it('answers 404 CONTEST_NOT_FOUND before anything else', async () => {
    const { service, deps, createPick } = setup();
    (deps.contests.findById as jest.Mock).mockResolvedValue(null);

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'CONTEST_NOT_FOUND',
      statusCode: 404,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 404 ENTRY_NOT_FOUND for an entry outside the contest', async () => {
    const { service, createPick } = setup();

    await expect(service.submitSelection(submit({ entryId: 'entry-nope' }))).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
      statusCode: 404,
      message: `Entry entry-nope was not found for contest ${CONTEST_ID}`,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 401 AUTH_SESSION_REQUIRED for an anonymous caller — after the entry check', async () => {
    const { service, createPick } = setup();

    await expect(service.submitSelection(submit({ actorUserId: undefined }))).rejects.toMatchObject({
      code: 'AUTH_SESSION_REQUIRED',
      statusCode: 401,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 403 DRAFT_ENTRY_ACCESS_DENIED for someone else\'s entry', async () => {
    const { service, createPick } = setup();

    await expect(
      service.submitSelection(submit({ actorUserId: 'user-interloper' })),
    ).rejects.toMatchObject({
      code: 'DRAFT_ENTRY_ACCESS_DENIED',
      statusCode: 403,
      message: 'You can only submit draft picks for your own contest entry',
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 501 DRAFT_MODE_UNSUPPORTED with the submission wording, not the read wording', async () => {
    const { service } = setup({ contest: { selectionType: SelectionType.SNAKE_DRAFT } });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'DRAFT_MODE_UNSUPPORTED',
      statusCode: 501,
      message: 'SNAKE_DRAFT pick submission is not implemented yet',
    });
  });

  it('answers 400 SELECTION_CONFIG_INVALID when the contest has no usable roster size', async () => {
    const { service, createPick } = setup({ tierGroups: [] });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'SELECTION_CONFIG_INVALID',
      statusCode: 400,
      message: `Contest ${CONTEST_ID} does not have a usable roster size or pick count`,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 400 PARTICIPANT_NOT_IN_EVENT for an unknown field row, and for one from another event', async () => {
    const { service } = setup();
    await expect(
      service.submitSelection(submit({ participantId: 'sep-nope' })),
    ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_IN_EVENT', statusCode: 400 });

    const elsewhere = setup();
    (elsewhere.deps.field.findById as jest.Mock).mockResolvedValue({
      ...fieldRow('sep-a', 'p-a'),
      sportEventId: 'event-elsewhere',
    });
    await expect(elsewhere.service.submitSelection(submit())).rejects.toMatchObject({
      code: 'PARTICIPANT_NOT_IN_EVENT',
      statusCode: 400,
    });
  });

  it('answers 400 PARTICIPANT_NOT_SELECTABLE for a field row the room\'s selection list does not carry', async () => {
    // The row resolves as part of the event, but the room's field read does not return it —
    // so it is in the event and still not selectable here.
    const { service, deps, createPick } = setup({ field: [fieldRow('sep-b', 'p-b')] });
    (deps.field.findById as jest.Mock).mockResolvedValue(fieldRow('sep-a', 'p-a'));

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'PARTICIPANT_NOT_SELECTABLE',
      statusCode: 400,
      message: `SportEventParticipant sep-a is not selectable for contest ${CONTEST_ID}`,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 400 PARTICIPANT_UNAVAILABLE with the field row\'s own reason', async () => {
    const { service, createPick } = setup({
      field: [fieldRow('sep-a', 'p-a', false), fieldRow('sep-b', 'p-b')],
    });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'PARTICIPANT_UNAVAILABLE',
      statusCode: 400,
      message: 'SportEventParticipant sep-a is unavailable with status INACTIVE',
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 400 PARTICIPANT_ALREADY_TAKEN when an exclusive contest has the pick on another entry', async () => {
    const { service, createPick } = setup({
      configuration: { isExclusive: true },
      contestPicksForParticipant: [
        { id: 'pick-other', entryId: OTHER_ENTRY_ID } as ContestEntryPick,
      ],
    });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'PARTICIPANT_ALREADY_TAKEN',
      statusCode: 400,
      message: 'SportEventParticipant sep-a is already selected by another entry',
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('does not treat the submitting entry\'s own pick as taken by another entry', async () => {
    const { service, createPick } = setup({
      configuration: { isExclusive: true },
      contestPicksForParticipant: [{ id: 'pick-mine', entryId: ENTRY_ID } as ContestEntryPick],
    });

    await expect(service.submitSelection(submit())).resolves.toMatchObject({ outcome: 'placed' });
    expect(createPick).toHaveBeenCalledTimes(1);
  });

  it('answers 400 TIER_MISSING for a selectable participant with no tier assignment', async () => {
    // A price-only valuation: the row is selectable and priced, but belongs to no tier.
    const { service, createPick } = setup({
      valuations: [
        { ...VALUATIONS[0], tierId: null, tierKey: null, tierLabel: null, tierNumber: null, tierOrderIndex: null },
        ...VALUATIONS.slice(1),
      ],
    });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'TIER_MISSING',
      statusCode: 400,
      message: 'SportEventParticipant sep-a is missing a tier assignment',
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 400 TIER_NOT_FOUND when the participant\'s tier label is not a configured tier', async () => {
    // The room is configured with Tier 2 only, while sep-a's valuation still says Tier 1.
    const { service, createPick } = setup({ tierGroups: [TIER_GROUPS[1]] });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'TIER_NOT_FOUND',
      statusCode: 400,
      message: `Tier Tier 1 is not configured for contest ${CONTEST_ID}`,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 400 DUPLICATE_PICK when a budget-pick entry already holds the participant', async () => {
    const { service, createPick, deletePick } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 3 },
      picks: [pick('pick-a', 'p-a', 'sep-a')],
    });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'DUPLICATE_PICK',
      statusCode: 400,
      message: 'SportEventParticipant sep-a is already on this entry',
    });
    expect(createPick).not.toHaveBeenCalled();
    expect(deletePick).not.toHaveBeenCalled();
  });

  it('answers 400 ENTRY_COMPLETE when a full budget-pick entry submits again', async () => {
    const { service, createPick } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2 },
      picks: [pick('pick-b', 'p-b', 'sep-b'), pick('pick-c', 'p-c', 'sep-c')],
    });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'ENTRY_COMPLETE',
      statusCode: 400,
      message: `Entry ${ENTRY_ID} has already submitted all 2 picks`,
    });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('answers 400 ENTRY_COMPLETE when a full tiered entry has no pick in the target tier to displace', async () => {
    const { service, createPick, deletePick } = setup({
      picks: [
        pick('pick-a', 'p-a', 'sep-a'),
        pick('pick-b', 'p-b', 'sep-b'),
        pick('pick-c', 'p-c', 'sep-c'),
      ],
    });

    // Tier 2 has one pick to give and the entry holds none from it, but the entry is full.
    await expect(service.submitSelection(submit({ participantId: 'sep-d' }))).rejects.toMatchObject({
      code: 'ENTRY_COMPLETE',
      statusCode: 400,
      message: `Entry ${ENTRY_ID} has already submitted all 3 picks`,
    });
    expect(createPick).not.toHaveBeenCalled();
    expect(deletePick).not.toHaveBeenCalled();
  });
});

describe('#324 DraftService.submitSelection — the three outcomes', () => {
  it('places a selection, writing it through the one enforced insert path', async () => {
    const { service, createPick, deletePick } = setup();

    const result = await service.submitSelection(submit());

    expect(result.outcome).toBe('placed');
    expect(deletePick).not.toHaveBeenCalled();
    expect(createPick).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      sportEventParticipantId: 'sep-a',
      draftRound: 1,
      draftPickNumber: 1,
      isAutoPicked: false,
    });
  });

  it('numbers a pick after every pick the whole contest holds, not just the entry\'s', async () => {
    const { service, deps, createPick } = setup();
    (deps.picks.countByContest as jest.Mock).mockResolvedValue(7);

    await service.submitSelection(submit());

    expect(createPick).toHaveBeenCalledWith(expect.objectContaining({ draftPickNumber: 8 }));
  });

  // The rule the deleted engines had backwards. Given a full tier the engine REJECTED the
  // pick; the live route REPLACES it. plans/144 §the-root-cause: a `{ valid, reason }` return
  // cannot say "replace", which is why this behaviour could never live behind that interface.
  it('replaces the tier\'s last pick when the tier is already full, rather than rejecting', async () => {
    const { service, createPick, deletePick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a'), pick('pick-b', 'p-b', 'sep-b')],
    });

    const result = await service.submitSelection(submit({ participantId: 'sep-c' }));

    expect(result.outcome).toBe('placed');
    expect(deletePick).toHaveBeenCalledWith('pick-b');
    expect(createPick).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventParticipantId: 'sep-c', draftRound: 2 }),
    );
  });

  // The other outcome a boolean cannot express: re-submitting a participant the entry already
  // holds unselects it. One delete, no insert, and the refreshed room comes back 200 — not an
  // error, which is what a validate-then-insert shape would have been forced to answer.
  it('toggles a tiered selection off when the entry already holds it, deleting and inserting nothing', async () => {
    const { service, createPick, deletePick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a')],
    });

    const result = await service.submitSelection(submit({ participantId: 'sep-a' }));

    expect(result.outcome).toBe('toggled-off');
    expect(deletePick).toHaveBeenCalledWith('pick-a');
    expect(createPick).not.toHaveBeenCalled();
    expect(result.view.contest.id).toBe(CONTEST_ID);
  });

  it('answers a toggle-off and a placement alike with the refreshed room for the submitting entry', async () => {
    const toggled = await setup({ picks: [pick('pick-a', 'p-a', 'sep-a')] }).service.submitSelection(
      submit({ participantId: 'sep-a' }),
    );
    expect(toggled.view.selectedEntryId).toBe(ENTRY_ID);

    const placed = await setup().service.submitSelection(submit());
    expect(placed.view.selectedEntryId).toBe(ENTRY_ID);
    expect(placed.view.rosterSize).toBe(3);
  });

  it('counts the rounds the earlier tiers take when placing into a later tier', async () => {
    const { service, createPick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a'), pick('pick-b', 'p-b', 'sep-b')],
    });

    await service.submitSelection(submit({ participantId: 'sep-d' }));

    expect(createPick).toHaveBeenCalledWith(expect.objectContaining({ draftRound: 3 }));
  });

  it('accepts the canonical participant id as well as the field row id', async () => {
    const { service, deps, createPick } = setup();
    (deps.field.findById as jest.Mock).mockResolvedValue(fieldRow('sep-a', 'p-a'));

    await service.submitSelection(submit({ participantId: 'sep-a' }));

    expect(createPick).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventParticipantId: 'sep-a' }),
    );
  });
});

describe('DraftService.submitSelection — picks only while the contest is open', () => {
  it.each([
    ContestStatus.DRAFT,
    ContestStatus.LOCKED,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
    ContestStatus.CANCELLED,
  ])('refuses a pick with 409 CONTEST_ENTRY_LOCKED and writes nothing while the contest is %s', async (status) => {
    const { service, createPick, deletePick } = setup({ contest: { status } });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
      statusCode: 409,
    });
    expect(createPick).not.toHaveBeenCalled();
    expect(deletePick).not.toHaveBeenCalled();
  });

  it('refuses toggling a held pick off with CONTEST_ENTRY_LOCKED once the contest is underway', async () => {
    const { service, deletePick } = setup({
      contest: { status: ContestStatus.ACTIVE },
      picks: [pick('pick-a', 'p-a', 'sep-a')],
    });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    expect(deletePick).not.toHaveBeenCalled();
  });

  it('tells the room the owner cannot submit once the contest is underway, even with a short roster', async () => {
    const { service } = setup({ contest: { status: ContestStatus.ACTIVE } });

    const view = await service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.isComplete).toBe(false);
    expect(view.canCurrentUserSubmit).toBe(false);
    expect(view.currentEntryId).toBeNull();
  });

  it('refuses a pick with CONTEST_ENTRY_LOCKED once the event\'s start time has passed, though its status still says scheduled', async () => {
    const { service, createPick } = setup({ eventStartDate: new Date(Date.now() - 60 * 60 * 1000) });

    await expect(service.submitSelection(submit())).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED', statusCode: 409 });
    expect(createPick).not.toHaveBeenCalled();
  });

  it('tells the room the owner cannot submit once the event\'s start time has passed', async () => {
    const { service } = setup({ eventStartDate: new Date(Date.now() - 60 * 60 * 1000) });

    const view = await service.getDraftState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.canCurrentUserSubmit).toBe(false);
  });
});

