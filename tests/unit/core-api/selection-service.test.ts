import { ContestEntryStatus, ContestFormat, ContestStatus, CupWeight, SelectionType } from '@poolmaster/shared/domain';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  ContestEntryPick,
  LeagueMembership,
  Participant,
  SportEvent,
  SportEventParticipant,
  SquadMembership,
} from '@poolmaster/shared/domain';
import type { ContestEntryPickRepository, ContestEntryPickWithParticipant } from '@poolmaster/shared/db';
import { fakeLogger } from '../../support/fake-logger';
import { mockFn } from '../../support/mock-fn';
import { SelectionService } from '../../../packages/core-api/src/modules/selections/service';
import { dealRandomDraw } from '../../../packages/core-api/src/modules/selections/selection-engines/random-draw';
import {
  ContestDrawAlreadyRunError,
  ContestDrawEntriesChangedError,
} from '../../../packages/core-api/src/modules/contest-entry-picks';
import type { SelectionServiceDeps } from '../../../packages/core-api/src/modules/selections/service';
import type { EntrySubmittedReceiptInput } from '../../../packages/core-api/src/modules/contests/service';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import type { ContestEntryPickService } from '../../../packages/core-api/src/modules/contest-entry-picks';
import {
  fakeContestConfigurationRepo,
  fakeContestEntryPickRepo,
  fakeContestEntryRepo,
  fakeContestRepo,
  fakeLeagueMembershipRepo,
  fakeParticipantRepo,
  fakeSportEventParticipantRepo,
  fakeSquadMembershipRepo,
} from '../../support/repo-fakes';

// #324 — SelectionService over port fakes.
//
// This is the coverage the module could not have before: every one of the submission path's
// ten error codes, and — the part that matters most — the two outcomes a boolean guard cannot
// express. The first abstraction's `validatePick` returned
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
/** When every test's `recordDraw` says the draw was recorded. */
const RECORDED_DRAW_AT = new Date('2026-04-01T12:00:05.000Z');

const TIER_GROUPS = [
  {
    tierKey: 'tier-1',
    label: 'Tier 1',
    tierNumber: 1,
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
    sportEventIds: [EVENT_ID],
    name: 'Masters Pool',
    seasonYear: 2026,
    cupWeight: CupWeight.NORMAL,
    status: ContestStatus.OPEN,
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    ...TIMESTAMPS,
    ...overrides,
  };
}

function configuration(overrides: Partial<ContestConfiguration> = {}): ContestConfiguration {
  return {
    id: 'config-1',
    contestId: CONTEST_ID,
    selectionType: SelectionType.TIERED,
    // Every tier takes the contest's picksPerTier (#479): two tiers × 2 is a roster of 4.
    configJson: { selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 3 },
    ...TIMESTAMPS,
    ...overrides,
  } as ContestConfiguration;
}

function entry(
  id: string,
  squadId: string,
  name = `Entry ${id}`,
  status: ContestEntryStatus = 'DRAFT',
): ContestEntry {
  return {
    id,
    contestId: CONTEST_ID,
    squadId,
    entryNumber: 1,
    name,
    events: [{ sportEventId: EVENT_ID, status }],
    tiebreakerValue: null,
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
    sportEventId: EVENT_ID,
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
  /** The picks the room starts with; a pick write changes what the next read sees. */
  picks?: ContestEntryPickWithParticipant[];
  actorMembership?: LeagueMembership | null;
  tierGroups?: unknown[];
  valuations?: unknown[];
  field?: SportEventParticipant[];
}

function setup(options: SetupOptions = {}) {
  // The picks held, written by the pick writes, so a read after a write sees what it did.
  const held = [...(options.picks ?? [])];
  // The writes a pick change applied, in the order `changeEntryPick` applies them.
  const removePick = jest.fn((pickId: string) => {
    const index = held.findIndex((row) => row.id === pickId);
    if (index >= 0) held.splice(index, 1);
  });
  const addPick = jest.fn((input: { entryId: string; sportEventParticipantId: string; participantId: string; lineupSlot: number }) => {
    const row = (options.field ?? FIELD).find((candidate) => candidate.id === input.sportEventParticipantId);
    held.push({
      ...pick(`new-pick-${held.length + 1}`, row?.participantId ?? input.sportEventParticipantId, input.sportEventParticipantId, {
        entryId: input.entryId,
        lineupSlot: input.lineupSlot,
        pickedAt: new Date('2026-02-02T00:00:00.000Z'),
      }),
      sportEventId: row?.sportEventId ?? EVENT_ID,
    });
  });
  // Each entry's status per event, as the pick writes leave it.
  const statuses = new Map((options.entries ?? [entry(ENTRY_ID, SQUAD_ID)]).flatMap((row) =>
    row.events.map((event) => [`${row.id}:${event.sportEventId}`, event.status] as const)));
  const writeStatus = jest.fn((entryId: string, sportEventId: string, status: ContestEntryStatus, _at: Date) => {
    statuses.set(`${entryId}:${sportEventId}`, status);
  });
  const lockedEvent = (entryId: string, sportEventId: string) => ({
    status: statuses.get(`${entryId}:${sportEventId}`) ?? ContestEntryStatus.DRAFT,
    picks: held
      .filter((row) => row.entryId === entryId && row.sportEventId === sportEventId)
      .map((row) => ({
        id: row.id,
        sportEventParticipantId: row.sportEventParticipantId,
        participantId: row.participant.participantId,
        lineupSlot: row.lineupSlot ?? null,
      })),
  });
  const settled = (entryId: string, sportEventId: string, next: ContestEntryStatus | null, at: Date, picksChanged: boolean) => {
    const { status } = lockedEvent(entryId, sportEventId);
    if (next === null || next === status) {
      return { picksChanged, status, submittedAt: null, statusChanged: false };
    }
    writeStatus(entryId, sportEventId, next, at);
    return { picksChanged, status: next, submittedAt: next === ContestEntryStatus.SUBMITTED ? at : null, statusChanged: true };
  };
  // Decides and settles on the entry's held picks and status in the event, as the service does under the entry's lock.
  const changeEntryPick = mockFn<ContestEntryPickService['changeEntryPick']>(async ({ entryId, sportEventId, at, decide, settle }) => {
    const write = decide(lockedEvent(entryId, sportEventId).picks);
    if (write?.removePickId) removePick(write.removePickId);
    if (write?.add) addPick({ entryId, ...write.add });
    const picksChanged = write !== null;
    return settled(entryId, sportEventId, settle({ ...lockedEvent(entryId, sportEventId), picksChanged }), at, picksChanged);
  });
  const settleEntryEvent = mockFn<ContestEntryPickService['settleEntryEvent']>(async ({ entryId, sportEventId, at, settle }) =>
    settled(entryId, sportEventId, settle(lockedEvent(entryId, sportEventId)), at, false));
  const recordDraw = jest.fn().mockResolvedValue({ drawnAt: RECORDED_DRAW_AT });

  const deps: SelectionServiceDeps = {
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
      // Filters by entry and event as the adapter's query does; a test that stubs its own answer takes over.
      findByEntriesWithParticipant: mockFn<ContestEntryPickRepository['findByEntriesWithParticipant']>(async (entryIds, read) =>
        held.filter((row) => entryIds.includes(row.entryId)
          && (read?.sportEventId === undefined || row.sportEventId === read.sportEventId))),
    }),
    pickWrites: { changeEntryPick, settleEntryEvent, recordDraw } as unknown as ContestEntryPickService,
    tiers: {
      getEffectiveTiersAndValuations: jest
        .fn()
        .mockResolvedValue({ tiers: options.tierGroups ?? TIER_GROUPS, valuations: options.valuations ?? VALUATIONS }),
    } as unknown as SportEventTierService,
    // An event that starts long after every test's clock, so only contest status gates picks.
    sportEvents: {
      findByIds: jest.fn().mockResolvedValue([eventStarting(new Date('2099-01-01T00:00:00.000Z'))]),
    },
    drawSeed: () => 'seed-1',
  };

  return { service: new SelectionService(deps), deps, addPick, removePick, changeEntryPick, writeStatus, statuses, recordDraw };
}

/** The contest's one golf event, scheduled to start at `startDate`. */
function eventStarting(startDate: Date): SportEvent {
  return { id: EVENT_ID, sport: 'GOLF', status: 'SCHEDULED', startDate } as SportEvent;
}

/** One pick change (#1259): sep-a on the owner's entry, unless told otherwise. */
function pickChange(overrides: { entryId?: string; sportEventParticipantId?: string; actorUserId?: string } = {}) {
  return {
    contestId: CONTEST_ID,
    entryId: overrides.entryId ?? ENTRY_ID,
    sportEventParticipantId: overrides.sportEventParticipantId ?? 'sep-a',
    actorUserId: 'actorUserId' in overrides ? overrides.actorUserId : OWNER_USER_ID,
  };
}

describe('#324 SelectionService.getSelectionState', () => {
  it('answers 404 CONTEST_NOT_FOUND for a contest that does not exist', async () => {
    const { service, deps } = setup();
    (deps.contests.findById as jest.Mock).mockResolvedValue(null);

    await expect(service.getSelectionState({ contestId: CONTEST_ID })).rejects.toMatchObject({
      code: 'CONTEST_NOT_FOUND',
      statusCode: 404,
      message: `Contest ${CONTEST_ID} was not found`,
    });
  });

  it('builds a tiered room: roster size is the event\'s tiers × the contest\'s picksPerTier, groups per tier, the actor\'s own entry selected', async () => {
    const { service } = setup();

    const view = await service.getSelectionState({
      contestId: CONTEST_ID,
      actorUserId: OWNER_USER_ID,
    });

    expect(view.rosterSize).toBe(4);
    expect(view.myEntryId).toBe(ENTRY_ID);
    expect(view.selectedEntryId).toBe(ENTRY_ID);
    expect(view.isComplete).toBe(false);
    expect(view.status).toBe('LIVE');
    expect(view.selectionGroups.map((group) => group.groupId)).toEqual(['tier-1', 'tier-2']);
    expect(view.selectionGroups.map((group) => group.picksFromGroup)).toEqual([2, 2]);
    // Order index is within a tier, so sorting the field by it interleaves the tiers: both
    // tiers' first placed golfers come before tier 1's second.
    expect(view.availableSportEventParticipantIds).toEqual(['sep-a', 'sep-d', 'sep-b', 'sep-c']);
  });

  it('reports the actor as commissioner only when their league membership says so', async () => {
    const asMember = await setup().service.getSelectionState({
      contestId: CONTEST_ID,
      actorUserId: OWNER_USER_ID,
    });
    expect(asMember.isCommissioner).toBe(false);

    const asCommissioner = await setup({
      actorMembership: { role: 'COMMISSIONER' } as LeagueMembership,
    }).service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });
    expect(asCommissioner.isCommissioner).toBe(true);
  });

  it('shows an anonymous reader the room with no entry of their own', async () => {
    const { service } = setup();

    const view = await service.getSelectionState({ contestId: CONTEST_ID });

    expect(view.myEntryId).toBeNull();
    expect(view.selectedEntryId).toBeNull();
    expect(view.isCommissioner).toBe(false);
  });

  // Once picks are revealed (ACTIVE onwards). While the contest is OPEN another team's entry
  // is not honoured: selection-use-cases.test.ts covers that half.
  it('honours an explicitly selected entry once picks are revealed, and falls back to the actor\'s own for an unknown one', async () => {
    const entries = [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, 'squad-2', 'Challenger')];
    const squadMemberships = [
      squadMembership(SQUAD_ID, OWNER_USER_ID),
      squadMembership('squad-2', 'user-challenger'),
    ];

    // Live, and its event has teed off: the event's picks are revealed (#713).
    const revealed = { status: ContestStatus.ACTIVE };
    const liveRoom = () => {
      const room = setup({ contest: revealed, entries, squadMemberships });
      (room.deps.sportEvents.findByIds as jest.Mock).mockResolvedValue([eventStarting(new Date('2000-01-01T00:00:00.000Z'))]);
      return room.service;
    };
    const selected = await liveRoom().getSelectionState({
      contestId: CONTEST_ID,
      selectedEntryId: OTHER_ENTRY_ID,
      actorUserId: OWNER_USER_ID,
    });
    expect(selected.selectedEntryId).toBe(OTHER_ENTRY_ID);
    expect(selected.selectedEntryName).toBe('Challenger');
    expect(selected.myEntryId).toBe(ENTRY_ID);

    const unknown = await liveRoom().getSelectionState({
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
        pick('pick-c', 'p-c', 'sep-c'),
        pick('pick-d', 'p-d', 'sep-d'),
      ],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.isComplete).toBe(true);
    expect(view.status).toBe('COMPLETE');
  });

  it('shows a COMPLETED contest\'s room as COMPLETE even while the roster is short', async () => {
    const { service } = setup({ contest: { status: ContestStatus.COMPLETED } });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.isComplete).toBe(false);
    expect(view.status).toBe('COMPLETE');
  });

  it('keeps a participant another entry has taken available to every entry', async () => {
    const taken = [pick('pick-a', 'p-a', 'sep-a', { entryId: OTHER_ENTRY_ID })];

    const view = await setup({ picks: taken }).service.getSelectionState({ contestId: CONTEST_ID });

    expect(view.availableSportEventParticipantIds).toContain('sep-a');
  });

  it('leaves an inactive field row out of the available ids while keeping it in its group', async () => {
    const { service } = setup({
      field: [fieldRow('sep-a', 'p-a', false), fieldRow('sep-b', 'p-b'), fieldRow('sep-c', 'p-c'), fieldRow('sep-d', 'p-d')],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID });

    expect(view.availableSportEventParticipantIds).not.toContain('sep-a');
    expect(view.selectionGroups[0].participants.map((p) => p.sportEventParticipantId)).toContain('sep-a');
  });

  it('places each pick in the room\'s history in its tier\'s round', async () => {
    const { service } = setup({
      picks: [
        pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1, pickSequence: 1 }),
        pick('pick-d', 'p-d', 'sep-d', { lineupSlot: 3, pickSequence: 2 }),
      ],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.picks).toEqual([
      expect.objectContaining({ pickNumber: 1, round: 1, pickInRound: 1, tierId: 'tier-1', tierName: 'Tier 1', price: 100 }),
      expect.objectContaining({ pickNumber: 2, round: 2, pickInRound: 3, tierId: 'tier-2', tierName: 'Tier 2', price: 40 }),
    ]);
    expect(view.picks[0].entryName).toBe(`Entry ${ENTRY_ID}`);
  });

  it('builds a budget-pick room from the configuration\'s roster size', async () => {
    const { service } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 500, countedScores: 2 } },
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.rosterSize).toBe(2);
  });
});

describe('#324 SelectionService.selectPick and unselectPick — the guards, in order', () => {
  it('answers 404 CONTEST_NOT_FOUND before anything else', async () => {
    const { service, deps, addPick } = setup();
    (deps.contests.findById as jest.Mock).mockResolvedValue(null);

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'CONTEST_NOT_FOUND',
      statusCode: 404,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 404 CONTEST_ENTRY_NOT_FOUND for an entry outside the contest', async () => {
    const { service, addPick } = setup();

    await expect(service.selectPick(pickChange({ entryId: 'entry-nope' }))).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_NOT_FOUND',
      statusCode: 404,
      message: `Entry entry-nope was not found for contest ${CONTEST_ID}`,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 401 AUTH_SESSION_REQUIRED for an anonymous caller — after the entry check', async () => {
    const { service, addPick } = setup();

    await expect(service.selectPick(pickChange({ actorUserId: undefined }))).rejects.toMatchObject({
      code: 'AUTH_SESSION_REQUIRED',
      statusCode: 401,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 403 ENTRY_ACCESS_DENIED for someone else\'s entry', async () => {
    const { service, addPick } = setup();

    await expect(
      service.selectPick(pickChange({ actorUserId: 'user-interloper' })),
    ).rejects.toMatchObject({
      code: 'ENTRY_ACCESS_DENIED',
      statusCode: 403,
      message: 'You can only submit picks for your own contest entry',
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 400 SELECTION_CONFIG_INVALID when the contest has no usable roster size', async () => {
    const { service, addPick } = setup({ tierGroups: [] });

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'SELECTION_CONFIG_INVALID',
      statusCode: 400,
      message: `Contest ${CONTEST_ID} does not have a usable roster size or pick count`,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 400 PARTICIPANT_NOT_IN_EVENT for an unknown field row, and for one from another event', async () => {
    const { service } = setup();
    await expect(
      service.selectPick(pickChange({ sportEventParticipantId: 'sep-nope' })),
    ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_IN_EVENT', statusCode: 400 });

    const elsewhere = setup();
    (elsewhere.deps.field.findById as jest.Mock).mockResolvedValue({
      ...fieldRow('sep-a', 'p-a'),
      sportEventId: 'event-elsewhere',
    });
    await expect(elsewhere.service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'PARTICIPANT_NOT_IN_EVENT',
      statusCode: 400,
    });
  });

  it('answers 400 PARTICIPANT_NOT_SELECTABLE for a field row the room\'s selection list does not carry', async () => {
    // The row resolves as part of the event, but the room's field read does not return it —
    // so it is in the event and still not selectable here.
    const { service, deps, addPick } = setup({ field: [fieldRow('sep-b', 'p-b')] });
    (deps.field.findById as jest.Mock).mockResolvedValue(fieldRow('sep-a', 'p-a'));

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'PARTICIPANT_NOT_SELECTABLE',
      statusCode: 400,
      message: `SportEventParticipant sep-a is not selectable for contest ${CONTEST_ID}`,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 400 PARTICIPANT_UNAVAILABLE with the field row\'s own reason', async () => {
    const { service, addPick } = setup({
      field: [fieldRow('sep-a', 'p-a', false), fieldRow('sep-b', 'p-b')],
    });

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'PARTICIPANT_UNAVAILABLE',
      statusCode: 400,
      message: 'SportEventParticipant sep-a is unavailable with status INACTIVE',
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 400 TIER_MISSING for a selectable participant with no tier assignment', async () => {
    // A price-only valuation: the row is selectable and priced, but belongs to no tier.
    const { service, addPick } = setup({
      valuations: [
        { ...VALUATIONS[0], tierId: null, tierKey: null, tierLabel: null, tierNumber: null, tierOrderIndex: null },
        ...VALUATIONS.slice(1),
      ],
    });

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'TIER_MISSING',
      statusCode: 400,
      message: 'SportEventParticipant sep-a is missing a tier assignment',
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 400 TIER_NOT_FOUND when the participant\'s tier label is not a configured tier', async () => {
    // The room is configured with Tier 2 only, while sep-a's valuation still says Tier 1.
    const { service, addPick } = setup({ tierGroups: [TIER_GROUPS[1]] });

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'TIER_NOT_FOUND',
      statusCode: 400,
      message: `Tier Tier 1 is not configured for contest ${CONTEST_ID}`,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('unselects a golfer a budget-pick entry already holds, deleting the pick and inserting nothing', async () => {
    const { service, addPick, removePick } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 3, salaryCap: 500, countedScores: 3 } },
      picks: [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 })],
    });

    const result = await service.unselectPick(pickChange());

    expect(removePick).toHaveBeenCalledWith('pick-a');
    expect(addPick).not.toHaveBeenCalled();
    expect(result.picks).toEqual([]);
    expect(result.lineupSummary).toMatchObject({ spent: 0, openSlots: 3 });
  });

  it('runs the same guards on an unselect: 403 ENTRY_ACCESS_DENIED for someone else\'s entry, removing nothing', async () => {
    const { service, removePick } = setup({ picks: [pick('pick-a', 'p-a', 'sep-a')] });

    await expect(service.unselectPick(pickChange({ actorUserId: 'user-interloper' }))).rejects.toMatchObject({
      code: 'ENTRY_ACCESS_DENIED',
      statusCode: 403,
    });
    expect(removePick).not.toHaveBeenCalled();
  });

  it('refuses 409 CONTEST_ENTRY_LOCKED for an unselect once the event has started, removing nothing', async () => {
    const { service, deps, removePick } = setup({ picks: [pick('pick-a', 'p-a', 'sep-a')] });
    (deps.sportEvents.findByIds as jest.Mock).mockResolvedValue([eventStarting(new Date('2020-01-01T00:00:00.000Z'))]);

    await expect(service.unselectPick(pickChange())).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED', statusCode: 409 });
    expect(removePick).not.toHaveBeenCalled();
  });

  it('answers 400 ENTRY_COMPLETE when a full budget-pick entry submits again', async () => {
    const { service, addPick } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 500, countedScores: 2 } },
      picks: [pick('pick-b', 'p-b', 'sep-b'), pick('pick-c', 'p-c', 'sep-c')],
    });

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({
      code: 'ENTRY_COMPLETE',
      statusCode: 400,
      message: `Entry ${ENTRY_ID} has already submitted all 2 picks`,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 400 ENTRY_COMPLETE when a full tiered entry has no pick in the target tier to displace', async () => {
    const { service, addPick, removePick } = setup({
      picks: [
        pick('pick-a', 'p-a', 'sep-a'),
        pick('pick-b', 'p-b', 'sep-b'),
        pick('pick-c', 'p-c', 'sep-c'),
        // A golfer outside every tier still fills a roster spot.
        pick('pick-x', 'p-x', 'sep-x'),
      ],
    });

    // Tier 2 has two picks to give and the entry holds none from it, but the entry is full.
    await expect(service.selectPick(pickChange({ sportEventParticipantId: 'sep-d' }))).rejects.toMatchObject({
      code: 'ENTRY_COMPLETE',
      statusCode: 400,
      message: `Entry ${ENTRY_ID} has already submitted all 4 picks`,
    });
    expect(addPick).not.toHaveBeenCalled();
    expect(removePick).not.toHaveBeenCalled();
  });
});

describe('#324 SelectionService.selectPick — placing, replacing, and nothing to do', () => {
  it('places a selection by adding one pick at the lineup slot the engine chose, removing none', async () => {
    const { service, addPick, removePick } = setup();

    const result = await service.selectPick(pickChange());

    expect(result.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-a']);
    expect(removePick).not.toHaveBeenCalled();
    expect(addPick).toHaveBeenCalledWith({ entryId: ENTRY_ID, sportEventParticipantId: 'sep-a', participantId: 'p-a', lineupSlot: 1 });
  });

  // The rule the deleted engines had backwards. Given a full tier the engine REJECTED the
  // pick; the live route REPLACES it. The root cause: a `{ valid, reason }` return
  // cannot say "replace", which is why this behaviour could never live behind that interface.
  it('replaces the tier\'s last pick when the tier is already full, rather than rejecting', async () => {
    const { service, addPick, removePick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a'), pick('pick-b', 'p-b', 'sep-b')],
    });

    const result = await service.selectPick(pickChange({ sportEventParticipantId: 'sep-c' }));

    expect(result.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-a', 'sep-c']);
    expect(removePick).toHaveBeenCalledWith('pick-b');
    expect(addPick).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventParticipantId: 'sep-c', lineupSlot: 2 }),
    );
  });

  // #1259: selecting is selecting. A second select of a held golfer used to unselect them, so a
  // repeated request (a double tap, a retry) undid the pick; now it changes nothing.
  it('changes nothing when the entry already holds the golfer selected, deleting and inserting nothing', async () => {
    const { service, addPick, removePick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a')],
    });

    const result = await service.selectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(removePick).not.toHaveBeenCalled();
    expect(addPick).not.toHaveBeenCalled();
    expect(result.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-a']);
  });

  it('unselects a tiered pick the entry holds, deleting it and inserting nothing', async () => {
    const { service, addPick, removePick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a'), pick('pick-d', 'p-d', 'sep-d')],
    });

    const result = await service.unselectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(removePick).toHaveBeenCalledWith('pick-a');
    expect(addPick).not.toHaveBeenCalled();
    expect(result.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-d']);
  });

  it('changes nothing when unselecting a golfer the entry does not hold', async () => {
    const { service, addPick, removePick } = setup({ picks: [pick('pick-d', 'p-d', 'sep-d')] });

    const result = await service.unselectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(removePick).not.toHaveBeenCalled();
    expect(addPick).not.toHaveBeenCalled();
    expect(result.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-d']);
  });

  it('removes a golfer who withdrew after being picked, though a new pick of them is refused', async () => {
    const { service, removePick } = setup({
      field: [fieldRow('sep-a', 'p-a', false), fieldRow('sep-b', 'p-b'), fieldRow('sep-c', 'p-c'), fieldRow('sep-d', 'p-d')],
      picks: [pick('pick-a', 'p-a', 'sep-a')],
    });

    const result = await service.unselectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(removePick).toHaveBeenCalledWith('pick-a');
    expect(result.picks).toEqual([]);
    await expect(service.selectPick(pickChange({ sportEventParticipantId: 'sep-a' })))
      .rejects.toMatchObject({ code: 'PARTICIPANT_UNAVAILABLE', statusCode: 400 });
  });

  it('answers with only the changed entry\'s picks, its status and summary, never the room or another entry\'s picks', async () => {
    const { service } = setup({
      entries: [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, SQUAD_ID)],
      picks: [pick('pick-other', 'p-b', 'sep-b', { entryId: OTHER_ENTRY_ID })],
    });

    const result = await service.selectPick(pickChange());

    expect(Object.keys(result).sort()).toEqual(['contestId', 'entryId', 'entryStatus', 'lineupSummary', 'picks', 'sportEventId']);
    expect(result).toMatchObject({ contestId: CONTEST_ID, entryId: ENTRY_ID, sportEventId: EVENT_ID, entryStatus: 'DRAFT', lineupSummary: null });
    expect(result.picks.map((row) => [row.entryId, row.sportEventParticipantId])).toEqual([[ENTRY_ID, 'sep-a']]);
  });

  it('decides on the entry\'s picks under its lock, reads them back once for the answer, and never reads the league membership a room read needs', async () => {
    const { service, deps, changeEntryPick } = setup({ entries: [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, SQUAD_ID)] });

    await service.selectPick(pickChange());

    const reads = (deps.picks.findByEntriesWithParticipant as jest.Mock).mock.calls as Array<[string[]]>;
    expect(reads.map(([entryIds]) => entryIds)).toEqual([[ENTRY_ID]]);
    expect(changeEntryPick).toHaveBeenCalledTimes(1);
    expect(changeEntryPick).toHaveBeenCalledWith(expect.objectContaining({ entryId: ENTRY_ID, sportEventId: EVENT_ID }));
    expect(deps.memberships.findByLeagueAndUser).not.toHaveBeenCalled();
  });

  it('counts the rounds the earlier tiers take when placing into a later tier', async () => {
    const { service, addPick } = setup({
      picks: [pick('pick-a', 'p-a', 'sep-a'), pick('pick-b', 'p-b', 'sep-b')],
    });

    await service.selectPick(pickChange({ sportEventParticipantId: 'sep-d' }));

    expect(addPick).toHaveBeenCalledWith(expect.objectContaining({ lineupSlot: 3 }));
  });

  it('refuses a canonical participant id, which names no field row, with 400 PARTICIPANT_NOT_IN_EVENT', async () => {
    const { service, addPick } = setup();

    await expect(service.selectPick(pickChange({ sportEventParticipantId: 'p-a' })))
      .rejects.toMatchObject({ code: 'PARTICIPANT_NOT_IN_EVENT', statusCode: 400 });
    expect(addPick).not.toHaveBeenCalled();
  });
});

describe('SelectionService — rooms with missing or partial data', () => {
  it('places a budget pick in the next free place when the entry still has room', async () => {
    const { service, addPick } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK },
      configuration: { selectionType: SelectionType.BUDGET_PICK, configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 3, salaryCap: 500, countedScores: 3 } },
      picks: [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 })],
    });

    const result = await service.selectPick(pickChange({ sportEventParticipantId: 'sep-d' }));

    expect(result.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-a', 'sep-d']);
    expect(addPick).toHaveBeenCalledWith(expect.objectContaining({ sportEventParticipantId: 'sep-d', lineupSlot: 2 }));
  });

  it('answers 404 for a DRAFT contest\'s room to an anonymous reader and to a commissioner whose membership is inactive', async () => {
    const draft = { status: ContestStatus.DRAFT };
    await expect(setup({ contest: draft }).service.getSelectionState({ contestId: CONTEST_ID }))
      .rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });

    const inactiveCommissioner = {
      id: 'lm-1', leagueId: LEAGUE_ID, userId: OWNER_USER_ID, role: 'COMMISSIONER', status: 'INACTIVE',
    } as unknown as LeagueMembership;
    await expect(setup({ contest: draft, actorMembership: inactiveCommissioner }).service.getSelectionState({
      contestId: CONTEST_ID,
      actorUserId: OWNER_USER_ID,
    })).rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND', statusCode: 404 });
  });

  it('refuses every pick as unconfigured when the tiered configuration carries no picksPerTier, rather than guessing a roster', async () => {
    const { service, addPick } = setup({ configuration: { configJson: undefined } });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });
    expect(view.rosterSize).toBe(0);

    await expect(service.selectPick(pickChange())).rejects.toMatchObject({ code: 'SELECTION_CONFIG_INVALID' });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('answers 404 CONTEST_EVENT_NOT_IN_CONTEST for a room asked for an event the contest does not cover', async () => {
    const { service } = setup();

    await expect(service.getSelectionState({ contestId: CONTEST_ID, sportEventId: 'event-elsewhere', actorUserId: OWNER_USER_ID }))
      .rejects.toMatchObject({ code: 'CONTEST_EVENT_NOT_IN_CONTEST', statusCode: 404 });
  });

  it('refuses a pick of a golfer from an event the contest does not cover with 400 PARTICIPANT_NOT_IN_EVENT, placing nothing', async () => {
    const elsewhere = { ...fieldRow('sep-z', 'p-z'), sportEventId: 'event-elsewhere' };
    const { service, addPick } = setup({ field: [...FIELD, elsewhere] });

    await expect(service.selectPick(pickChange({ sportEventParticipantId: 'sep-z' }))).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_IN_EVENT', statusCode: 400 });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('lists an entry whose team has no active member with an empty owner rather than dropping it', async () => {
    const { service } = setup({
      entries: [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, 'squad-orphan')],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.entries.map((row) => [row.id, row.userId])).toEqual([[ENTRY_ID, OWNER_USER_ID], [OTHER_ENTRY_ID, '']]);
  });

  it('leaves a tier\'s golfer who is not on the field out of that tier\'s selection group', async () => {
    const { service } = setup({ field: FIELD.filter((row) => row.id !== 'sep-c') });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.selectionGroups[0].participants.map((participant) => participant.participantId)).toEqual(['p-a', 'p-b']);
  });

  it('places a pick of a golfer outside every tier in the history by its position in the entry, using its stored round when it has one', async () => {
    const { service } = setup({
      contest: { status: ContestStatus.ACTIVE },
      picks: [
        pick('pick-x', 'p-untiered', 'sep-x', { lineupSlot: null as unknown as number, pickSequence: null as unknown as number }),
        pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 }),
      ],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.picks.map((row) => [row.sportEventParticipantId, row.pickNumber, row.round, row.pickInRound, row.tierId]))
      .toEqual([
        ['sep-x', 1, 1, 1, undefined],
        ['sep-a', 2, 1, 1, 'tier-1'],
      ]);
  });

  it('numbers a budget-pick history by each entry\'s own pick order, not by tier', async () => {
    const { service } = setup({
      contest: { selectionType: SelectionType.BUDGET_PICK, status: ContestStatus.ACTIVE },
      configuration: { selectionType: SelectionType.BUDGET_PICK, configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 3, salaryCap: 500, countedScores: 3 } },
      picks: [pick('pick-d', 'p-d', 'sep-d'), pick('pick-a', 'p-a', 'sep-a')],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.picks.map((row) => row.round)).toEqual([1, 2]);
  });
});

// #481 — an entry is a draft until its owner submits a complete lineup, and only submitted
// entries count. These suites take one pick per tier, so a complete lineup is one from each.
describe('SelectionService.submitEntry — an entry counts only once its owner submits a complete lineup', () => {
  const COMPLETE = [pick('pick-a', 'p-a', 'sep-a'), pick('pick-d', 'p-d', 'sep-d')];
  const ONE_PER_TIER = { configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 } };

  function submitEntryInput(overrides: { entryId?: string; actorUserId?: string } = {}) {
    return {
      contestId: CONTEST_ID,
      entryId: overrides.entryId ?? ENTRY_ID,
      sportEventId: EVENT_ID,
      actorUserId: 'actorUserId' in overrides ? overrides.actorUserId : OWNER_USER_ID,
    };
  }

  it('submits a draft entry whose lineup fills every tier, and answers with the entry SUBMITTED', async () => {
    const { service, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });

    const view = await service.submitEntry(submitEntryInput());

    expect(writeStatus).toHaveBeenCalledWith(ENTRY_ID, EVENT_ID, 'SUBMITTED', expect.any(Date));
    expect(view.selectedEntryId).toBe(ENTRY_ID);
    expect(view.entries.find((row) => row.id === ENTRY_ID)?.status).toBe('SUBMITTED');
  });

  it('judges the lineup the entry lock reads, refusing a submit whose lineup an unselect left short after the room loaded it (#1300)', async () => {
    const { service, deps, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: [COMPLETE[1]] });
    // The room's read still shows the full lineup; under the lock only one pick is left.
    (deps.picks.findByEntriesWithParticipant as jest.Mock).mockResolvedValue(COMPLETE);

    await expect(service.submitEntry(submitEntryInput()))
      .rejects.toMatchObject({ code: 'ENTRY_LINEUP_INCOMPLETE' });
    expect(writeStatus).not.toHaveBeenCalled();
  });

  it('sends the Entry submitted confirmation once, when a draft is submitted, and not on a repeat submit', async () => {
    const sendEntrySubmittedEmails = jest.fn().mockResolvedValue(undefined);
    const first = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });
    first.deps.entryReceipts = { sendEntrySubmittedEmails };

    await first.service.submitEntry(submitEntryInput());
    expect(sendEntrySubmittedEmails).toHaveBeenCalledWith(expect.objectContaining({ entryIds: [ENTRY_ID] }));

    const repeat = setup({ configuration: ONE_PER_TIER, picks: COMPLETE, entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED')] });
    repeat.deps.entryReceipts = { sendEntrySubmittedEmails };
    await repeat.service.submitEntry(submitEntryInput());
    expect(sendEntrySubmittedEmails).toHaveBeenCalledTimes(1);
  });

  it('hands the confirmation the contest, event, rules, valuations and owners the submit already read, so the email reads none of them again', async () => {
    const sendEntrySubmittedEmails = jest.fn().mockResolvedValue(undefined);
    const { service, deps } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });
    deps.entryReceipts = { sendEntrySubmittedEmails };

    await service.submitEntry(submitEntryInput());

    const [[receipt]] = sendEntrySubmittedEmails.mock.calls as Array<[EntrySubmittedReceiptInput]>;
    expect(receipt.contest.id).toBe(CONTEST_ID);
    expect(receipt.sportEvent.id).toBe(EVENT_ID);
    expect(receipt.configuration?.configJson).toEqual(ONE_PER_TIER.configJson);
    expect(receipt.valuations).toEqual(VALUATIONS);
    expect(receipt.squadMemberships).toEqual([squadMembership(SQUAD_ID, OWNER_USER_ID)]);
    expect(receipt.entryIds).toEqual([ENTRY_ID]);
  });

  it('reads the event\'s picks once on a submit, and hands the same picks to the lineup check, the confirmation and the room (#1254)', async () => {
    const sendEntrySubmittedEmails = jest.fn().mockResolvedValue(undefined);
    const { service, deps } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });
    deps.entryReceipts = { sendEntrySubmittedEmails };

    const view = await service.submitEntry(submitEntryInput());

    expect(deps.picks.findByEntriesWithParticipant).toHaveBeenCalledTimes(1);
    const [[receipt]] = sendEntrySubmittedEmails.mock.calls as Array<[EntrySubmittedReceiptInput]>;
    expect(receipt.picks.map((row) => row.id).sort()).toEqual(COMPLETE.map((row) => row.id).sort());
    expect(view.entries.find((row) => row.id === ENTRY_ID)?.pickCount).toBe(COMPLETE.length);
  });

  it('still answers with the submitted room when the confirmation cannot be queued, logging it, because the picks are already submitted (#1171)', async () => {
    const { service, deps, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });
    const logger = fakeLogger();
    deps.logger = logger;
    deps.entryReceipts = { sendEntrySubmittedEmails: jest.fn().mockRejectedValue(new Error('database unavailable')) };

    const view = await service.submitEntry(submitEntryInput());

    expect(writeStatus).toHaveBeenCalledTimes(1);
    expect(view.entries.find((row) => row.id === ENTRY_ID)?.pickCount).toBe(COMPLETE.length);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'selection.submitEntry.receiptFailed' }),
      expect.any(String),
    );
  });

  it('refuses 409 ENTRY_LINEUP_INCOMPLETE naming the short tier, and leaves the entry a draft', async () => {
    const { service, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: [pick('pick-a', 'p-a', 'sep-a')] });

    await expect(service.submitEntry(submitEntryInput())).rejects.toMatchObject({
      code: 'ENTRY_LINEUP_INCOMPLETE',
      statusCode: 409,
      message: `Entry ${ENTRY_ID} cannot be submitted until every tier is filled: Tier 2 still need picks`,
    });
    expect(writeStatus).not.toHaveBeenCalled();
  });

  it('refuses 409 ENTRY_LINEUP_INCOMPLETE for an entry with no picks at all', async () => {
    const { service, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: [] });

    await expect(service.submitEntry(submitEntryInput())).rejects.toMatchObject({
      code: 'ENTRY_LINEUP_INCOMPLETE',
      statusCode: 409,
    });
    expect(writeStatus).not.toHaveBeenCalled();
  });

  it('changes nothing when the entry is already submitted, and answers with the room', async () => {
    const { service, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE, entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED')] });

    const view = await service.submitEntry(submitEntryInput());

    expect(writeStatus).not.toHaveBeenCalled();
    expect(view.entries.find((row) => row.id === ENTRY_ID)?.status).toBe('SUBMITTED');
  });

  it('submits an entry\'s lineup on an ACTIVE contest for an event that has not started yet (#713)', async () => {
    const { service, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE, contest: { status: ContestStatus.ACTIVE } });

    const view = await service.submitEntry(submitEntryInput());

    expect(writeStatus).toHaveBeenCalledWith(ENTRY_ID, EVENT_ID, 'SUBMITTED', expect.any(Date));
    expect(view.entries.find((row) => row.id === ENTRY_ID)?.status).toBe('SUBMITTED');
  });

  it('refuses 409 CONTEST_ENTRY_LOCKED once the contest is COMPLETED', async () => {
    const { service, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE, contest: { status: ContestStatus.COMPLETED } });

    await expect(service.submitEntry(submitEntryInput())).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
      statusCode: 409,
      message: `Contest ${CONTEST_ID} is COMPLETED; entries can only be submitted while it is open`,
    });
    expect(writeStatus).not.toHaveBeenCalled();
  });

  it('refuses 409 CONTEST_ENTRY_LOCKED once the event has teed off, even while the contest still says OPEN', async () => {
    const { service, deps, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });
    (deps.sportEvents.findByIds as jest.Mock).mockResolvedValue([eventStarting(new Date('2000-01-01T00:00:00.000Z'))]);

    await expect(service.submitEntry(submitEntryInput())).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
      statusCode: 409,
      message: `Contest ${CONTEST_ID}'s event has started; entries can no longer be submitted`,
    });
    expect(writeStatus).not.toHaveBeenCalled();
  });

  it('refuses 404 CONTEST_ENTRY_NOT_FOUND, 401 AUTH_SESSION_REQUIRED and 403 ENTRY_ACCESS_DENIED in that order', async () => {
    const { service } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });

    await expect(service.submitEntry(submitEntryInput({ entryId: 'missing', actorUserId: undefined })))
      .rejects.toMatchObject({ code: 'CONTEST_ENTRY_NOT_FOUND', statusCode: 404 });
    await expect(service.submitEntry(submitEntryInput({ actorUserId: undefined })))
      .rejects.toMatchObject({ code: 'AUTH_SESSION_REQUIRED', statusCode: 401 });
    await expect(service.submitEntry(submitEntryInput({ actorUserId: 'someone-else' })))
      .rejects.toMatchObject({ code: 'ENTRY_ACCESS_DENIED', statusCode: 403 });
  });
});

describe('SelectionService pick changes on a submitted entry (#481)', () => {
  const COMPLETE = [pick('pick-a', 'p-a', 'sep-a'), pick('pick-d', 'p-d', 'sep-d')];
  const ONE_PER_TIER = { configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 } };

  it('sends a submitted entry back to DRAFT when unselecting a golfer leaves its lineup short', async () => {
    const { service, deps, writeStatus } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE, entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED')] });
    (deps.entries.update as jest.Mock).mockImplementation(async (id: string, updates: Partial<ContestEntry>) => ({
      ...entry(id, SQUAD_ID, 'Entry', 'SUBMITTED'),
      ...updates,
    }));

    const result = await service.unselectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(writeStatus).toHaveBeenCalledWith(ENTRY_ID, EVENT_ID, 'DRAFT', expect.any(Date));
    expect(result.entryStatus).toBe('DRAFT');
  });

  it('sends an entry back to DRAFT when a submit committed while the unselect waited, though the room loaded it a draft (#1300)', async () => {
    const { service, writeStatus, statuses } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE });
    // The room loaded the entry a draft; under the lock it is SUBMITTED.
    statuses.set(`${ENTRY_ID}:${EVENT_ID}`, ContestEntryStatus.SUBMITTED);

    const result = await service.unselectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(writeStatus).toHaveBeenCalledWith(ENTRY_ID, EVENT_ID, 'DRAFT', expect.any(Date));
    expect(result.entryStatus).toBe('DRAFT');
  });

  it('keeps a submitted entry SUBMITTED when a swap within a full tier leaves the lineup complete', async () => {
    const { service, writeStatus, removePick } = setup({ configuration: ONE_PER_TIER, picks: COMPLETE, entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED')] });

    const result = await service.selectPick(pickChange({ sportEventParticipantId: 'sep-c' }));

    expect(removePick).toHaveBeenCalledWith('pick-a');
    expect(writeStatus).not.toHaveBeenCalled();
    expect(result.entryStatus).toBe('SUBMITTED');
  });

  it('leaves a draft entry a draft without writing its status when a pick changes', async () => {
    const { service, writeStatus } = setup({ picks: [pick('pick-a', 'p-a', 'sep-a')] });

    await service.unselectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(writeStatus).not.toHaveBeenCalled();
  });
});

describe('SelectionService budget rooms (#93): the cap blocks submitting, never a pick', () => {
  // Valuation prices: sep-a $100, sep-b $90, sep-c $80, sep-d $40. Two golfers under a $150 cap.
  const BUDGET = {
    contest: { selectionType: SelectionType.BUDGET_PICK },
    configuration: {
      selectionType: SelectionType.BUDGET_PICK,
      configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 150, countedScores: 2 },
    },
  } satisfies SetupOptions;
  const UNDER = [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 }), pick('pick-d', 'p-d', 'sep-d', { lineupSlot: 2 })];
  const OVER = [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 }), pick('pick-b', 'p-b', 'sep-b', { lineupSlot: 2 })];
  const submitEntryInput = { contestId: CONTEST_ID, entryId: ENTRY_ID, sportEventId: EVENT_ID, actorUserId: OWNER_USER_ID };

  it('submits a full lineup that costs no more than the cap', async () => {
    const { service, writeStatus } = setup({ ...BUDGET, picks: UNDER });

    await service.submitEntry(submitEntryInput);

    expect(writeStatus).toHaveBeenCalledWith(ENTRY_ID, EVENT_ID, 'SUBMITTED', expect.any(Date));
  });

  it('refuses 409 ENTRY_OVER_BUDGET for a full lineup over the cap, naming both amounts, and leaves the entry a draft', async () => {
    const { service, writeStatus } = setup({ ...BUDGET, picks: OVER });

    await expect(service.submitEntry(submitEntryInput)).rejects.toMatchObject({
      code: 'ENTRY_OVER_BUDGET',
      statusCode: 409,
      message: `Entry ${ENTRY_ID} cannot be submitted while its picks cost $190, over the $150 salary cap`,
    });
    expect(writeStatus).not.toHaveBeenCalled();
  });

  it('reports a short lineup as incomplete ahead of the budget, even when it is already over the cap', async () => {
    const { service } = setup({
      ...BUDGET,
      configuration: { ...BUDGET.configuration, configJson: { ...BUDGET.configuration.configJson, salaryCap: 50 } },
      picks: [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 })],
    });

    await expect(service.submitEntry(submitEntryInput)).rejects.toMatchObject({
      code: 'ENTRY_LINEUP_INCOMPLETE',
      message: `Entry ${ENTRY_ID} cannot be submitted until its lineup is complete: it holds 1 of 2 picks`,
    });
  });

  it('places a pick that takes the entry over the cap', async () => {
    const { service, addPick } = setup({ ...BUDGET, picks: [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 })] });

    const result = await service.selectPick(pickChange({ sportEventParticipantId: 'sep-b' }));

    expect(addPick).toHaveBeenCalledWith(expect.objectContaining({ sportEventParticipantId: 'sep-b', lineupSlot: 2 }));
    expect(result.lineupSummary).toMatchObject({ spent: 190, remaining: -40, isOverBudget: true, openSlots: 0 });
  });

  it('refuses 400 PRICE_MISSING for a golfer with no price, placing nothing', async () => {
    const { service, addPick } = setup({
      ...BUDGET,
      valuations: VALUATIONS.map((valuation) =>
        (valuation as { sportEventParticipantId: string }).sportEventParticipantId === 'sep-d'
          ? { ...(valuation as object), price: null }
          : valuation),
    });

    await expect(service.selectPick(pickChange({ sportEventParticipantId: 'sep-d' }))).rejects.toMatchObject({
      code: 'PRICE_MISSING',
      statusCode: 400,
    });
    expect(addPick).not.toHaveBeenCalled();
  });

  it('sends a submitted entry back to DRAFT when a swap takes its full lineup over the cap', async () => {
    const { service, deps, writeStatus } = setup({ ...BUDGET, entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED')] });
    (deps.picks.findByEntriesWithParticipant as jest.Mock)
      .mockResolvedValueOnce([UNDER[0]])
      .mockResolvedValue(OVER);
    (deps.entries.update as jest.Mock).mockImplementation(async (id: string, updates: Partial<ContestEntry>) => ({
      ...entry(id, SQUAD_ID, 'Entry', 'SUBMITTED'),
      ...updates,
    }));

    const result = await service.selectPick(pickChange({ sportEventParticipantId: 'sep-b' }));

    expect(writeStatus).toHaveBeenCalledWith(ENTRY_ID, EVENT_ID, 'DRAFT', expect.any(Date));
    expect(result.entryStatus).toBe('DRAFT');
  });

  it('lists the whole field as one group, dearest first, and summarises the viewed entry\'s spend', async () => {
    const { service } = setup({ ...BUDGET, picks: [pick('pick-b', 'p-b', 'sep-b', { lineupSlot: 1 })] });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.selectionGroups.map((group) => [group.groupName, group.participants.map((row) => [row.sportEventParticipantId, row.isSelected])]))
      .toEqual([['Field', [['sep-a', false], ['sep-b', true], ['sep-c', false], ['sep-d', false]]]]);
    expect(view.lineupSummary).toEqual({
      selectionType: SelectionType.BUDGET_PICK,
      salaryCap: 150,
      spent: 90,
      remaining: 60,
      isOverBudget: false,
      openSlots: 1,
      cheapestFill: 40,
    });
  });

  it('prices the cheapest fill with golfers another entry holds still in the open field', async () => {
    const { service } = setup({
      ...BUDGET,
      picks: [
        pick('pick-b', 'p-b', 'sep-b', { lineupSlot: 1 }),
        pick('pick-other', 'p-d', 'sep-d', { entryId: OTHER_ENTRY_ID, lineupSlot: 1 }),
      ],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.lineupSummary).toMatchObject({ openSlots: 1, cheapestFill: 40 });
  });
});

// A golfer one entry holds stays in every room's available ids, whichever engine serves it.
describe.each([
  { selectionType: SelectionType.TIERED, configuration: {} },
  {
    selectionType: SelectionType.BUDGET_PICK,
    configuration: { configJson: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, salaryCap: 500, countedScores: 2 } },
  },
])('SelectionService in a $selectionType room', ({ selectionType, configuration: typeConfiguration }) => {
  const takenByOtherEntry = [pick('pick-other', 'p-a', 'sep-a', { entryId: OTHER_ENTRY_ID })];
  const room = () =>
    setup({
      contest: { selectionType },
      configuration: { selectionType, ...typeConfiguration },
      picks: takenByOtherEntry,
    });

  it('keeps a golfer another entry holds in the available ids', async () => {
    const view = await room().service.getSelectionState({ contestId: CONTEST_ID });

    expect(view.availableSportEventParticipantIds).toContain('sep-a');
  });
});

describe('SelectionService.runDraw — the random draw deals every entry its picks (#601)', () => {
  const DRAWN_AT = new Date('2026-04-01T12:00:00.000Z');
  const DRAW = {
    contest: { selectionType: SelectionType.RANDOM_DRAW },
    configuration: {
      selectionType: SelectionType.RANDOM_DRAW,
      configJson: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 2, countedScores: 1 },
    },
    entries: [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, 'squad-2')],
  } as const;
  const runDraw = { contestId: CONTEST_ID, actorUserId: 'user-commissioner' };

  it('deals each entry the contest\'s picks per entry from the field by the seed, and records the draw with who ran it', async () => {
    const { service, recordDraw } = setup({ ...DRAW, entries: [...DRAW.entries] });

    await service.runDraw(runDraw);

    const expected = dealRandomDraw({
      seed: 'seed-1',
      sportEventParticipantIds: ['sep-a', 'sep-b', 'sep-c', 'sep-d'],
      entryIds: [ENTRY_ID, OTHER_ENTRY_ID],
      picksPerEntry: 2,
    });
    expect(recordDraw).toHaveBeenCalledWith({
      contestId: CONTEST_ID,
      seed: 'seed-1',
      fieldOrder: expected.fieldOrder,
      entryOrder: expected.entryOrder,
      drawnByUserId: 'user-commissioner',
      entries: expected.entries,
    });
    const dealt = expected.entries.flatMap((drawn) => drawn.sportEventParticipantIds);
    expect(dealt).toHaveLength(4);
    expect(new Set(dealt).size).toBe(4);
  });

  it('answers with the dealt room without sending any receipt, reading the dealt picks once: the next lifecycle sweep sends the receipts (#1171)', async () => {
    const dealt = [
      pick('pick-1', 'p-a', 'sep-a', { lineupSlot: 1 }),
      pick('pick-2', 'p-b', 'sep-b', { entryId: OTHER_ENTRY_ID, lineupSlot: 1 }),
    ];
    const context = setup({ ...DRAW, entries: [...DRAW.entries], picks: dealt });
    const sendEntrySubmittedEmails = jest.fn().mockResolvedValue(undefined);
    context.deps.entryReceipts = { sendEntrySubmittedEmails };

    const view = await context.service.runDraw(runDraw);

    expect(sendEntrySubmittedEmails).not.toHaveBeenCalled();
    expect(context.deps.picks.findByEntriesWithParticipant).toHaveBeenCalledTimes(1);
    expect(view.entries.map((row) => row.pickCount)).toEqual([1, 1]);
  });

  it('answers with the room as dealt without reloading the contest: drawn at the recorded time, every entry submitted, picks closed and revealed', async () => {
    const dealt = [
      pick('pick-1', 'p-a', 'sep-a', { lineupSlot: 1 }),
      pick('pick-2', 'p-b', 'sep-b', { entryId: OTHER_ENTRY_ID, lineupSlot: 1 }),
    ];
    const { service, deps } = setup({ ...DRAW, entries: [...DRAW.entries], picks: dealt });

    const view = await service.runDraw(runDraw);

    expect(deps.contests.findById).toHaveBeenCalledTimes(1);
    expect(deps.entries.findByContest).toHaveBeenCalledTimes(1);
    expect(deps.field.findBySportEvent).toHaveBeenCalledTimes(1);
    expect(view.contest.drawnAt).toEqual(RECORDED_DRAW_AT);
    expect(view.entries.map((row) => row.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
    expect(view.acceptsPicks).toBe(false);
    expect(view.picks.map((row) => row.entryId)).toEqual([ENTRY_ID, OTHER_ENTRY_ID]);
  });

  it('never deals a golfer who is out of the field', async () => {
    const { service, recordDraw } = setup({
      ...DRAW,
      entries: [entry(ENTRY_ID, SQUAD_ID)],
      field: [fieldRow('sep-a', 'p-a'), fieldRow('sep-b', 'p-b'), fieldRow('sep-c', 'p-c'), fieldRow('sep-d', 'p-d', false)],
    });

    await service.runDraw(runDraw);

    const [[recorded]] = recordDraw.mock.calls as Array<[{ fieldOrder: string[] }]>;
    expect([...recorded.fieldOrder].sort()).toEqual(['sep-a', 'sep-b', 'sep-c']);
  });

  it.each([
    ['CONTEST_NOT_RANDOM_DRAW for a contest of another selection type', { contest: { selectionType: SelectionType.TIERED }, configuration: {} }],
    ['CONTEST_DRAW_ALREADY_RUN for a contest already drawn', { contest: { ...DRAW.contest, drawnAt: DRAWN_AT } }],
    ['CONTEST_DRAW_NOT_OPEN for a draft contest', { contest: { ...DRAW.contest, status: ContestStatus.DRAFT } }],
    ['CONTEST_DRAW_NO_ENTRIES for a contest nobody has entered', { entries: [] }],
    ['CONTEST_DRAW_FIELD_TOO_SMALL when the field cannot deal every entry its picks', {
      entries: [entry(ENTRY_ID, SQUAD_ID), entry(OTHER_ENTRY_ID, 'squad-2'), entry('entry-3', 'squad-3')],
    }],
  ])('refuses 409 %s, dealing nothing', async (expected, overrides) => {
    const { service, recordDraw } = setup({ ...DRAW, entries: [...DRAW.entries], ...overrides } as SetupOptions);

    await expect(service.runDraw(runDraw)).rejects.toMatchObject({
      code: expected.split(' ')[0],
      statusCode: 409,
    });
    expect(recordDraw).not.toHaveBeenCalled();
  });

  it('refuses 409 CONTEST_EVENT_ALREADY_STARTED once the event has teed off, dealing nothing', async () => {
    const { service, deps, recordDraw } = setup({ ...DRAW, entries: [...DRAW.entries] });
    (deps.sportEvents.findByIds as jest.Mock).mockResolvedValue([eventStarting(new Date('2020-01-01T00:00:00.000Z'))]);

    await expect(service.runDraw(runDraw)).rejects.toMatchObject({ code: 'CONTEST_EVENT_ALREADY_STARTED', statusCode: 409 });
    expect(recordDraw).not.toHaveBeenCalled();
  });

  it.each([
    [new ContestDrawAlreadyRunError(CONTEST_ID), 'CONTEST_DRAW_ALREADY_RUN'],
    [new ContestDrawEntriesChangedError(CONTEST_ID), 'CONTEST_DRAW_ENTRIES_CHANGED'],
  ])('answers 409 %s when the write finds the contest drawn or its entries changed meanwhile', async (error, code) => {
    const { service, recordDraw } = setup({ ...DRAW, entries: [...DRAW.entries] });
    recordDraw.mockRejectedValue(error);

    await expect(service.runDraw(runDraw)).rejects.toMatchObject({ code, statusCode: 409 });
  });

  it('refuses 409 SELECTION_DEALT_BY_DRAW for a pick, before the draw and after it, placing nothing', async () => {
    const before = setup({ ...DRAW, entries: [...DRAW.entries] });
    const after = setup({ ...DRAW, contest: { ...DRAW.contest, drawnAt: DRAWN_AT }, entries: [...DRAW.entries] });

    for (const { service, addPick } of [before, after]) {
      await expect(service.selectPick(pickChange())).rejects.toMatchObject({ code: 'SELECTION_DEALT_BY_DRAW', statusCode: 409 });
      expect(addPick).not.toHaveBeenCalled();
    }
  });

  it('refuses 409 SELECTION_DEALT_BY_DRAW for unselecting a golfer the draw dealt, so a dealt lineup stays as dealt', async () => {
    const { service, removePick } = setup({
      ...DRAW,
      contest: { ...DRAW.contest, drawnAt: DRAWN_AT },
      entries: [...DRAW.entries],
      picks: [pick('pick-a', 'p-a', 'sep-a', { lineupSlot: 1 })],
    });

    await expect(service.unselectPick(pickChange())).rejects.toMatchObject({ code: 'SELECTION_DEALT_BY_DRAW', statusCode: 409 });
    expect(removePick).not.toHaveBeenCalled();
  });

  it('refuses 409 SELECTION_DEALT_BY_DRAW for submitting an entry once the draw has dealt', async () => {
    const { service } = setup({ ...DRAW, contest: { ...DRAW.contest, drawnAt: DRAWN_AT }, entries: [...DRAW.entries] });

    await expect(service.submitEntry({ contestId: CONTEST_ID, entryId: ENTRY_ID, sportEventId: EVENT_ID, actorUserId: OWNER_USER_ID }))
      .rejects.toMatchObject({ code: 'SELECTION_DEALT_BY_DRAW', statusCode: 409 });
  });

  it('shows every entry\'s dealt picks to the league once drawn, while the contest is still open', async () => {
    const { service } = setup({
      ...DRAW,
      contest: { ...DRAW.contest, drawnAt: DRAWN_AT },
      entries: [...DRAW.entries],
      picks: [pick('pick-other', 'p-a', 'sep-a', { entryId: OTHER_ENTRY_ID, lineupSlot: 1 })],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID, selectedEntryId: OTHER_ENTRY_ID });

    expect(view.picks.map((row) => row.entryId)).toEqual([OTHER_ENTRY_ID]);
    expect(view.selectedEntryId).toBe(OTHER_ENTRY_ID);
  });
});


describe('SelectionService.sendDrawReceipts — the lifecycle sweep sends a drawn contest\'s receipts (#1171)', () => {
  const DRAWN = {
    contest: { selectionType: SelectionType.RANDOM_DRAW, drawnAt: RECORDED_DRAW_AT },
    configuration: {
      selectionType: SelectionType.RANDOM_DRAW,
      configJson: { selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 1, countedScores: 1 },
    },
    entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED'), entry(OTHER_ENTRY_ID, 'squad-2', 'Entry', 'SUBMITTED')],
    squadMemberships: [squadMembership(SQUAD_ID, OWNER_USER_ID), squadMembership('squad-2', 'user-2')],
    picks: [
      pick('pick-1', 'p-a', 'sep-a', { lineupSlot: 1 }),
      pick('pick-2', 'p-b', 'sep-b', { entryId: OTHER_ENTRY_ID, lineupSlot: 1 }),
    ],
  };

  it('hands every entry of the drawn contest to one receipt batch, with the drawn contest, the rules, the owners and the dealt picks read once', async () => {
    const { service, deps } = setup(DRAWN);
    const sendEntrySubmittedEmails = jest.fn().mockResolvedValue(undefined);
    deps.entryReceipts = { sendEntrySubmittedEmails };

    await service.sendDrawReceipts(CONTEST_ID);

    expect(sendEntrySubmittedEmails).toHaveBeenCalledTimes(1);
    const [[receipt]] = sendEntrySubmittedEmails.mock.calls as Array<[EntrySubmittedReceiptInput]>;
    expect(receipt.contest).toMatchObject({ id: CONTEST_ID, drawnAt: RECORDED_DRAW_AT });
    expect(receipt.sportEvent.id).toBe(EVENT_ID);
    expect(receipt.configuration?.configJson).toEqual(DRAWN.configuration.configJson);
    expect(receipt.entryIds).toEqual([ENTRY_ID, OTHER_ENTRY_ID]);
    expect(receipt.squadMemberships).toEqual(DRAWN.squadMemberships);
    expect(receipt.picks.map((row) => row.id)).toEqual(['pick-1', 'pick-2']);
    expect(deps.picks.findByEntriesWithParticipant).toHaveBeenCalledTimes(1);
    expect(deps.squadMemberships.findBySquads).toHaveBeenCalledTimes(1);
  });

  it('throws when the receipts cannot be queued, so the sweep keeps the draw marked and tries again', async () => {
    const { service, deps } = setup(DRAWN);
    deps.entryReceipts = { sendEntrySubmittedEmails: jest.fn().mockRejectedValue(new Error('database unavailable')) };

    await expect(service.sendDrawReceipts(CONTEST_ID)).rejects.toThrow('database unavailable');
  });
});
describe('SelectionService — what one pick reads (#1196)', () => {
  it('reads the event\'s field once per pick, and hands it to the one read of the tiers and valuations', async () => {
    const { service, deps } = setup();

    await service.selectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    expect(deps.field.findBySportEvent).toHaveBeenCalledTimes(1);
    expect(deps.tiers.getEffectiveTiersAndValuations).toHaveBeenCalledTimes(1);
    expect(deps.tiers.getEffectiveTiersAndValuations).toHaveBeenCalledWith(EVENT_ID, FIELD);
  });

  it('asks for only the event\'s picks on every pick read, so other events\' picks are filtered in the query', async () => {
    const { service, deps } = setup({ entries: [entry(ENTRY_ID, SQUAD_ID, 'Entry', 'SUBMITTED')] });

    await service.selectPick(pickChange({ sportEventParticipantId: 'sep-a' }));

    const reads = (deps.picks.findByEntriesWithParticipant as jest.Mock).mock.calls as Array<[string[], { sportEventId?: string } | undefined]>;
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(([, read]) => read?.sportEventId === EVENT_ID)).toBe(true);
  });

  it('leaves another event\'s picks out of the room\'s pick history and pick counts', async () => {
    const { service } = setup({
      picks: [
        pick('pick-here', 'p-a', 'sep-a'),
        { ...pick('pick-elsewhere', 'p-b', 'sep-b'), sportEventId: 'event-elsewhere' },
      ],
    });

    const view = await service.getSelectionState({ contestId: CONTEST_ID, actorUserId: OWNER_USER_ID });

    expect(view.picks.map((row) => row.sportEventParticipantId)).toEqual(['sep-a']);
    expect(view.entries.find((row) => row.id === ENTRY_ID)?.pickCount).toBe(1);
  });
});
