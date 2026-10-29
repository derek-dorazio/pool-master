import { ContestEntryStatus, ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  LeagueMembership,
  Participant,
  SportEvent,
  SportEventParticipant,
  SquadMembership,
} from '@poolmaster/shared/domain';
import type { ContestEntryPickWithParticipant } from '@poolmaster/shared/db';
import { SelectionService } from '../../../packages/core-api/src/modules/selections/service';
import type { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import type { ContestEntryPickService, EntryEventSettleInput, EntryPickChangeInput } from '../../../packages/core-api/src/modules/contest-entry-picks';
import { toSelectionPickResponse, toSelectionStateResponse } from '../../../packages/core-api/src/mappers/selections.mapper';
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

// Selection use cases, played through SelectionService against a small stateful world.
//
// selection-service.test.ts pins each guard and outcome one submission at a time over canned
// reads. These tests walk a member through a sequence — fill a roster, swap within a full
// tier, unselect, share a golfer across entries — with picks that the writes really add and
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

// Two tiers, tier 1 (a, b, c) and tier 2 (d, e, f). The contest takes two golfers from each
// (#479: every tier takes the contest's picksPerTier), so the roster size is 4.
const PICKS_PER_TIER = 2;
const TIERS = [
  { key: 'tier-1', label: 'Tier 1', number: 1, golfers: ['a', 'b', 'c'] },
  { key: 'tier-2', label: 'Tier 2', number: 2, golfers: ['d', 'e', 'f'] },
];

interface WorldOptions {
  status?: Contest['status'];
  /** Field rows to mark withdrawn, by golfer letter. */
  withdrawn?: string[];
  squadMemberships?: SquadMembership[];
  leagueMemberships?: LeagueMembership[];
  /** The event's scheduled start; the clock reads NOW. Defaults to a day after NOW. */
  eventStartDate?: Date;
}

const NOW = new Date('2026-04-09T12:00:00.000Z');

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
    events: [{ sportEventId: EVENT_ID, status: 'DRAFT' }],
    tiebreakerValue,
    ...TIMESTAMPS,
  };
}

function buildWorld(options: WorldOptions = {}) {
  const contest = {
    id: CONTEST_ID,
    leagueId: LEAGUE_ID,
    sportEventIds: [EVENT_ID],
    name: 'Masters Pool',
    status: options.status ?? ContestStatus.OPEN,
    contestFormat: 'ROSTER',
    selectionType: SelectionType.TIERED,
    ...TIMESTAMPS,
  } as Contest;
  const configuration = {
    id: 'config-1',
    contestId: CONTEST_ID,
    selectionType: SelectionType.TIERED,
    configJson: { selectionType: SelectionType.TIERED, picksPerTier: PICKS_PER_TIER, countedScores: 3 },
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

  const sportEvent = {
    id: EVENT_ID,
    sport: 'GOLF',
    status: 'SCHEDULED',
    startDate: options.eventStartDate ?? new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
  } as unknown as SportEvent;
  // Each entry's status per event, as the locked writes leave it.
  const statuses = new Map<string, ContestEntryStatus>();
  const lockedPicks = (entryId: string, sportEventId: string) => picks
    .filter((pick) => pick.entryId === entryId && pick.sportEventId === sportEventId)
    .map((pick) => ({
      id: pick.id,
      sportEventParticipantId: pick.sportEventParticipantId,
      participantId: pick.participant.participantId,
      lineupSlot: pick.lineupSlot ?? null,
    }));
  const settleStatus = (
    entryId: string,
    sportEventId: string,
    at: Date,
    picksChanged: boolean,
    settle: (status: ContestEntryStatus) => ContestEntryStatus | null,
  ) => {
    const key = `${entryId}:${sportEventId}`;
    const status = statuses.get(key)
      ?? entries.find((row) => row.id === entryId)?.events.find((event) => event.sportEventId === sportEventId)?.status
      ?? ContestEntryStatus.DRAFT;
    const next = settle(status);
    if (next === null || next === status) return { picksChanged, status, submittedAt: null, statusChanged: false };
    statuses.set(key, next);
    return { picksChanged, status: next, submittedAt: next === ContestEntryStatus.SUBMITTED ? at : null, statusChanged: true };
  };
  const deps = {
    sportEvents: { findByIds: async (ids: readonly string[]) => (ids.includes(EVENT_ID) ? [sportEvent] : []) },
    now: () => NOW,
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
      findByEntriesWithParticipant: async (entryIds: readonly string[], options?: { sportEventId?: string }) =>
        picks.filter((pick) => entryIds.includes(pick.entryId)
          && (options?.sportEventId === undefined || pick.sportEventId === options.sportEventId)),
    }),
    pickWrites: {
      // Decides on the entry's picks in the event, then applies the write, as the lock-holding service does.
      changeEntryPick: async ({ entryId, sportEventId, at, decide, settle }: EntryPickChangeInput) => {
        const write = decide(lockedPicks(entryId, sportEventId));
        if (write?.removePickId) {
          const index = picks.findIndex((pick) => pick.id === write.removePickId);
          if (index >= 0) picks.splice(index, 1);
        }
        if (write?.add) {
          const row = fieldRowById.get(write.add.sportEventParticipantId) as SportEventParticipant;
          const participant = participantById.get(row.participantId) as Participant;
          clock += 1000;
          picks.push({
            id: `pick-${nextId++}`,
            entryId,
            sportEventId: row.sportEventId,
            sportEventParticipantId: write.add.sportEventParticipantId,
            contestFormat: 'ROSTER_SELECTION',
            lineupSlot: write.add.lineupSlot,
            pickSequence: picks.length + 1,
            isAutoPicked: false,
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
          } as unknown as ContestEntryPickWithParticipant);
        }
        return settleStatus(entryId, sportEventId, at, write !== null, (status) =>
          settle({ picks: lockedPicks(entryId, sportEventId), status, picksChanged: write !== null }));
      },
      settleEntryEvent: async ({ entryId, sportEventId, at, settle }: EntryEventSettleInput) =>
        settleStatus(entryId, sportEventId, at, false, (status) => settle({ picks: lockedPicks(entryId, sportEventId), status })),
    } as unknown as ContestEntryPickService,
    tiers: {
      getEffectiveTiersAndValuations: async () => ({ tiers: tierGroups, valuations }),
    } as unknown as SportEventTierService,
  };
  const service = new SelectionService(deps);

  return {
    service,
    contest,
    sportEvent,
    picks,
    /** Golfer letters currently held by an entry, in pick order. */
    held: (entryId: string) =>
      picks.filter((pick) => pick.entryId === entryId).map((pick) => pick.sportEventParticipantId.replace('sep-', '')),
    pickFor: (entryId: string, golfer: string, actorUserId = entryId === ENTRY_A ? ALICE : BOB) =>
      service.selectPick({
        contestId: CONTEST_ID,
        entryId,
        sportEventParticipantId: `sep-${golfer}`,
        actorUserId,
      }),
    unpickFor: (entryId: string, golfer: string, actorUserId = entryId === ENTRY_A ? ALICE : BOB) =>
      service.unselectPick({
        contestId: CONTEST_ID,
        entryId,
        sportEventParticipantId: `sep-${golfer}`,
        actorUserId,
      }),
  };
}

describe('Tiered selection — a member building an entry', () => {
  it('fills a roster tier by tier, and the room shows each tier\'s held golfers selected', async () => {
    const world = buildWorld();

    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    await world.pickFor(ENTRY_A, 'd');
    const result = await world.pickFor(ENTRY_A, 'e');

    expect(world.held(ENTRY_A)).toEqual(['a', 'b', 'd', 'e']);
    expect(result.picks.map((pick) => pick.sportEventParticipantId)).toEqual(['sep-a', 'sep-b', 'sep-d', 'sep-e']);
    const room = await world.service.getSelectionState({ contestId: CONTEST_ID, actorUserId: ALICE });
    expect(room.rosterSize).toBe(4);
    expect(room.selectionGroups.map((group) =>
      group.participants.filter((participant) => participant.isSelected).map((p) => p.participantId),
    )).toEqual([['p-a', 'p-b'], ['p-d', 'p-e']]);
  });

  it('stores each pick in the round its tier position gives it, whatever order the tiers are filled in', async () => {
    const world = buildWorld();

    await world.pickFor(ENTRY_A, 'd');
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');

    expect(world.picks.map((pick) => [pick.sportEventParticipantId, pick.lineupSlot])).toEqual([
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

    expect(world.held(ENTRY_A)).toEqual(['a', 'd', 'c']);
    expect(swapped.picks.map((pick) => pick.sportEventParticipantId)).toEqual(['sep-a', 'sep-d', 'sep-c']);
    expect(world.picks.find((pick) => pick.sportEventParticipantId === 'sep-c')?.lineupSlot).toBe(2);
  });

  it('swaps the newest pick in the last tier on a full roster rather than refusing the entry as complete', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    await world.pickFor(ENTRY_A, 'd');
    await world.pickFor(ENTRY_A, 'e');

    await world.pickFor(ENTRY_A, 'f');

    expect(world.held(ENTRY_A)).toEqual(['a', 'b', 'd', 'f']);
  });

  it('keeps a held golfer when they are picked again, so a repeated request undoes nothing', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');

    const again = await world.pickFor(ENTRY_A, 'a');

    expect(world.held(ENTRY_A)).toEqual(['a']);
    expect(again.picks.map((pick) => pick.sportEventParticipantId)).toEqual(['sep-a']);
  });

  it('unselects a held golfer, says the entry holds nothing, and lets the same golfer be picked back', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');

    const off = await world.unpickFor(ENTRY_A, 'a');
    expect(off.picks).toEqual([]);
    expect(world.held(ENTRY_A)).toEqual([]);
    await world.unpickFor(ENTRY_A, 'a');
    expect(world.held(ENTRY_A)).toEqual([]);

    await world.pickFor(ENTRY_A, 'a');
    expect(world.held(ENTRY_A)).toEqual(['a']);
  });

  it('lets two entries hold the same golfer', async () => {
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
    expect(result.entryId).toBe(ENTRY_A);
    const room = await world.service.getSelectionState({ contestId: CONTEST_ID, actorUserId: ALICE_CO_OWNER });
    expect(room.myEntryId).toBe(ENTRY_A);
  });

  it('refuses a pick from someone who has left the entry\'s team, leaving the entry unchanged', async () => {
    const world = buildWorld({
      squadMemberships: [
        squadMembership(SQUAD_A, ALICE, { status: 'INACTIVE' } as Partial<SquadMembership>),
        squadMembership(SQUAD_B, BOB),
      ],
    });

    await expect(world.pickFor(ENTRY_A, 'a', ALICE)).rejects.toMatchObject({
      code: 'ENTRY_ACCESS_DENIED',
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

    const result = await later.unpickFor(ENTRY_A, 'b');

    expect(result.picks.map((pick) => pick.sportEventParticipantId)).toEqual(['sep-a']);
    expect(later.held(ENTRY_A)).toEqual(['a']);
  });
});

describe('Tiered selection — picks change only while the contest takes them', () => {
  const closedStatuses = [
    ContestStatus.DRAFT,
    ContestStatus.COMPLETED,
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

    await expect(world.unpickFor(ENTRY_A, 'a')).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    await expect(world.pickFor(ENTRY_A, 'c')).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    expect(world.held(ENTRY_A)).toEqual(['a', 'b']);
  });
});

describe('Tiered selection — an ACTIVE contest still takes picks for an event that has not started (#713)', () => {
  it('accepts and swaps picks on an ACTIVE contest while its event is still to start', async () => {
    const world = buildWorld({ status: ContestStatus.ACTIVE });

    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'b');
    await world.unpickFor(ENTRY_A, 'a');

    expect(world.held(ENTRY_A)).toEqual(['b']);
  });

  it('refuses a pick on an ACTIVE contest with 409 CONTEST_ENTRY_LOCKED once its event has started', async () => {
    const world = buildWorld({ status: ContestStatus.ACTIVE, eventStartDate: new Date(NOW.getTime() - 60 * 1000) });

    await expect(world.pickFor(ENTRY_A, 'a')).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED', statusCode: 409 });
    expect(world.held(ENTRY_A)).toEqual([]);
  });
});

describe('Tiered selection — picks close when the event starts, whatever the contest status says', () => {
  const started = new Date(NOW.getTime() - 60 * 1000);

  it('accepts a pick before the event\'s scheduled start', async () => {
    const world = buildWorld({ eventStartDate: new Date(NOW.getTime() + 60 * 1000) });

    await world.pickFor(ENTRY_A, 'a');

    expect(world.held(ENTRY_A)).toEqual(['a']);
  });

  it('refuses a new pick with 409 CONTEST_ENTRY_LOCKED once the start time has passed, though the contest is still OPEN', async () => {
    const world = buildWorld({ eventStartDate: started });

    await expect(world.pickFor(ENTRY_A, 'a')).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
      statusCode: 409,
    });
    expect(world.held(ENTRY_A)).toEqual([]);
  });

  it('refuses to unselect a held golfer once the start time has passed', async () => {
    const world = buildWorld({ eventStartDate: started });
    world.picks.push(...(await (async () => {
      const before = buildWorld();
      await before.pickFor(ENTRY_A, 'a');
      return before.picks;
    })()));

    await expect(world.unpickFor(ENTRY_A, 'a')).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    expect(world.held(ENTRY_A)).toEqual(['a']);
  });
});

describe('Selection room — what a member may see', () => {
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

    const room = await world.service.getSelectionState({ contestId: CONTEST_ID, actorUserId: ALICE });

    expect(room.picks.map((pick) => pick.entryId)).toEqual([ENTRY_A]);
  });

  it('keeps another team\'s picks hidden on an ACTIVE contest whose event has not started yet (#713)', async () => {
    const world = await bothEntriesPicked(ContestStatus.ACTIVE);

    const room = await world.service.getSelectionState({ contestId: CONTEST_ID, selectedEntryId: ENTRY_B, actorUserId: ALICE });

    expect(room.picks.map((pick) => pick.entryId)).toEqual([ENTRY_A]);
    expect(room.selectedEntryId).toBe(ENTRY_A);
  });

  it('does not show a member another team\'s selections or tiebreaker while the contest is open, falling back to their own entry', async () => {
    const world = await bothEntriesPicked(ContestStatus.OPEN);

    const room = await world.service.getSelectionState({
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

  it('shows every entry\'s picks, and another team\'s entry on request, once the contest is live and its event has started', async () => {
    const world = await bothEntriesPicked(ContestStatus.ACTIVE);
    world.sportEvent.startDate = new Date(NOW.getTime() - 60 * 1000);

    const room = await world.service.getSelectionState({
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

    await expect(world.service.getSelectionState({ contestId: CONTEST_ID, actorUserId: BOB })).rejects.toMatchObject({
      code: 'CONTEST_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('shows a DRAFT contest\'s room to the league\'s commissioner and to a root admin', async () => {
    const world = buildWorld({
      status: ContestStatus.DRAFT,
      leagueMemberships: [leagueMembership(ALICE, 'COMMISSIONER'), leagueMembership(BOB, 'MEMBER')],
    });

    const commissionerRoom = await world.service.getSelectionState({ contestId: CONTEST_ID, actorUserId: ALICE });
    expect(commissionerRoom.contest.id).toBe(CONTEST_ID);
    expect(commissionerRoom.isCommissioner).toBe(true);

    const rootAdminRead = {
      contestId: CONTEST_ID,
      actorUserId: 'user-root',
      actorIsRootAdmin: true,
    };
    const adminRoom = await world.service.getSelectionState(rootAdminRead);
    expect(adminRoom.contest.id).toBe(CONTEST_ID);
  });
});

describe('Selection room response — the published shape', () => {
  it('maps a room with picks into the selection-state response, with each tier\'s selected golfers and the history', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_A, 'a');
    await world.pickFor(ENTRY_A, 'd');

    const room = await world.service.getSelectionState({ contestId: CONTEST_ID, actorUserId: ALICE });
    const response = toSelectionStateResponse(room);

    expect(response.selectedEntryId).toBe(ENTRY_A);
    expect(response.selectionGroups?.map((group) => [group.groupId, group.selectedParticipantIds])).toEqual([
      ['tier-1', ['sep-a']],
      ['tier-2', ['sep-d']],
    ]);
    expect(response.pickHistories.map((pick) => pick.participantName)).toEqual(['Golfer A', 'Golfer D']);
    expect(response.rosterSize).toBe(4);
  });

  it('maps a pick change into the pick response: the entry\'s own picks by field row id, its status, and no room', async () => {
    const world = buildWorld();
    await world.pickFor(ENTRY_B, 'c');
    await world.pickFor(ENTRY_A, 'a');

    const response = toSelectionPickResponse(await world.pickFor(ENTRY_A, 'd'));

    expect(response).toEqual({
      contestId: CONTEST_ID,
      entryId: ENTRY_A,
      sportEventId: world.sportEvent.id,
      entryStatus: 'DRAFT',
      picks: [
        expect.objectContaining({ entryId: ENTRY_A, participantId: 'sep-a', participantName: 'Golfer A', tierId: 'tier-1' }),
        expect.objectContaining({ entryId: ENTRY_A, participantId: 'sep-d', participantName: 'Golfer D', tierId: 'tier-2' }),
      ],
      lineupSummary: null,
    });
  });
});
