import { FieldOrderBasis, Sport, SportEventStatus, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import { SportEventTierService } from '../../../packages/core-api/src/modules/events/sport-event-tier-service';
import { IN_MEMORY_PLATFORM_TIER_PROFILE_ID, InMemorySportEvents } from '../../support/in-memory-sport-events';
import { inMemoryStandardPricing } from '../../support/budget-pricing';

// Tier and valuation rules against an in-memory store: defaults, the fill order of
// auto-assignment, the orphan guard on replacement, the drag-and-drop save's checks,
// and pricing. The replacement's transactional mechanics are the adapter's, tested in
// sport-event-repositories.integration.

const TWO_TIERS = [
  { tierKey: 'tier-1', tierNumber: 1 },
  { tierKey: 'tier-2', tierNumber: 2 },
];

function tierDefinitions(count: number) {
  return Array.from({ length: count }, (_, index) => ({ tierKey: `tier-${index + 1}`, tierNumber: index + 1 }));
}

/** `count` active participants, p-01 the shortest odds. */
function addFieldByOdds(store: InMemorySportEvents, sportEventId: string, count: number) {
  for (let index = 1; index <= count; index++) {
    store.addToField(sportEventId, `p-${String(index).padStart(2, '0')}`, { oddsToWin: index });
  }
}

function setup(status: SportEventStatus = SportEventStatus.DRAFT) {
  const store = new InMemorySportEvents();
  // Tiers and prices are set while the event is a draft; release locks them (#431).
  const event = store.addSlottedEvent({ status });
  const service = new SportEventTierService({
    sportEvents: store.sportEventRepo(),
    tiers: store.tierRepo(),
    valuations: store.valuationRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    platformTierProfiles: store.platformTierProfileRepo(),
    platformPricingProfiles: store.platformPricingProfileRepo(),
  });
  return { store, event, service };
}

describe('SportEventTierService — tiers', () => {
  it('creates each new event\'s default tiers, as many as its sport league\'s tier profile names, and answers them as written', async () => {
    const { store, event, service } = setup();
    const league = store.addLeagueWithPlatformTierProfile({ tierCount: 4, tierSize: 3 });
    const playoff = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.FOOTBALL, sportLeagueId: league.id });

    const golf = await service.createDefaultTiers({ id: event.sportLeagueId, platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID }, [event.id]);
    const written = await service.createDefaultTiers(league, [playoff.id]);

    expect(golf.get(event.id)?.tiers.map((tier) => tier.tierKey)).toEqual(['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'tier-6']);
    expect(written.get(playoff.id)?.tiers.map((tier) => tier.tierNumber)).toEqual([1, 2, 3, 4]);
    expect((await service.listTiers(playoff.id)).map((tier) => tier.tierNumber)).toEqual([1, 2, 3, 4]);
    expect(store.tierRows).toHaveLength(10);
  });

  it('refuses default tiers on a tier profile that is gone with 404 PLATFORM_TIER_PROFILE_NOT_FOUND, writing none', async () => {
    const { store, service } = setup();

    await expect(service.createDefaultTiers({ id: 'sport-league-x', platformTierProfileId: 'tier-profile-gone' }, ['event-x'])).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NOT_FOUND', statusCode: 404 });
    expect(store.tierRows).toEqual([]);
  });

  it('starts an event with its league\'s six tiers of two (the College Football Playoff\'s profile) and places 12 playoff teams two to a tier', async () => {
    const { store, service } = setup();
    const league = store.addLeagueWithPlatformTierProfile({ tierCount: 6, tierSize: 2 });
    const playoff = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.FOOTBALL, sportLeagueId: league.id });

    await service.createDefaultTiers(league, [playoff.id]);
    addFieldByOdds(store, playoff.id, 12);
    const groups = await service.autoAssignTiers({ sportEventId: playoff.id });

    expect(groups.map((group) => group.participants.length)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('places a 14-team, two-conference playoff field by seed range on a ranges profile: both 1 seeds in tier 1, seeds 2 to 4 in tier 2, the rest in tier 3, whatever their odds', async () => {
    const { store, service } = setup();
    const league = store.addLeagueWithRangesTierProfile(
      [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }],
      [FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING],
    );
    const playoff = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.FOOTBALL, sportLeagueId: league.id });
    await service.createDefaultTiers(league, [playoff.id]);
    for (const conference of ['afc', 'nfc']) {
      for (let seed = 1; seed <= 7; seed++) {
        // The odds run against the seeds, so an order by odds would put the 7 seeds first.
        store.addToField(playoff.id, `${conference}-${seed}`, { seedNumber: seed, oddsToWin: 100 - seed });
      }
    }

    const groups = await service.autoAssignTiers({ sportEventId: playoff.id });

    expect(groups.map((group) => group.participants.map((placement) => placement.participantId).sort())).toEqual([
      ['afc-1', 'nfc-1'],
      ['afc-2', 'afc-3', 'afc-4', 'nfc-2', 'nfc-3', 'nfc-4'],
      ['afc-5', 'afc-6', 'afc-7', 'nfc-5', 'nfc-6', 'nfc-7'],
    ]);
    expect(store.valuationRows.every((valuation) => valuation.tierAssignedSource === 'AUTO_SEED')).toBe(true);
    expect(store.firstTierSlotOf(playoff.id).tierLayout).toMatchObject({ type: 'RANGES' });
  });

  it('refuses (422 TIER_SIZE_NOT_FOR_RANGES) a tier size sent for a league whose tier profile is ranges, placing no one', async () => {
    const { store, service } = setup();
    const league = store.addLeagueWithRangesTierProfile([{ tierNumber: 1, fromValue: 1, toValue: 2 }, { tierNumber: 2, fromValue: 3, toValue: null }], [FieldOrderBasis.SEED]);
    const playoff = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.FOOTBALL, sportLeagueId: league.id });
    await service.createDefaultTiers(league, [playoff.id]);
    store.addToField(playoff.id, 'p-1', { seedNumber: 1 });

    await expect(service.autoAssignTiers({ sportEventId: playoff.id, tierSize: 3 })).rejects.toMatchObject({ code: 'TIER_SIZE_NOT_FOR_RANGES', statusCode: 422 });
    expect(store.valuationRows.filter((valuation) => valuation.tierAssignedSource !== null)).toEqual([]);
  });

  it('keeps golf\'s six tiers of ten as they were: 72 golfers by odds are 10 in each of the first five tiers and 22 in the last', async () => {
    const { store, event, service } = setup();
    await service.createDefaultTiers({ id: event.sportLeagueId, platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID }, [event.id]);
    addFieldByOdds(store, event.id, 72);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.length)).toEqual([10, 10, 10, 10, 10, 22]);
    expect(groups[0]?.participants.map((placement) => placement.participantId)).toEqual(['p-01', 'p-02', 'p-03', 'p-04', 'p-05', 'p-06', 'p-07', 'p-08', 'p-09', 'p-10']);
  });

  it('places the field in the new tiers at once when no tier was placed by hand, moving those in a removed tier without asking', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    addFieldByOdds(store, event.id, 6);
    await service.autoAssignTiers({ sportEventId: event.id });

    const groups = await service.replaceTiers({ sportEventId: event.id, tiers: [
      { tierKey: 'tier-1', tierNumber: 1 },
      { tierKey: 'tier-3', tierNumber: 2 },
      { tierKey: 'tier-4', tierNumber: 3 },
    ] });

    expect(groups.map((group) => [group.tierNumber, group.participants.map((placement) => placement.participantId)])).toEqual([
      [1, ['p-01', 'p-02']],
      [2, ['p-03', 'p-04']],
      [3, ['p-05', 'p-06']],
    ]);
    expect(store.valuationRows.every((valuation) => valuation.tierAssignedSource === 'AUTO_ODDS')).toBe(true);
  });

  it('keeps every place once a tier was placed by hand, re-saving the tiers without re-placing anyone', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    addFieldByOdds(store, event.id, 2);
    const [tier1, tier2] = store.tierRows;
    const [first, second] = store.field;
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(event.id), [
      { sportEventParticipantId: first.id, sportEventSlotTierId: tier2.id, tierOrderIndex: 0, source: 'MANUAL' },
      { sportEventParticipantId: second.id, sportEventSlotTierId: tier1.id, tierOrderIndex: 0, source: 'AUTO_ODDS' },
    ]);

    const groups = await service.replaceTiers({ sportEventId: event.id, tiers: [
      { tierKey: 'tier-1', tierNumber: 1 },
      { tierKey: 'tier-2', tierNumber: 2 },
    ] });

    expect(groups.map((group) => [group.tierNumber, group.participants.map((placement) => placement.participantId)])).toEqual([
      [1, ['p-02']],
      [2, ['p-01']],
    ]);
  });

  it('refuses, once a tier was placed by hand, a replacement that would strand placed participants unless they are sent somewhere', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'p-1');
    const [, tier2] = store.tierRows;
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(event.id), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier2.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    await expect(service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]] }))
      .rejects.toMatchObject({ code: 'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS', statusCode: 409 });
    await expect(service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]], reassignOrphansTo: 'tier-9' }))
      .rejects.toMatchObject({ code: 'REASSIGN_TARGET_TIER_NOT_FOUND', statusCode: 422 });

    const groups = await service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]], reassignOrphansTo: 'tier-1' });

    expect(groups).toEqual([expect.objectContaining({ tierKey: 'tier-1', participants: [expect.objectContaining({ participantId: 'p-1', tierOrderIndex: null })] })]);
  });
});

describe('SportEventTierService — assignment', () => {
  it('fills tiers in order by odds, tierSize each, the last tier taking the rest, and skips inactive participants', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    store.addToField(event.id, 'p-long', { oddsToWin: 50 });
    store.addToField(event.id, 'p-fav', { oddsToWin: 5 });
    store.addToField(event.id, 'p-mid', { oddsToWin: 20 });
    store.addToField(event.id, 'p-out', { oddsToWin: 1, status: SportEventParticipantStatus.WITHDRAWN });

    const groups = await service.autoAssignTiers({ sportEventId: event.id, tierSize: 1 });

    expect(groups.map((group) => group.participants.map((placement) => placement.participantId))).toEqual([
      ['p-fav'],
      ['p-mid', 'p-long'],
    ]);
    expect(store.valuationRows.every((valuation) => valuation.tierAssignedSource === 'AUTO_ODDS')).toBe(true);
  });

  it('orders a field with ranks and no odds or seeds by rank, a tie in its given order, and records rank as the source', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, [TWO_TIERS[0]]);
    store.addToField(event.id, 'p-b', { ranking: 3 });
    store.addToField(event.id, 'p-a', { ranking: 3 });
    store.addToField(event.id, 'p-c', { ranking: 1 });

    const [group] = await service.autoAssignTiers({ sportEventId: event.id });

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-c', 'p-a', 'p-b']);
    expect(store.valuationRows[0].tierAssignedSource).toBe('AUTO_RANKING');
  });

  it('places the league\'s tier profile size (ten for golf) in each tier when no size is sent and the event keeps the profile\'s six tiers, the last tier taking the rest', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, tierDefinitions(6));
    addFieldByOdds(store, event.id, 62);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.length)).toEqual([10, 10, 10, 10, 10, 12]);
  });

  it('keeps a three-tiers-of-three profile\'s three-three-rest layout when no size is sent and the race keeps its three default tiers', async () => {
    const { store, service } = setup();
    const race = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.HORSE_RACING, sportLeagueId: store.addLeagueWithPlatformTierProfile({ tierCount: 3, tierSize: 3 }).id });
    await store.addTiers(race.id, tierDefinitions(3));
    addFieldByOdds(store, race.id, 14);

    const groups = await service.autoAssignTiers({ sportEventId: race.id });

    expect(groups.map((group) => group.participants.length)).toEqual([3, 3, 8]);
  });

  // The layouts the migration made from each sport's former default (#1844), created as a new
  // event gets them, on the field sizes they were designed around: the layout where it reaches
  // every tier, else an even spread.
  it.each([
    { tierCount: 5, tierSize: 8, fieldSize: 40, expected: [8, 8, 8, 8, 8], what: 'a full 40-car NASCAR field fills five tiers of eight exactly' },
    { tierCount: 5, tierSize: 8, fieldSize: 33, expected: [8, 8, 8, 8, 1], what: 'the 33-car Indy 500 field leaves the fifth tier the short one' },
    { tierCount: 5, tierSize: 8, fieldSize: 24, expected: [5, 5, 5, 5, 4], what: 'a 24-car field, too small for five tiers of eight, is spread evenly' },
    { tierCount: 5, tierSize: 10, fieldSize: 176, expected: [10, 10, 10, 10, 136], what: 'a Grand Tour field of 176 puts ten contenders in each of four tiers and the rest in the fifth' },
    { tierCount: 5, tierSize: 10, fieldSize: 35, expected: [7, 7, 7, 7, 7], what: 'a 35-rider field, too small for four tiers of ten, is spread evenly' },
    { tierCount: 4, tierSize: 6, fieldSize: 30, expected: [6, 6, 6, 12], what: 'an elite marathon field of 30 puts six favourites in each of three tiers and the rest in the fourth' },
    { tierCount: 4, tierSize: 6, fieldSize: 15, expected: [4, 4, 4, 3], what: 'a 15-runner field, too small for three tiers of six, is spread evenly' },
  ])('auto-assigns the default tiers of a league profiled $tierCount tiers of $tierSize when no size is sent: $what', async ({ tierCount, tierSize, fieldSize, expected }) => {
    const { store, service } = setup();
    const league = store.addLeagueWithPlatformTierProfile({ tierCount, tierSize });
    const event = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sportLeagueId: league.id });
    await service.createDefaultTiers(league, [event.id]);
    addFieldByOdds(store, event.id, fieldSize);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.length)).toEqual(expected);
  });

  it('orders by odds first when asked to, falling back to ranking on equal odds and to participant id when both tie', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, [TWO_TIERS[0]]);
    store.addToField(event.id, 'p-d', { ranking: 2, oddsToWin: 10 });
    store.addToField(event.id, 'p-c', { ranking: 2, oddsToWin: 10 });
    store.addToField(event.id, 'p-z', { ranking: 1, oddsToWin: 10 });
    store.addToField(event.id, 'p-a', { ranking: 9, oddsToWin: 5 });

    const [group] = await service.autoAssignTiers({ sportEventId: event.id });

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-a', 'p-z', 'p-c', 'p-d']);
    expect(store.valuationRows[0].tierAssignedSource).toBe('AUTO_ODDS');
  });

  it('spreads a field too small for the league\'s tier profile evenly on the default tiers so release finds no empty tier: 6 horses on three tiers is 2/2/2, 30 golfers on six is 5 each', async () => {
    const { store, event, service } = setup();
    const race = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.HORSE_RACING, sportLeagueId: store.addLeagueWithPlatformTierProfile({ tierCount: 3, tierSize: 3 }).id });
    await store.addTiers(race.id, tierDefinitions(3));
    addFieldByOdds(store, race.id, 6);

    const raceGroups = await service.autoAssignTiers({ sportEventId: race.id });

    expect(raceGroups.map((group) => group.participants.length)).toEqual([2, 2, 2]);

    await store.addTiers(event.id, tierDefinitions(6));
    addFieldByOdds(store, event.id, 30);

    const golfGroups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(golfGroups.map((group) => group.participants.length)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it('keeps the profile\'s layout when it just fills every default tier: 7 horses on three tiers is 3/3/1', async () => {
    const { store, service } = setup();
    const race = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.HORSE_RACING, sportLeagueId: store.addLeagueWithPlatformTierProfile({ tierCount: 3, tierSize: 3 }).id });
    await store.addTiers(race.id, tierDefinitions(3));
    addFieldByOdds(store, race.id, 7);

    const groups = await service.autoAssignTiers({ sportEventId: race.id });

    expect(groups.map((group) => group.participants.length)).toEqual([3, 3, 1]);
  });

  it('spreads a 22-driver field over a race set to four tiers as 6/6/5/5 when no size is sent, leaving no tier empty', async () => {
    const { store, service } = setup();
    const race = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.AUTO_RACING, sportLeagueId: store.addLeagueWithPlatformTierProfile({ tierCount: 5, tierSize: 8 }).id });
    await store.addTiers(race.id, tierDefinitions(4));
    addFieldByOdds(store, race.id, 22);

    const groups = await service.autoAssignTiers({ sportEventId: race.id });

    expect(groups.map((group) => group.participants.length)).toEqual([6, 6, 5, 5]);
    expect(groups[0].participants.map((placement) => placement.participantId)).toEqual(['p-01', 'p-02', 'p-03', 'p-04', 'p-05', 'p-06']);
    expect(groups[3].participants.map((placement) => placement.participantId)).toEqual(['p-18', 'p-19', 'p-20', 'p-21', 'p-22']);
  });

  it('spreads 33 golfers over five tiers as 7/7/7/6/6 and 176 as 36/35/35/35/35 when no size is sent, larger tiers first', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, tierDefinitions(5));
    addFieldByOdds(store, event.id, 33);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.length)).toEqual([7, 7, 7, 6, 6]);

    const big = store.addSlottedEvent({ status: SportEventStatus.DRAFT });
    await store.addTiers(big.id, tierDefinitions(5));
    addFieldByOdds(store, big.id, 176);

    const bigGroups = await service.autoAssignTiers({ sportEventId: big.id });

    expect(bigGroups.map((group) => group.participants.length)).toEqual([36, 35, 35, 35, 35]);
  });

  it('leaves the trailing tiers empty when the field is smaller than the tier count and no size is sent', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, tierDefinitions(5));
    addFieldByOdds(store, event.id, 3);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.length)).toEqual([1, 1, 1, 0, 0]);
  });

  it('fills a sent tier size exactly as before, even when that leaves the last tier empty (22 drivers in fours of 8 is 8/8/6/0)', async () => {
    const { store, service } = setup();
    const race = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sport: Sport.AUTO_RACING, sportLeagueId: store.addLeagueWithPlatformTierProfile({ tierCount: 5, tierSize: 8 }).id });
    await store.addTiers(race.id, tierDefinitions(4));
    addFieldByOdds(store, race.id, 22);

    const groups = await service.autoAssignTiers({ sportEventId: race.id, tierSize: 8 });

    expect(groups.map((group) => group.participants.length)).toEqual([8, 8, 6, 0]);
  });

  it('leaves the participants beyond a capped last tier in no tier, still in order, and records the capped layout on the event', async () => {
    const { store, service } = setup();
    const league = store.addLeagueWithPlatformTierProfile({ tierCount: 3, tierSize: 2, lastTier: 'CAPPED', lastTierMax: 2 });
    const event = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sportLeagueId: league.id });
    await service.createDefaultTiers(league, [event.id]);
    addFieldByOdds(store, event.id, 9);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.map((placement) => placement.participantId))).toEqual([
      ['p-01', 'p-02'], ['p-03', 'p-04'], ['p-05', 'p-06'],
    ]);
    const outOfTiers = store.valuationRows.filter((row) => row.sportEventSlotTierId === null);
    expect(outOfTiers).toHaveLength(3);
    expect(outOfTiers.every((row) => row.tierAssignedSource === 'AUTO_ODDS')).toBe(true);
    expect(store.firstTierSlotOf(event.id).tierLayout).toEqual({
      platformTierProfileId: league.platformTierProfileId, profileName: '3 tiers of 2', type: 'EQUAL_GROUPS', tierCount: 3, tierSize: 2, lastTier: 'CAPPED', lastTierMax: 2,
    });
    const slot = store.firstTierSlotOf(event.id);
    await expect(store.sportEventRepo().countUntieredActiveParticipants([slot])).resolves.toEqual(new Map([[slot.id, 0]]));
  });

  it('tiers with the profile its own sport league names, not the first profile there is', async () => {
    const { store, service } = setup();
    const league = store.addLeagueWithPlatformTierProfile({ tierCount: 2, tierSize: 1 });
    const event = store.addSlottedEvent({ status: SportEventStatus.DRAFT, sportLeagueId: league.id });
    await store.addTiers(event.id, TWO_TIERS);
    addFieldByOdds(store, event.id, 5);

    const groups = await service.autoAssignTiers({ sportEventId: event.id });

    expect(groups.map((group) => group.participants.length)).toEqual([1, 4]);
    expect(store.firstTierSlotOf(event.id).tierLayout?.profileName).toBe('2 tiers of 1');
  });

  it('records the tier size an admin sent on the event\'s layout, with the league\'s profile name', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    addFieldByOdds(store, event.id, 4);

    await service.autoAssignTiers({ sportEventId: event.id, tierSize: 3 });

    expect(store.firstTierSlotOf(event.id).tierLayout).toMatchObject({ profileName: '6 tiers of 10', tierSize: 3 });
  });

  it('refuses to auto-tier an event whose sport league names no tier profile with 404 SPORT_LEAGUE_NOT_FOUND, tiering no one', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    addFieldByOdds(store, event.id, 4);
    store.platformTierProfiles = [];

    await expect(service.autoAssignTiers({ sportEventId: event.id })).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    expect(store.valuationRows).toEqual([]);
  });

  it('does nothing for an event with no tiers yet', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1');

    await expect(service.autoAssignTiers({ sportEventId: event.id })).resolves.toEqual([]);
    expect(store.valuationRows).toEqual([]);
  });

  it('checks the whole drag-and-drop save before writing: an unknown tier key is 422, a row off the field is 404', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'p-1');

    await expect(service.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: entry.id, tierKey: 'nope', tierOrderIndex: 1 }] }))
      .rejects.toMatchObject({ code: 'UNKNOWN_TIER_KEY', statusCode: 422 });
    await expect(service.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: 'elsewhere', tierKey: 'tier-1', tierOrderIndex: 1 }] }))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
    expect(store.valuationRows).toEqual([]);

    await service.replaceTierAssignments({ sportEventId: event.id, assignments: [{ sportEventParticipantId: entry.id, tierKey: 'tier-2', tierOrderIndex: 7 }] });

    expect(store.valuationRows).toEqual([expect.objectContaining({ tierOrderIndex: 7, tierAssignedSource: 'MANUAL' })]);
  });
});

describe('SportEventTierService — one order for tiers and prices', () => {
  it('tiers and prices the same field in the same order, odds deciding over seeds, and records odds as the source of both', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, tierDefinitions(3));
    store.addToField(event.id, 'p-seed-1', { seedNumber: 1, oddsToWin: 10, ranking: 1 });
    store.addToField(event.id, 'p-seed-2', { seedNumber: 2, oddsToWin: 3, ranking: 5 });
    store.addToField(event.id, 'p-seed-3', { seedNumber: 3, oddsToWin: 25, ranking: 2 });

    const groups = await service.autoAssignTiers({ sportEventId: event.id, tierSize: 1 });
    const views = await service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() });

    const tierOrder = groups.flatMap((group) => group.participants.map((placement) => placement.participantId));
    const priceOrder = [...views].sort((left, right) => (right.price ?? 0) - (left.price ?? 0)).map((view) => view.participantId);
    expect(tierOrder).toEqual(['p-seed-2', 'p-seed-1', 'p-seed-3']);
    expect(priceOrder).toEqual(tierOrder);
    expect(store.valuationRows.every((row) => row.tierAssignedSource === 'AUTO_ODDS' && row.priceAssignedSource === 'AUTO_ODDS')).toBe(true);
  });

  it('orders a field with seeds and no odds by seed for both, recording seed as the source', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, tierDefinitions(2));
    store.addToField(event.id, 'p-b', { seedNumber: 2, ranking: 1 });
    store.addToField(event.id, 'p-a', { seedNumber: 1, ranking: 9 });

    const groups = await service.autoAssignTiers({ sportEventId: event.id, tierSize: 1 });
    await service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() });

    expect(groups.map((group) => group.participants.map((placement) => placement.participantId))).toEqual([['p-a'], ['p-b']]);
    expect(store.valuationRows.every((row) => row.tierAssignedSource === 'AUTO_SEED' && row.priceAssignedSource === 'AUTO_SEED')).toBe(true);
  });

  it('refuses to tier or price a field with nothing but names with 409 FIELD_HAS_NO_ORDER, writing nothing, since a name orders nothing', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, tierDefinitions(2));
    const sportId = 'sport-golf';
    for (const name of ['Charlie', 'Alpha', 'Bravo']) {
      store.addToField(event.id, store.addParticipant(sportId, name).id);
    }

    await expect(service.autoAssignTiers({ sportEventId: event.id, tierSize: 1 })).rejects.toMatchObject({ code: 'FIELD_HAS_NO_ORDER', statusCode: 409 });
    await expect(service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() })).rejects.toMatchObject({ code: 'FIELD_HAS_NO_ORDER', statusCode: 409 });
    expect(store.valuationRows).toEqual([]);
  });
});

describe('SportEventTierService — prices and the contest-side read', () => {
  it('prices the whole active field on the curve, best seed dearest and a golfer with no seed cheapest, leaving tiers alone', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-unseeded');
    store.addToField(event.id, 'p-2', { seedNumber: 2 });
    store.addToField(event.id, 'p-1', { seedNumber: 1 });
    store.addToField(event.id, 'p-withdrawn', { seedNumber: 3, status: SportEventParticipantStatus.WITHDRAWN });

    const views = await service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() });

    const priceOf = new Map(views.map((view) => [view.participantId, view.price]));
    expect(Object.fromEntries(priceOf)).toEqual({ 'p-1': 12000, 'p-2': 6400, 'p-unseeded': 6000 });
    expect(views.every((view) => view.tierId === null)).toBe(true);
    expect(store.valuationRows.every((row) => row.priceAssignedSource === 'AUTO_SEED')).toBe(true);
  });

  it('prices a field with odds and no seeds from the favourite down, so a race priced from its morning line follows the market', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-long', { oddsToWin: 30 });
    store.addToField(event.id, 'p-fav', { oddsToWin: 2.5 });
    store.addToField(event.id, 'p-mid', { oddsToWin: 8 });

    const views = await service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() });

    const priceOf = Object.fromEntries(views.map((view) => [view.participantId, view.price]));
    expect(priceOf['p-fav']).toBeGreaterThan(priceOf['p-mid'] ?? Infinity);
    expect(priceOf['p-mid']).toBeGreaterThan(priceOf['p-long'] ?? Infinity);
  });

  it('prices by odds when every participant has odds, even where the seeds disagree', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-guest-long', { oddsToWin: 40 });
    store.addToField(event.id, 'p-seed-2', { seedNumber: 2, oddsToWin: 3 });
    store.addToField(event.id, 'p-guest-short', { oddsToWin: 6 });
    store.addToField(event.id, 'p-seed-1', { seedNumber: 1, oddsToWin: 10 });

    const views = await service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() });

    const byPrice = [...views].sort((left, right) => (right.price ?? 0) - (left.price ?? 0)).map((view) => view.participantId);
    expect(byPrice).toEqual(['p-seed-2', 'p-guest-short', 'p-seed-1', 'p-guest-long']);
  });

  it('records on the event the values its field was priced with, replacing the last ones on a re-price', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1', { seedNumber: 1 });
    const small = { ...inMemoryStandardPricing(), salaryCap: 5000, unit: 10 };

    await service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() });
    await service.autoAssignPrices({ sportEventId: event.id, pricing: small });

    expect(store.firstTierSlotOf(event.id).pricing).toEqual({ ...small, profileName: 'Standard' });
    expect(store.valuationRows.map((row) => row.price)).toEqual([1200]);
  });

  it.each([
    ['a floor share above the top share', { floorSharePercent: 30 }],
    ['a rounding unit above the salary cap', { unit: 60_000 }],
    // The worst seed's price is $6,000 (12% of $50,000): a $20,000 unit would round it to $0.
    ['a rounding unit above the worst golfer\'s price, which would round it to $0', { unit: 20_000 }],
  ])('refuses %s with 422 PRICING_CONFIG_INVALID, pricing nothing', async (_case, change) => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-1', { seedNumber: 1 });

    await expect(service.autoAssignPrices({ sportEventId: event.id, pricing: { ...inMemoryStandardPricing(), ...change } }))
      .rejects.toMatchObject({ code: 'PRICING_CONFIG_INVALID', statusCode: 422 });
    expect(store.valuationRows).toEqual([]);
    expect(store.firstTierSlotOf(event.id).pricing).toBeNull();
  });

  it('reads a price-only valuation with no tier, which a read starting from the tiers would miss', async () => {
    const { store, event, service } = setup();
    const entry = store.addToField(event.id, 'p-budget');
    await store.valuationRepo().assignSlotPrices({
      slot: store.firstTierSlotOf(event.id),
      pricing: inMemoryStandardPricing(),
      assignments: [{ sportEventParticipantId: entry.id, price: 12, source: 'MANUAL' }],
    });

    await expect(service.getEffectiveValuationsForSportEvent(event.id)).resolves.toEqual([
      expect.objectContaining({ participantId: 'p-budget', price: 12, tierId: null, tierKey: null }),
    ]);
    await expect(service.getEffectiveTiersForSportEvent(event.id)).resolves.toEqual([]);
  });

  it('answers the tiers and the valuations from one read, and reads no field when the caller hands it the field (#1196)', async () => {
    const { store, event } = setup();
    await store.addTiers(event.id, [TWO_TIERS[0]]);
    const [tier] = store.tierRows;
    const entry = store.addToField(event.id, 'p-1');
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(event.id), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' }]);
    const field = store.fieldRepo();
    const findBySportEvent = jest.spyOn(field, 'findBySportEvent');
    const tiers = store.tierRepo();
    const findTiers = jest.spyOn(tiers, 'findBySlot');
    const service = new SportEventTierService({ sportEvents: store.sportEventRepo(), tiers, valuations: store.valuationRepo(), field, participants: store.participantRepo(), platformTierProfiles: store.platformTierProfileRepo(), platformPricingProfiles: store.platformPricingProfileRepo() });
    const heldField = await store.fieldRepo().findBySportEvent(event.id);

    const both = await service.getEffectiveTiersAndValuations(event.id, heldField);

    expect(both.tiers).toEqual([expect.objectContaining({ id: tier.id, participants: [expect.objectContaining({ participantId: 'p-1' })] })]);
    expect(both.valuations).toEqual([expect.objectContaining({ participantId: 'p-1', tierId: tier.id, tierNumber: tier.tierNumber })]);
    expect(findTiers).toHaveBeenCalledTimes(1);
    expect(findBySportEvent).not.toHaveBeenCalled();
  });

  it('answers several events\' tiers from one read each of tiers, valuations and fields, each event with its own tiers and an untiered one with none', async () => {
    const { store, event } = setup();
    const second = store.addSlottedEvent({ status: SportEventStatus.DRAFT });
    const untiered = store.addSlottedEvent({ status: SportEventStatus.DRAFT });
    await store.addTiers(event.id, TWO_TIERS);
    await store.addTiers(second.id, [TWO_TIERS[0]]);
    const [first1, first2, second1] = store.tierRows;
    const firstEntry = store.addToField(event.id, 'p-1');
    const secondEntry = store.addToField(event.id, 'p-2');
    const otherEntry = store.addToField(second.id, 'p-3');
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(event.id), [
      { sportEventParticipantId: firstEntry.id, sportEventSlotTierId: first2.id, tierOrderIndex: 1, source: 'MANUAL' },
      { sportEventParticipantId: secondEntry.id, sportEventSlotTierId: first1.id, tierOrderIndex: 1, source: 'MANUAL' },
    ]);
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(second.id), [
      { sportEventParticipantId: otherEntry.id, sportEventSlotTierId: second1.id, tierOrderIndex: 1, source: 'MANUAL' },
    ]);
    const tiers = store.tierRepo();
    const valuations = store.valuationRepo();
    const field = store.fieldRepo();
    const reads = [
      jest.spyOn(tiers, 'findBySlots'),
      jest.spyOn(valuations, 'findBySlots'),
      jest.spyOn(field, 'findBySportEvents'),
    ];
    const service = new SportEventTierService({ sportEvents: store.sportEventRepo(), tiers, valuations, field, participants: store.participantRepo(), platformTierProfiles: store.platformTierProfileRepo(), platformPricingProfiles: store.platformPricingProfileRepo() });

    const byEvent = await service.getEffectiveTiersForSportEvents([event.id, second.id, untiered.id]);

    const placed = (sportEventId: string) => (byEvent.get(sportEventId) ?? [])
      .map((group) => [group.tierKey, group.participants.map((participant) => participant.participantId)]);
    expect(placed(event.id)).toEqual([['tier-1', ['p-2']], ['tier-2', ['p-1']]]);
    expect(placed(second.id)).toEqual([['tier-1', ['p-3']]]);
    expect(byEvent.get(untiered.id)).toEqual([]);
    expect(await service.getEffectiveTiersForSportEvent(event.id)).toEqual(byEvent.get(event.id));
    for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('SportEventTierService — locked once the event is released (#431)', () => {
  it.each([
    SportEventStatus.SCHEDULED,
    SportEventStatus.IN_PROGRESS,
    SportEventStatus.COMPLETED,
  ])('refuses every tier and price write on a %s event with 409 SPORT_EVENT_TIERS_LOCKED, changing nothing', async (status) => {
    const { store, event, service } = setup(status);
    await store.addTiers(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'participant-a', { ranking: 1, seedNumber: 1 });
    const locked = { code: 'SPORT_EVENT_TIERS_LOCKED', statusCode: 409 };

    await expect(service.replaceTiers({ sportEventId: event.id, tiers: TWO_TIERS.slice(0, 1) })).rejects.toMatchObject(locked);
    await expect(service.replaceTierAssignments({
      sportEventId: event.id,
      assignments: [{ sportEventParticipantId: entry.id, tierKey: 'tier-1', tierOrderIndex: 1 }],
    })).rejects.toMatchObject(locked);
    await expect(service.autoAssignTiers({ sportEventId: event.id })).rejects.toMatchObject(locked);
    await expect(service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() })).rejects.toMatchObject(locked);

    expect(store.tierRows).toHaveLength(2);
    expect(store.valuationRows).toEqual([]);
  });

  it('refuses a tier write on an unknown event with 404 EVENT_NOT_FOUND', async () => {
    const { service } = setup();

    await expect(service.autoAssignTiers({ sportEventId: 'missing' }))
      .rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventTierService — the field changing between assignments', () => {
  it('places golfers with no ranking after every ranked golfer when tiering by ranking', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, [TWO_TIERS[0]]);
    store.addToField(event.id, 'p-unranked');
    store.addToField(event.id, 'p-second', { ranking: 2 });
    store.addToField(event.id, 'p-first', { ranking: 1 });

    const [group] = await service.autoAssignTiers({ sportEventId: event.id });

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-first', 'p-second', 'p-unranked']);
  });

  it('keeps a golfer who withdrew after an earlier assignment in their old tier when tiers are re-run, so picks of them still show in a tier', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    const withdrawn = store.addToField(event.id, 'p-withdrawn', { oddsToWin: 2 });
    store.addToField(event.id, 'p-fav', { oddsToWin: 5 });
    store.addToField(event.id, 'p-long', { oddsToWin: 50 });
    await service.autoAssignTiers({ sportEventId: event.id, tierSize: 1 });

    withdrawn.status = SportEventParticipantStatus.WITHDRAWN;
    const groups = await service.autoAssignTiers({ sportEventId: event.id, tierSize: 1 });

    expect(groups[0].participants.map((placement) => placement.participantId)).toEqual(['p-withdrawn', 'p-fav']);
    expect(groups[1].participants.map((placement) => placement.participantId)).toEqual(['p-long']);
  });

  it('lists a tier\'s golfers by their order index, with any that have none last', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, [TWO_TIERS[0]]);
    const [tier] = store.tierRows;
    const unordered = store.addToField(event.id, 'p-unordered');
    const second = store.addToField(event.id, 'p-second');
    const first = store.addToField(event.id, 'p-first');
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(event.id), [
      { sportEventParticipantId: unordered.id, sportEventSlotTierId: tier.id, tierOrderIndex: null as unknown as number, source: 'MANUAL' },
      { sportEventParticipantId: second.id, sportEventSlotTierId: tier.id, tierOrderIndex: 2, source: 'MANUAL' },
      { sportEventParticipantId: first.id, sportEventSlotTierId: tier.id, tierOrderIndex: 1, source: 'MANUAL' },
    ]);

    const [group] = await service.getEffectiveTiersForSportEvent(event.id);

    expect(group.participants.map((placement) => placement.participantId)).toEqual(['p-first', 'p-second', 'p-unordered']);
  });

  it('removes an empty tier without asking where its golfers should go', async () => {
    const { store, event, service } = setup();
    await store.addTiers(event.id, TWO_TIERS);
    const entry = store.addToField(event.id, 'p-1');
    const [tier1] = store.tierRows;
    await store.valuationRepo().assignTiers(store.firstTierSlotOf(event.id), [{ sportEventParticipantId: entry.id, sportEventSlotTierId: tier1.id, tierOrderIndex: 1, source: 'MANUAL' }]);

    const groups = await service.replaceTiers({ sportEventId: event.id, tiers: [TWO_TIERS[0]] });

    expect(groups.map((group) => [group.tierKey, group.participants.map((p) => p.participantId)])).toEqual([['tier-1', ['p-1']]]);
  });

  it('prices nothing and writes nothing when the event has no active golfer', async () => {
    const { store, event, service } = setup();
    store.addToField(event.id, 'p-withdrawn', { seedNumber: 1, status: SportEventParticipantStatus.WITHDRAWN });

    await expect(service.autoAssignPrices({ sportEventId: event.id, pricing: inMemoryStandardPricing() })).resolves.toEqual([]);
    expect(store.valuationRows).toEqual([]);
  });
});
