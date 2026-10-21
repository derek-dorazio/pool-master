import { SelectionStatus, SelectionType, Sport, isPredictionSelectionType, isRosterSelectionType } from '@poolmaster/shared/domain';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  Participant,
  SportEventParticipant,
  SquadMembership,
} from '@poolmaster/shared/domain';
import {
  buildSelectionTiers,
  buildEntryUserIdMap,
  buildSelectionParticipants,
  buildTierByParticipantId,
  buildValuationLookup,
  findTierByLabel,
  isCommissionerRole,
  mapContestStatusToSelectionStatus,
} from '../../../packages/core-api/src/modules/selections/selection-rules';
import { getSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/registry';
import { SelectionOutcomeKind, SelectionRejectCode } from '../../../packages/core-api/src/modules/selections/selection-engines/selection-engine';
import { tieredSelectionEngine } from '../../../packages/core-api/src/modules/selections/selection-engines/tiered';
import type {
  SelectionTierConfig,
  ParticipantValuation,
} from '../../../packages/core-api/src/modules/selections/types';
import type {
  ParticipantValuationView,
  SportEventTierGroup,
} from '../../../packages/core-api/src/modules/events/sport-event-tier-service';

// #324 — the selection room's rules as functions, called directly.
//
// Until this extraction every one of these was module-private inside `selections/routes.ts`, so
// the only way to exercise a draft rule was to send an HTTP request. That is also the half of
// the `engine/` classes #323 deleted that was worth keeping: the arithmetic. It is kept here
// as functions rather than as stateful classes, and each one is covered on both of its paths.

function tier(overrides: Partial<SelectionTierConfig> = {}): SelectionTierConfig {
  return {
    tierId: 'tier-1',
    tierName: 'Tier 1',
    tierNumber: 1,
    picksFromTier: 2,
    participantIds: [],
    ...overrides,
  };
}

function configuration(overrides: Partial<ContestConfiguration> = {}): ContestConfiguration {
  return {
    id: 'config-1',
    contestId: 'contest-1',
    selectionType: SelectionType.TIERED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as ContestConfiguration;
}

function entry(id: string, squadId: string): ContestEntry {
  return {
    id,
    contestId: 'contest-1',
    squadId,
    entryNumber: 1,
    name: `Entry ${id}`,
    events: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function squadMembership(squadId: string, userId: string, joinedAt: string): SquadMembership {
  return {
    id: `${squadId}-${userId}`,
    squadId,
    leagueId: 'league-1',
    userId,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: new Date(joinedAt),
    createdAt: new Date(joinedAt),
    updatedAt: new Date(joinedAt),
  } as SquadMembership;
}

function fieldRow(overrides: Partial<SportEventParticipant> & { id: string }): SportEventParticipant {
  return {
    sportEventId: 'event-1',
    participantId: 'participant-1',
    isActive: true,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as SportEventParticipant;
}

function participant(id: string, overrides: Partial<Participant> = {}): Participant {
  return {
    id,
    sportId: 'sport-1',
    name: `Golfer ${id}`,
    participantType: 'INDIVIDUAL',
    status: 'ACTIVE',
    injuryStatus: { status: 'HEALTHY' },
    externalIds: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Participant;
}

describe('#324 draft rules — role predicate', () => {
  it('treats only the COMMISSIONER role as commissioner, including for an absent role', () => {
    expect(isCommissionerRole('COMMISSIONER')).toBe(true);
    expect(isCommissionerRole('MEMBER')).toBe(false);
    expect(isCommissionerRole(undefined)).toBe(false);
  });
});

describe('#324 draft rules — mapContestStatusToSelectionStatus', () => {
  it('is COMPLETE when every roster is full, whatever the contest status says', () => {
    expect(mapContestStatusToSelectionStatus('OPEN', true)).toBe(SelectionStatus.COMPLETE);
    expect(mapContestStatusToSelectionStatus('DRAFT', true)).toBe(SelectionStatus.COMPLETE);
  });

  it('is COMPLETE for a COMPLETED contest even while a roster is still short', () => {
    expect(mapContestStatusToSelectionStatus('COMPLETED', false)).toBe(SelectionStatus.COMPLETE);
  });

  it('is LIVE while the contest is open or active', () => {
    expect(mapContestStatusToSelectionStatus('OPEN', false)).toBe(SelectionStatus.LIVE);
    expect(mapContestStatusToSelectionStatus('ACTIVE', false)).toBe(SelectionStatus.LIVE);
  });

  it('is PENDING for a DRAFT contest', () => {
    expect(mapContestStatusToSelectionStatus('DRAFT', false)).toBe(SelectionStatus.PENDING);
  });
});

describe('#324 draft rules — buildEntryUserIdMap', () => {
  it('attributes each entry to its squad\'s first member in join order', () => {
    const map = buildEntryUserIdMap(
      [entry('entry-1', 'squad-1'), entry('entry-2', 'squad-2')],
      [
        squadMembership('squad-1', 'user-first', '2026-01-01T00:00:00.000Z'),
        squadMembership('squad-1', 'user-second', '2026-02-01T00:00:00.000Z'),
        squadMembership('squad-2', 'user-third', '2026-01-15T00:00:00.000Z'),
      ],
    );

    expect(map.get('entry-1')).toBe('user-first');
    expect(map.get('entry-2')).toBe('user-third');
  });

  it('maps an entry whose squad has no membership to the empty string rather than leaving it out', () => {
    const map = buildEntryUserIdMap([entry('entry-1', 'squad-orphan')], []);

    expect(map.has('entry-1')).toBe(true);
    expect(map.get('entry-1')).toBe('');
  });
});

describe('#324 draft rules — buildSelectionTiers and buildValuationLookup', () => {
  it('turns resolved event tier groups into the room\'s tier shape, each tier taking the contest\'s picksPerTier', () => {
    const groups = [
      {
        id: 'tier-row-1',
        sportEventId: 'event-1',
        tierKey: 'tier-1',
        label: 'Tier 1',
        tierNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        participants: [
          { sportEventParticipantId: 'sep-1', participantId: 'participant-1', tierOrderIndex: 1, price: 10 },
          { sportEventParticipantId: 'sep-2', participantId: 'participant-2', tierOrderIndex: 2, price: null },
        ],
      },
    ] as unknown as SportEventTierGroup[];

    expect(buildSelectionTiers(groups, 2)).toEqual([
      {
        tierId: 'tier-1',
        tierName: 'Tier 1',
        tierNumber: 1,
        picksFromTier: 2,
        participantIds: ['participant-1', 'participant-2'],
      },
    ]);
  });

  it('builds no tiers from an event that has none', () => {
    expect(buildSelectionTiers([], 2)).toEqual([]);
  });

  it('gives every tier the contest\'s picksPerTier, so a 3-tier event at 2 picks per tier has a roster of 6', () => {
    const groups = [1, 2, 3].map((tierNumber) => ({
      id: `tier-row-${tierNumber}`,
      sportEventId: 'event-1',
      tierKey: `tier-${tierNumber}`,
      label: `Tier ${tierNumber}`,
      tierNumber,
      createdAt: new Date(),
      updatedAt: new Date(),
      participants: [],
    })) as unknown as SportEventTierGroup[];

    const tiers = buildSelectionTiers(groups, 2);

    expect(tiers.map((draftTier) => draftTier.picksFromTier)).toEqual([2, 2, 2]);
    expect(tieredSelectionEngine.rosterSize({ configuration: configuration(), tiers })).toBe(6);
  });

  it('offers only the first tiersUsed tiers in tier order, so seeds-only rules on six tiers make a roster of four', () => {
    const groups = [6, 5, 4, 3, 2, 1].map((tierNumber) => ({ tierKey: `tier-${tierNumber}`, label: `Tier ${tierNumber}`, tierNumber, participants: [] })) as unknown as SportEventTierGroup[];

    const tiers = buildSelectionTiers(groups, 1, 4);

    expect(tiers.map((tier) => tier.tierNumber)).toEqual([1, 2, 3, 4]);
    expect(tieredSelectionEngine.rosterSize({ configuration: configuration(), tiers })).toBe(4);
  });

  it('refuses a tier-5 player under seeds-only rules with TIER_NOT_FOUND, since tiersUsed 4 leaves tiers 5 and 6 out of play', () => {
    const groups = [1, 2, 3, 4, 5, 6].map((tierNumber) => ({ tierKey: `tier-${tierNumber}`, label: `Tier ${tierNumber}`, tierNumber, participants: [] })) as unknown as SportEventTierGroup[];
    const tiers = buildSelectionTiers(groups, 1, 4);
    const participant = { sportEventParticipantId: 'sep-p5', participantId: 'p5', participantName: 'Player 5', tier: 'Tier 5', seedNumber: null, isAvailable: true };

    expect(tieredSelectionEngine.evaluate({ participant, heldPick: null, existingPicks: [], tiers, rosterSize: 4 }))
      .toEqual({ kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.TIER_NOT_FOUND, tierLabel: 'Tier 5' });
  });

  it('offers every tier when tiersUsed is more than the event has', () => {
    const groups = [1, 2].map((tierNumber) => ({ tierKey: `tier-${tierNumber}`, label: `Tier ${tierNumber}`, tierNumber, participants: [] })) as unknown as SportEventTierGroup[];

    expect(buildSelectionTiers(groups, 1, 4).map((tier) => tier.tierNumber)).toEqual([1, 2]);
  });

  it('gives every tier no picks when the contest supplies 0 picks per tier, so the tiered roster is 0', () => {
    const groups = [
      { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1, participants: [] },
    ] as unknown as SportEventTierGroup[];

    const tiers = buildSelectionTiers(groups, 0);

    expect(tiers[0].picksFromTier).toBe(0);
    expect(tieredSelectionEngine.rosterSize({ configuration: configuration(), tiers })).toBe(0);
  });

  // pool-master-753 — carried over from the deleted loadDraftContext suite. A price-only
  // valuation belongs to no tier, so it is invisible to any lookup assembled by walking tier
  // groups; the lookup must come from the effective valuations instead.
  it('pool-master-753 keeps a price-only valuation, with no tier, in the lookup', () => {
    const valuations: ParticipantValuationView[] = [
      {
        sportEventParticipantId: 'sep-1',
        participantId: 'participant-1',
        tierId: null,
        tierKey: null,
        tierLabel: null,
        tierNumber: null,
        tierOrderIndex: null,
        price: 3200,
      },
      {
        sportEventParticipantId: 'sep-2',
        participantId: 'participant-2',
        tierId: 'tier-row-1',
        tierKey: 'tier-1',
        tierLabel: 'Tier 1',
        tierNumber: 1,
        tierOrderIndex: 1,
        price: 25,
      },
    ];

    const lookup = buildValuationLookup(valuations);

    expect(lookup.get('sep-1')).toEqual<ParticipantValuation>({
      tierLabel: null,
      tierOrderIndex: null,
      price: 3200,
    });
    expect(lookup.get('sep-2')).toEqual<ParticipantValuation>({
      tierLabel: 'Tier 1',
      tierOrderIndex: 1,
      price: 25,
    });
  });
});

describe('#324 draft rules — buildSelectionParticipants', () => {
  // pool-master-uvc — carried over from the deleted loadDraftContext suite: this call site
  // delegates to the shared deriveLegacyParticipantStatus rather than keeping a second copy
  // of the same ternary.
  it('pool-master-uvc keeps an inactive field row selectable-with-a-reason rather than dropping it', () => {
    const participants = buildSelectionParticipants({
      field: [
        fieldRow({ id: 'sep-1', participantId: 'participant-1', isActive: false, inactiveReason: 'ELIMINATED' }),
      ],
      participantsById: new Map([['participant-1', participant('participant-1', { name: 'Eliminated Golfer' })]]),
      valuationBySportEventParticipantId: new Map(),
      sport: Sport.GOLF,
    });

    expect(participants).toEqual([
      expect.objectContaining({
        sportEventParticipantId: 'sep-1',
        participantName: 'Eliminated Golfer',
        status: 'ELIMINATED',
        isAvailable: false,
      }),
    ]);
  });

  // pool-master-piv — the other half of the carried-over coverage: tier, price and order
  // index come from the resolved valuations, not from a legacy column.
  it('pool-master-piv resolves tier, price and order index for an active row, and leaves them empty without a valuation', () => {
    const participants = buildSelectionParticipants({
      field: [
        fieldRow({ id: 'sep-1', participantId: 'participant-1', ranking: 5 }),
        fieldRow({ id: 'sep-2', participantId: 'participant-2' }),
      ],
      participantsById: new Map([
        ['participant-1', participant('participant-1', { name: 'Rory McIlroy' })],
        ['participant-2', participant('participant-2', { name: 'Unvalued Golfer' })],
      ]),
      valuationBySportEventParticipantId: new Map([
        ['sep-1', { tierLabel: 'Tier 1', tierOrderIndex: 1, price: 25 }],
      ]),
      sport: Sport.GOLF,
    });

    expect(participants[0]).toEqual(
      expect.objectContaining({
        sportEventParticipantId: 'sep-1',
        status: 'ACTIVE',
        isAvailable: true,
        ranking: 5,
        tier: 'Tier 1',
        price: 25,
        orderIndex: 1,
      }),
    );
    expect(participants[1]).toEqual(
      expect.objectContaining({
        sportEventParticipantId: 'sep-2',
        tier: null,
        price: undefined,
        orderIndex: undefined,
        ranking: undefined,
      }),
    );
  });

  it('carries each field row\'s bracket seed into a basketball room, and null for a row the event left unseeded', () => {
    const participants = buildSelectionParticipants({
      field: [
        fieldRow({ id: 'sep-1', participantId: 'participant-1', seedNumber: 1 }),
        fieldRow({ id: 'sep-2', participantId: 'participant-2' }),
      ],
      participantsById: new Map([
        ['participant-1', participant('participant-1', { name: 'Duke' })],
        ['participant-2', participant('participant-2', { name: 'Vermont' })],
      ]),
      valuationBySportEventParticipantId: new Map(),
      sport: Sport.BASKETBALL,
    });

    expect(participants.map((row) => [row.participantName, row.seedNumber])).toEqual([['Duke', 1], ['Vermont', null]]);
  });

  it('sends no seed into a golf room, though the golf field row carries its tour-ranking seed number', () => {
    const participants = buildSelectionParticipants({
      field: [fieldRow({ id: 'sep-1', participantId: 'participant-1', seedNumber: 1 })],
      participantsById: new Map([['participant-1', participant('participant-1', { name: 'Scottie Scheffler' })]]),
      valuationBySportEventParticipantId: new Map(),
      sport: Sport.GOLF,
    });

    expect(participants[0]?.seedNumber).toBeNull();
  });

  it('orders by tier position first, then name, then field-row id so the list is stable', () => {
    const participants = buildSelectionParticipants({
      field: [
        fieldRow({ id: 'sep-unvalued-b', participantId: 'p-ub' }),
        fieldRow({ id: 'sep-tier-2', participantId: 'p-t2' }),
        fieldRow({ id: 'sep-unvalued-a', participantId: 'p-ua' }),
        fieldRow({ id: 'sep-tier-1', participantId: 'p-t1' }),
      ],
      participantsById: new Map([
        ['p-ub', participant('p-ub', { name: 'Zed Unvalued' })],
        ['p-t2', participant('p-t2', { name: 'Second Placed' })],
        ['p-ua', participant('p-ua', { name: 'Abe Unvalued' })],
        ['p-t1', participant('p-t1', { name: 'First Placed' })],
      ]),
      valuationBySportEventParticipantId: new Map([
        ['sep-tier-1', { tierLabel: 'Tier 1', tierOrderIndex: 1, price: null }],
        ['sep-tier-2', { tierLabel: 'Tier 1', tierOrderIndex: 2, price: null }],
      ]),
      sport: Sport.GOLF,
    });

    expect(participants.map((p) => p.sportEventParticipantId)).toEqual([
      'sep-tier-1',
      'sep-tier-2',
      'sep-unvalued-a',
      'sep-unvalued-b',
    ]);
  });
});

describe('#324 draft rules — tier lookups', () => {
  const TIERS = [
    tier({ tierId: 'tier-1', tierName: 'Tier 1', participantIds: ['a', 'b'] }),
    tier({ tierId: 'tier-2', tierName: 'Tier 2', tierNumber: 2, participantIds: ['c'] }),
  ];

  it('finds a tier by its id or by its display name, and nothing for an unknown label', () => {
    expect(findTierByLabel(TIERS, 'tier-2')?.tierId).toBe('tier-2');
    expect(findTierByLabel(TIERS, 'Tier 2')?.tierId).toBe('tier-2');
    expect(findTierByLabel(TIERS, 'Tier 9')).toBeUndefined();
  });

  it('indexes every tier participant, and omits one in no tier', () => {
    const index = buildTierByParticipantId(TIERS);

    expect(index.get('a')?.tierId).toBe('tier-1');
    expect(index.get('c')?.tierId).toBe('tier-2');
    expect(index.has('unplaced')).toBe(false);
  });
});

// A compile-time anchor rather than a behavioural one: the two reads the room makes of a
// contest are typed off the domain Contest. A contest's selection type reaches the roster engine
// registry only once it is narrowed to a roster type (#716), so a selection type added to the
// enum fails the typecheck until it is placed in a contest format and given an engine.
describe('#324 draft rules — contest shape', () => {
  it('narrows a roster contest\'s selection type to its roster engine, and reads OPEN as LIVE', () => {
    const contest = { selectionType: SelectionType.TIERED, status: 'OPEN' } as Contest;
    const { selectionType } = contest;
    if (!isRosterSelectionType(selectionType)) {
      throw new Error('a TIERED contest must be a roster contest');
    }

    expect(getSelectionEngine(selectionType).selectionType).toBe(SelectionType.TIERED);
    expect(mapContestStatusToSelectionStatus(contest.status, false)).toBe(SelectionStatus.LIVE);
  });

  it('classes PICK_EM as a prediction type, which the roster engine registry never serves', () => {
    expect(isPredictionSelectionType(SelectionType.PICK_EM)).toBe(true);
    expect(isPredictionSelectionType(SelectionType.TIERED)).toBe(false);
    expect(isPredictionSelectionType(SelectionType.BUDGET_PICK)).toBe(false);
    expect(isPredictionSelectionType(SelectionType.RANDOM_DRAW)).toBe(false);
  });
});
