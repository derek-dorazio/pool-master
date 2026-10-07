import { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  LeagueMembership,
  Participant,
  SportEventParticipant,
  SquadMembership,
} from '@poolmaster/shared/domain';
import type { ContestEntryPickWithParticipant } from '@poolmaster/shared/db';
import { DraftService } from '../../../packages/core-api/src/modules/drafts/service';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { toDraftStateResponse } from '../../../packages/core-api/src/mappers/drafts.mapper';
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

// Selection use cases, played through DraftService against a small stateful world.
//
// draft-service.test.ts pins each guard and outcome one submission at a time over canned
// reads. These tests walk a member through a sequence — fill a roster, swap within a full
// tier, unselect, compete for an exclusive golfer — with picks that the writes really add and
// remove, and assert the room each step leaves behind rather than which port was called.
// The fakes mirror the adapters' filters: squad memberships are ACTIVE-only, as
// `PrismaSquadMembershipRepository.findBySquads` is by default, and picks come back in pick
// order, as every `ContestEntryPickRepository` read does.

const CONTEST_ID = 'contest-1';
const LEAGUE_ID = 'league-1';
const EVENT_ID = 'event-1';
const SQUAD_A = 'squad-a';
const SQUAD_B = 'squad-b';
const ENTRY_A = 'entry-a';
const ENTRY_B = 'entry-b';
const ALICE = 'user-alice';
const ALICE_CO_OWNER = 'user-carol';
const BOB = 'user-bob';

const TIMESTAMPS = {
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

// Two tiers: tier 1 asks for two golfers (a, b, c), tier 2 for one (d, e). Roster size 3.
const TIERS = [
  { key: 'tier-1', label: 'Tier 1', number: 1, picks: 2, golfers: ['a', 'b', 'c'] },
  { key: 'tier-2', label: 'Tier 2', number: 2, picks: 1, golfers: ['d', 'e'] },
];

interface WorldOptions {
  status?: Contest['status'];
  isExclusive?: boolean;
  /** Field rows to mark withdrawn, by golfer letter. */
  withdrawn?: string[];
  squadMemberships?: SquadMembership[];
  leagueMemberships?: LeagueMembership[];
}

function squadMembership(
  squadId: string,
  userId: string,
  overrides: Partial<SquadMembership> = {},
): SquadMembership {
  return {
    id: `${squadId}-${userId}`,
    squadId,
    leagueId: LEAGUE_ID,
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: TIMESTAMPS.createdAt,
    ...TIMESTAMPS,
    ...overrides,
  } as SquadMembership;
}

function leagueMembership(userId: string, role: 'COMMISSIONER' | 'MEMBER'): LeagueMembership {
  return {
    id: `lm-${userId}`,
    leagueId: LEAGUE_ID,
    userId,
    role,
    status: 'ACTIVE',
    joinedAt: TIMESTAMPS.createdAt,
    ...TIMESTAMPS,
  } as LeagueMembership;
}

function entry(id: string, squadId: string, tiebreakerValue: number | null = null): ContestEntry {
  return {
    id,
    contestId: CONTEST_ID,
    squadId,
    entryNumber: 1,
    name: `Entry ${id}`,
    status: 'ACTIVE',
    tiebreakerValue,
    isEliminated: false,
    ...TIMESTAMPS,
  };
}

function buildWorld(options: WorldOptions = {}) {
  const contest = {
    id: CONTEST_ID,
    leagueId: LEAGUE_ID,
    sportEventId: EVENT_ID,
    name: 'Masters Pool',
    status: options.status ?? ContestStatus.OPEN,
    contestFormat: 'ROSTER',
    selectionType: SelectionType.TIERED,
    scoringEngine: 'STROKE_PLAY',
    isExclusive: false,
    scoringStopsOnElimination: false,
    ...TIMESTAMPS,
  } as Contest;
  const configuration = {
    id: 'config-1',
    contestId: CONTEST_ID,
    selectionType: SelectionType.TIERED,
    isExclusive: options.isExclusive ?? false,
    ...TIMESTAMPS,
  } as ContestConfiguration;
  const entries = [entry(ENTRY_A, SQUAD_A, -8), entry(ENTRY_B, SQUAD_B, -12)];
  const squadMemberships = options.squadMemberships ?? [
    squadMembership(SQUAD_A, ALICE),
    squadMembership(SQUAD_B, BOB),
  ];
  const leagueMemberships = options.leagueMemberships ?? [
    leagueMembership(ALICE, 'MEMBER'),
    leagueMembership(BOB, 'MEMBER'),
  ];
  const withdrawn = new Set(options.withdrawn ?? []);
  const golfers = TIERS.flatMap((tier) => tier.golfers);
  const field: SportEventParticipant[] = golfers.map((golfer) => ({
    id: `sep-${golfer}`,
    sportEventId: EVENT_ID,
    participantId: `p-${golfer}`,
    isActive: !withdrawn.has(golfer),
    ...(withdrawn.has(golfer) ? { inactiveReason: 'WITHDRAWN' } : {}),
    metadata: {},
    ...TIMESTAMPS,
  }) as SportEventParticipant);
  const participants = golfers.map((golfer) => ({
    id: `p-${golfer}`,
    sportId: 'sport-1',
    name: `Golfer ${golfer.toUpperCase()}`,
    participantType: 'INDIVIDUAL',
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    externalIds: {},
    ...TIMESTAMPS,
  }) as Participant);
  const tierGroups = TIERS.map((tier) => ({
    tierKey: tier.key,
    label: tier.label,
    tierNumber: tier.number,
    defaultPickCount: tier.picks,
    participants: tier.golfers.map((golfer, index) => ({
      sportEventParticipantId: `sep-${golfer}`,
      participantId: `p-${golfer}`,
      tierOrderIndex: index + 1,
      price: 100 - index,
    })),
  }));
  const valuations = TIERS.flatMap((tier) => tier.golfers.map((golfer, index) => ({
    sportEventParticipantId: `sep-${golfer}`,
    participantId: `p-${golfer}`,
    tierId: tier.key,
    tierKey: tier.key,
    tierLabel: tier.label,
    tierNumber: tier.number,
    tierOrderIndex: index + 1,
    price: 100 - index,
  })));

  // The pick store the two writes really change. Ordered by pick time, as the adapter is.
  let clock = Date.parse('2026-02-01T00:00:00.000Z');
  let nextId = 1;
  const picks: ContestEntryPickWithParticipant[] = [];
  const fieldRowById = new Map(field.map((row) => [row.id, row]));
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  const service = new DraftService({
    contests: fakeContestRepo({ findById: async (id: string) => (id === CONTEST_ID ? contest : null) }),
    configurations: fakeContestConfigurationRepo({ findByContest: async () => configuration }),
    entries: fakeContestEntryRepo({ findByContest: async () => entries }),
    memberships: fakeLeagueMembershipRepo({
      findByLeagueAndUser: async (leagueId: string, userId: string) =>
        leagueMemberships.find((m) => m.leagueId === leagueId && m.userId === userId) ?? null,
    }),
    squadMemberships: fakeSquadMembershipRepo({
      findBySquads: async (squadIds: readonly string[]) =>
        squadMemberships.filter((m) => squadIds.includes(m.squadId) && m.status === 'ACTIVE'),
    }),
    field: fakeSportEventParticipantRepo({
      findBySportEvent: async () => field,
      findById: async (id: string) => fieldRowById.get(id) ?? null,
    }),
    participants: fakeParticipantRepo({ findByIds: async () => participants }),
    picks: fakeContestEntryPickRepo({
      findByEntriesWithParticipant: async (entryIds: readonly string[]) =>
        picks.filter((pick) => entryIds.includes(pick.entryId)),
      findByContestAndParticipant: async (_contestId: string, sportEventParticipantId: string) =>
        picks.filter((pick) => pick.sportEventParticipantId === sportEventParticipantId),
      countByContest: async () => picks.length,
    }),
    pickWrites: {
      createPick: async (input: {
        entryId: string;
        sportEventParticipantId: string;
        draftRound?: number;
        draftPickNumber?: number;
        isAutoPicked?: boolean;
      }) => {
        const row = fieldRowById.get(input.sportEventParticipantId) as SportEventParticipant;
        const participant = participantById.get(row.participantId) as Participant;
        clock += 1000;
        const created = {
          id: `pick-${nextId++}`,
          entryId: input.entryId,
          sportEventParticipantId: input.sportEventParticipantId,
          contestFormat: 'ROSTER_SELECTION',
          draftRound: input.draftRound ?? null,
          draftPickNumber: input.draftPickNumber ?? null,
          isAutoPicked: input.isAutoPicked ?? false,
          pickedAt: new Date(clock),
          ...TIMESTAMPS,
          participant: {
            participantId: participant.id,
            participantName: participant.name,
            isActive: row.isActive,
            inactiveReason: row.inactiveReason ?? null,
            role: 'GOLFER',
            teamAffiliation: null,
          },
        } as unknown as ContestEntryPickWithParticipant;
        picks.push(created);
        return created;
      },
      deletePick: async (pickId: string) => {
        const index = picks.findIndex((pick) => pick.id === pickId);
        if (index >= 0) picks.splice(index, 1);
      },
    } as never,
    tiers: {
      getEffectiveTiersForSportEvent: async () => tierGroups,
      getEffectiveValuationsForSportEvent: async () => valuations,
    } as unknown as SportEventTierService,
  });

  return {
    service,
    contest,
    picks,
    /** Golfer letters currently held by an entry, in pick order. */
    held: (entryId: string) =>
      picks.filter((pick) => pick.entryId === entryId).map((pick) => pick.sportEventParticipantId.replace('sep-', '')),
    pickFor: (entryId: string, golfer: string, actorUserId = entryId === ENTRY_A ? ALICE : BOB) =>
      service.submitSelection({
        contestId: CONTEST_ID,
        entryId,
        participantId: `sep-${golfer}`,
        actorUserId,
      }),
  };
}

describe('Tiered selection — a member building an entry', () => {
  it('fills a roster tier by tier, after which the room reports the entry full and closes further picks', async () => {
    const world = buildWorld();

    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    const result = await world.pickFor(ENTRY_A, 'd');

    expect(world.held(ENTRY_A)).toEqual(['a', 'b', 'd']);
    expect(result.view.rosterSize).toBe(3);
    expect(result.view.canCurrentUserSubmit).toBe(false);
    expect(result.view.currentEntryId).toBeNull();
    expect(result.view.selectionGroups.map((group) =>
      group.participants.filter((participant) => participant.isSelected).map((p) => p.participantId),
    )).toEqual([['p-a', 'p-b'], ['p-d']]);
  });

  it('stores each pick in the round its tier position gives it, whatever order the tiers are filled in', async () => {
    const world = buildWorld();

    await world.pickFor(ENTRY_A, 'd');
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');

    expect(world.picks.map((pick) => [pick.sportEventParticipantId, pick.draftRound])).toEqual([
      ['sep-d', 3],
      ['sep-a', 1],
      ['sep-b', 2],
    ]);
  });

  it('swaps the newest pick in a full tier for the new golfer, keeping the roster size and the swapped pick\'s round', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    await world.pickFor(ENTRY_A, 'd');

    const swapped = await world.pickFor(ENTRY_A, 'c');

    expect(swapped.outcome).toBe('placed');
    expect(world.held(ENTRY_A)).toEqual(['a', 'd', 'c']);
    expect(world.picks.find((pick) => pick.sportEventParticipantId === 'sep-c')?.draftRound).toBe(2);
  });

  it('swaps the only pick in a one-golfer tier on a full roster rather than refusing the entry as complete', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    await world.pickFor(ENTRY_A, 'd');

    await world.pickFor(ENTRY_A, 'e');

    expect(world.held(ENTRY_A)).toEqual(['a', 'b', 'e']);
  });

  it('unselects a held golfer when it is picked again, and lets the same golfer be picked back', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');

    const off = await world.pickFor(ENTRY_A, 'a');
    expect(off.outcome).toBe('toggled-off');
    expect(world.held(ENTRY_A)).toEqual([]);
    expect(off.view.canCurrentUserSubmit).toBe(true);

    await world.pickFor(ENTRY_A, 'a');
    expect(world.held(ENTRY_A)).toEqual(['a']);
  });

  it('lets two entries in a non-exclusive contest hold the same golfer', async () => {
    const world = buildWorld();

    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_B, 'a');

    expect(world.held(ENTRY_A)).toEqual(['a']);
    expect(world.held(ENTRY_B)).toEqual(['a']);
  });

  it('lets a co-owner of the entry\'s team pick for it, and shows that entry to them as their own', async () => {
    const world = buildWorld({
      squadMemberships: [
        squadMembership(SQUAD_A, ALICE),
        squadMembership(SQUAD_A, ALICE_CO_OWNER, { joinedAt: new Date('2026-01-02T00:00:00.000Z') }),
        squadMembership(SQUAD_B, BOB),
      ],
    });

    const result = await world.pickFor(ENTRY_A, 'a', ALICE_CO_OWNER);

    expect(world.held(ENTRY_A)).toEqual(['a']);
    expect(result.view.myEntryId).toBe(ENTRY_A);
    expect(result.view.canCurrentUserSubmit).toBe(true);
  });

  it('refuses a pick from someone who has left the entry\'s team, leaving the entry unchanged', async () => {
    const world = buildWorld({
      squadMemberships: [
        squadMembership(SQUAD_A, ALICE, { status: 'INACTIVE' } as Partial<SquadMembership>),
        squadMembership(SQUAD_B, BOB),
      ],
    });

    await expect(world.pickFor(ENTRY_A, 'a', ALICE)).rejects.toMatchObject({
      code: 'DRAFT_ENTRY_ACCESS_DENIED',
      statusCode: 403,
    });
    expect(world.held(ENTRY_A)).toEqual([]);
  });
});

describe('Tiered selection — withdrawn golfers', () => {
  it('refuses a new pick of a withdrawn golfer', async () => {
    const world = buildWorld({ withdrawn: ['b'] });

    await expect(world.pickFor(ENTRY_A, 'b')).rejects.toMatchObject({
      code: 'PARTICIPANT_UNAVAILABLE',
      statusCode: 400,
    });
    expect(world.held(ENTRY_A)).toEqual([]);
  });

  it('lets an entry unselect a golfer it already holds who has since withdrawn, freeing the slot', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    // The golfer withdraws after the pick: the field row goes inactive under the entry.
    const later = buildWorld({ withdrawn: ['b'] });
    later.picks.push(...world.picks);

    const result = await later.pickFor(ENTRY_A, 'b');

    expect(result.outcome).toBe('toggled-off');
    expect(later.held(ENTRY_A)).toEqual(['a']);
  });
});

describe('Tiered selection — exclusive contests', () => {
  it('refuses a golfer another entry holds, and frees them for everyone once that entry unselects them', async () => {
    const world = buildWorld({ isExclusive: true });
    await world.pickFor(ENTRY_A, 'a');

    await expect(world.pickFor(ENTRY_B, 'a')).rejects.toMatchObject({
      code: 'PARTICIPANT_ALREADY_TAKEN',
      statusCode: 400,
    });
    const roomForBob = await world.service.getDraftState({ contestId: CONTEST_ID, actorUserId: BOB });
    expect(roomForBob.availableSportEventParticipantIds).not.toContain('sep-a');

    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_B, 'a');
    expect(world.held(ENTRY_B)).toEqual(['a']);
  });

  it('frees the golfer a full-tier swap displaced, so another entry can take them', async () => {
    const world = buildWorld({ isExclusive: true });
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    await world.pickFor(ENTRY_A, 'c');

    await world.pickFor(ENTRY_B, 'b');

    expect(world.held(ENTRY_A)).toEqual(['a', 'c']);
    expect(world.held(ENTRY_B)).toEqual(['b']);
  });
});

describe('Tiered selection — picks change only while the contest is open', () => {
  const closedStatuses = [
    ContestStatus.DRAFT,
    ContestStatus.LOCKED,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
    ContestStatus.CANCELLED,
  ];

  it.each(closedStatuses)('refuses a new pick with 409 CONTEST_ENTRY_LOCKED on a %s contest', async (status) => {
    const world = buildWorld({ status });

    await expect(world.pickFor(ENTRY_A, 'a')).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
      statusCode: 409,
    });
    expect(world.held(ENTRY_A)).toEqual([]);
  });

  it.each(closedStatuses)('refuses to unselect or swap a held golfer on a %s contest', async (status) => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    world.contest.status = status;

    await expect(world.pickFor(ENTRY_A, 'a')).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    await expect(world.pickFor(ENTRY_A, 'c')).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    expect(world.held(ENTRY_A)).toEqual(['a', 'b']);
  });

  it.each(closedStatuses)('tells the room a %s contest takes no picks, even for an unfinished entry', async (status) => {
    const world = buildWorld({
      status,
      leagueMemberships: [leagueMembership(ALICE, 'COMMISSIONER'), leagueMembership(BOB, 'MEMBER')],
    });

    const room = await world.service.getDraftState({ contestId: CONTEST_ID, actorUserId: ALICE });

    expect(room.canCurrentUserSubmit).toBe(false);
    expect(room.currentEntryId).toBeNull();
  });
});

describe('Draft room — what a member may see', () => {
  async function bothEntriesPicked(status: Contest['status']) {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_B, 'c');
    await world.pickFor(ENTRY_B, 'e');
    world.contest.status = status;
    return world;
  }

  it('shows a member only their own entry\'s picks in the history while the contest is open', async () => {
    const world = await bothEntriesPicked(ContestStatus.OPEN);

    const room = await world.service.getDraftState({ contestId: CONTEST_ID, actorUserId: ALICE });

    expect(room.picks.map((pick) => pick.entryId)).toEqual([ENTRY_A]);
  });

  it('does not show a member another team\'s selections or tiebreaker while the contest is open, falling back to their own entry', async () => {
    const world = await bothEntriesPicked(ContestStatus.OPEN);

    const room = await world.service.getDraftState({
      contestId: CONTEST_ID,
      selectedEntryId: ENTRY_B,
      actorUserId: ALICE,
    });

    expect(room.selectedEntryId).toBe(ENTRY_A);
    expect(room.tiebreakerValue).toBe(-8);
    const selected = room.selectionGroups.flatMap((group) =>
      group.participants.filter((participant) => participant.isSelected).map((p) => p.participantId));
    expect(selected).toEqual(['p-a']);
  });

  it('shows every entry\'s picks, and another team\'s entry on request, once the contest has locked', async () => {
    const world = await bothEntriesPicked(ContestStatus.LOCKED);

    const room = await world.service.getDraftState({
      contestId: CONTEST_ID,
      selectedEntryId: ENTRY_B,
      actorUserId: ALICE,
    });

    expect(room.picks.map((pick) => pick.entryId).sort()).toEqual([ENTRY_A, ENTRY_B, ENTRY_B]);
    expect(room.selectedEntryId).toBe(ENTRY_B);
    expect(room.tiebreakerValue).toBe(-12);
  });

  it('answers 404 for a DRAFT contest\'s room to a member who is not a commissioner', async () => {
    const world = buildWorld({ status: ContestStatus.DRAFT });

    await expect(world.service.getDraftState({ contestId: CONTEST_ID, actorUserId: BOB })).rejects.toMatchObject({
      code: 'CONTEST_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('shows a DRAFT contest\'s room to the league\'s commissioner and to a root admin', async () => {
    const world = buildWorld({
      status: ContestStatus.DRAFT,
      leagueMemberships: [leagueMembership(ALICE, 'COMMISSIONER'), leagueMembership(BOB, 'MEMBER')],
    });

    const commissionerRoom = await world.service.getDraftState({ contestId: CONTEST_ID, actorUserId: ALICE });
    expect(commissionerRoom.contest.id).toBe(CONTEST_ID);
    expect(commissionerRoom.isCommissioner).toBe(true);

    const rootAdminRead = {
      contestId: CONTEST_ID,
      actorUserId: 'user-root',
      actorIsRootAdmin: true,
    };
    const adminRoom = await world.service.getDraftState(rootAdminRead);
    expect(adminRoom.contest.id).toBe(CONTEST_ID);
  });
});

describe('Draft room response — the published shape', () => {
  it('maps a room with picks into the draft-state response, with each tier\'s selected golfers and the history', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'd');

    const room = await world.service.getDraftState({ contestId: CONTEST_ID, actorUserId: ALICE });
    const response = toDraftStateResponse(room);

    expect(response.selectedEntryId).toBe(ENTRY_A);
    expect(response.selectionGroups?.map((group) => [group.groupId, group.selectedParticipantIds])).toEqual([
      ['tier-1', ['sep-a']],
      ['tier-2', ['sep-d']],
    ]);
    expect(response.draftPickHistories?.map((pick) => pick.participantName)).toEqual(['Golfer A', 'Golfer D']);
    expect(response.contestConfiguration?.rosterSize).toBe(3);
  });
});
