/**
 * An in-memory implementation of the event-core, golf and race extension ports (#236, #622), for
 * service tests that assert what a service leaves behind rather than which repository
 * calls it made (testing-rules §1D, the plan's test layering). The Prisma adapters
 * behind the same ports are tested against Postgres in sport-event-repositories.integration.
 *
 * Deliberately simple: ids are sequential, "all or none" writes validate every row
 * before applying any, and orderings follow each port's documented contract.
 */

import type {
  GolfRoundWrite,
  GolfStandingWrite,
  ParticipantProviderMappingRepository,
  ProviderMappingScope,
  ParticipantRepository,
  SportEventCreate,
  SportEventParticipantCreate,
  SportEventParticipantGolfRoundRepository,
  SportEventParticipantGolfStandingRepository,
  SportEventParticipantPatch,
  SportEventParticipantRaceResultRepository,
  ProviderNotificationReceipt,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventParticipantView,
  SportEventRoundMatchRepository,
  SportEventRepository,
  SportLeagueSeasonRepository,
  SportEventRoundRepository,
  SportEventRoundSchedule,
  SportEventTierDefinition,
  SportEventTierRepository,
  SportEventUpdate,
  SportLeagueRepository,
  SportRepository,
  PlatformPricingProfileRepository,
  PlatformTierProfileRepository,
} from '@poolmaster/shared/db';
import { TEST_PROVIDER_ROWS } from './balldontlie-provider-rows';
import type { SportEventBracketServiceDeps } from '../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { MatchEnding, BracketAdvancement, SeasonSlotStatus, SeriesFormat, SlotKind, SlotPairing, findSportRow, providerSourceIdOf, requireProviderCodeOfSourceId, type ProviderEventRef, type SportEventProviderMapping, isMatchUnplayed, MatchSide, MatchStatus, ParticipantStatus, Sport } from '@poolmaster/shared/domain';
import { sportPlay } from './sport-play';
import type {
  AutoReleaseCheck,
  BackgroundJobRequest,
  GolfRoundResult,
  GolfStandingResult,
  Participant,
  ParticipantProviderMapping,
  SportConfig,
  SportEvent,
  SportEventRoundMatch,
  SportEventParticipant,
  SportEventParticipantGolfRound,
  SportEventParticipantGolfStanding,
  SportEventParticipantRaceResult,
  SportEventParticipantRound,
  SportEventParticipantStanding,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventTier,
  SportLeague,
  BudgetPricingProfile,
  PlatformPricingProfile,
  PlatformTierProfile,
  SportLeagueSeasonSlot,
} from '@poolmaster/shared/domain';
import { sportRowKeys } from './sport-rows';

const T0 = new Date('2026-01-01T00:00:00.000Z');

/** The profiles every in-memory sport league names (#1844); `platformTierProfileRepo` and `platformPricingProfileRepo` serve them. */
export const IN_MEMORY_PLATFORM_TIER_PROFILE_ID = 'tier-profile-default';
export const IN_MEMORY_PLATFORM_PRICING_PROFILE_ID = 'pricing-profile-default';

function stamp<T extends object>(row: T): T & { createdAt: Date; updatedAt: Date } {
  return { createdAt: T0, updatedAt: T0, ...row };
}

function nullable<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

/** The picks side of the bracket service (#720) for an event no entry has picked: no spread is ever locked. */
export const NO_PICKS_ON_EVENT: Pick<SportEventBracketServiceDeps, 'predictions'> = {
  predictions: { hasAnyOnMatch: async () => false },
};

/** The sport league of an event or participant made without one. */
const UNPLACED_SPORT_LEAGUE_ID = 'sport-league-unplaced';
/** The Season every league in the store is in unless a test adds another (#2003). */
export const IN_MEMORY_SEASON_ID = 'season-2026';
const IN_MEMORY_SEASON_YEAR = 2026;

/** The mapping the sync writes for a provider's event, read with the provider's name. */
export function providerMappingOf(ref: ProviderEventRef): SportEventProviderMapping {
  const providerCode = requireProviderCodeOfSourceId(ref.providerId);
  return { providerCode, providerName: TEST_PROVIDER_ROWS[providerCode].name, externalId: ref.externalId };
}

export class InMemorySportEvents {
  private sequence = 0;
  sports: SportConfig[] = [];
  sportLeagues: SportLeague[] = [];
  /** The profiles sport leagues name (#1844): golf's six tiers of ten, and Standard pricing. */
  platformTierProfiles: PlatformTierProfile[] = [stamp({ id: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, code: 'TIERS_6_OF_10', name: '6 tiers of 10', tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING' as const, lastTierMax: null })];
  platformPricingProfiles: PlatformPricingProfile[] = [stamp({ id: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID, code: 'STANDARD', name: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 })];
  participants: Participant[] = [];
  mappings: ParticipantProviderMapping[] = [];
  events: SportEvent[] = [];
  /** Each event's latest automatic release check (#1847); absent when none is stored. */
  autoReleaseChecks = new Map<string, AutoReleaseCheck>();
  contestsByEvent = new Map<string, number>();
  /** The Season slots each event covers, as `findSlots` answers them (#2004); a test sets them. */
  slotsByEvent = new Map<string, SportLeagueSeasonSlot[]>();
  /** Season slots a test event can be made on (`addTestSlot`), as `seasonRepo().findSlot` reads them. */
  seasonSlots: Array<SportLeagueSeasonSlot & { sportLeagueId: string; sportLeagueSeasonId: string }> = [];

  /**
   * A Season slot of the league's current Season (#2004): a test slot unless `isTestData` is
   * false, starting `startsAt`. Answers its id.
   */
  addTestSlot(sportLeague: Pick<SportLeague, 'id' | 'currentSeasonId'>, startsAt: Date, overrides: Partial<SportLeagueSeasonSlot & { sportLeagueSeasonId: string }> = {}): string {
    const id = this.id('season-slot');
    this.seasonSlots.push({
      id, slotDefinitionId: 'slot-definition', key: 'TEST_EVENT', slotKind: SlotKind.TOURNAMENT, weekNumber: null, name: null,
      startsAt, endsAt: null, status: SeasonSlotStatus.SCHEDULED, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
      isTestData: true, label: id, sportLeagueId: sportLeague.id, sportLeagueSeasonId: sportLeague.currentSeasonId ?? IN_MEMORY_SEASON_ID,
      ...overrides,
    });
    return id;
  }

  /** The PROVIDER_CODE value each synced slot's definition is mapped by, as `findSyncSlots` reads it (#2005). */
  slotProviderCodes = new Map<string, string>();
  /** The synced slots an active contest template lists (#2005). */
  templateCoveredSlotIds = new Set<string>();

  /**
   * A synced Season slot of the league's current Season (#2005), with no dates yet, mapped by
   * `providerCode` and listed by a template unless `covered` is false. Answers its id.
   */
  addSyncSlot(sportLeague: Pick<SportLeague, 'id' | 'currentSeasonId'>, providerCode: string | null, options: { covered?: boolean } = {}): string {
    const id = this.addTestSlot(sportLeague, new Date(0), { isTestData: false, label: null, startsAt: null });
    if (providerCode !== null) this.slotProviderCodes.set(id, providerCode);
    if (options.covered ?? true) this.templateCoveredSlotIds.add(id);
    return id;
  }

  /** The Season slot reads an event create makes, and the events sync's slot reads and writes. */
  seasonRepo(): Pick<SportLeagueSeasonRepository, 'findSlot' | 'findSyncSlots' | 'recordSyncedSlots'> {
    const ownerOf = (slotId: string) => [...this.slotsByEvent.entries()].find(([, slots]) => slots.some((each) => each.id === slotId))?.[0] ?? null;
    return {
      findSyncSlots: async (sportLeagueSeasonId) => this.seasonSlots
        .filter((slot) => slot.sportLeagueSeasonId === sportLeagueSeasonId && !slot.isTestData)
        .map((slot) => ({
          seasonSlotId: slot.id,
          providerCode: this.slotProviderCodes.get(slot.id) ?? null,
          coveredByTemplate: this.templateCoveredSlotIds.has(slot.id),
          sportEventId: ownerOf(slot.id),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        })),
      recordSyncedSlots: async ({ eventSlots, slotDates }) => {
        for (const change of slotDates) {
          const slot = this.seasonSlots.find((candidate) => candidate.id === change.seasonSlotId);
          if (slot) Object.assign(slot, { startsAt: change.startsAt, endsAt: change.endsAt });
        }
        for (const row of eventSlots) {
          const slot = this.seasonSlots.find((candidate) => candidate.id === row.seasonSlotId);
          if (!slot || ownerOf(slot.id) !== null) continue;
          this.slotsByEvent.set(row.sportEventId, [...(this.slotsByEvent.get(row.sportEventId) ?? []), slot]);
        }
      },
      findSlot: async (id) => {
        const slot = this.seasonSlots.find((candidate) => candidate.id === id);
        if (!slot) return null;
        const owner = [...this.slotsByEvent.entries()].find(([, slots]) => slots.some((each) => each.id === id));
        const { sportLeagueId, sportLeagueSeasonId, ...seasonSlot } = slot;
        return { slot: seasonSlot, sportLeagueId, sportLeagueSeasonId, sportEventId: owner?.[0] ?? null };
      },
    };
  }
  picksByEntry = new Map<string, number>();
  roundRows: SportEventRound[] = [];
  field: SportEventParticipant[] = [];
  tierRows: SportEventTier[] = [];
  valuationRows: SportEventParticipantValuation[] = [];
  participantRoundRows: Array<Omit<SportEventParticipantRound, 'roundNumber'>> = [];
  standingRows: SportEventParticipantStanding[] = [];
  golfRoundRows: SportEventParticipantGolfRound[] = [];
  golfStandingRows: SportEventParticipantGolfStanding[] = [];
  raceResultRows: SportEventParticipantRaceResult[] = [];
  matchRows: SportEventRoundMatch[] = [];
  /** Each provider notification recorded against events (#1499). */
  readonly providerNotifications: ProviderNotificationReceipt[] = [];
  /** The jobs each status move or edit wrote with it (#1448, #1464). */
  backgroundJobs: BackgroundJobRequest[] = [];
  /** Active contest setups each sport league offers (#1823); a league not listed offers one. */
  contestSetupCounts = new Map<string, number>();
  /** Each Season's championship year (#2003), which an event reads through its Season. */
  seasonYears = new Map<string, number>([[IN_MEMORY_SEASON_ID, IN_MEMORY_SEASON_YEAR]]);

  id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  // --- Fixtures ---------------------------------------------------------------------

  addSport(sport: SportConfig['sport']): SportConfig {
    const row: SportConfig = stamp({ id: this.id('sport'), sport, ...sportRowKeys(sport), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' });
    this.sports.push(row);
    return row;
  }

  addSportLeague(sportId: string, name = 'PGA Tour'): SportLeague {
    const play = sportPlay(this.sports.find((row) => row.id === sportId)?.sport ?? Sport.GOLF);
    const sportLeague = stamp({ id: this.id('sport-league'), sportId, name, urlSegment: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...play, bracketAdvancement: BracketAdvancement.FIXED, roundNames: [], platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID, matchPeriodLayout: null, squaresFromRound: null, noun: null, displayName: null, displayOrder: null, currentSeasonId: IN_MEMORY_SEASON_ID, timeZone: 'UTC', isActive: true, selectedProviderMapping: null, autoReleaseDaysBeforeStart: 7 });
    this.sportLeagues.push(sportLeague);
    return sportLeague;
  }

  /**
   * A participant of the sport's first sport league (#1853: every participant belongs to one), or
   * of `overrides.sportLeagueId`. A sport with no league yet places the participant in the league an
   * event made by `addEvent` defaults to, so a field and its feed lookups agree.
   */
  /**
   * A participant of the sport's first league. `externalId` also maps it to that BALLDONTLIE feed
   * id (#2040: a feed id lives only on the participant's provider mapping).
   */
  addParticipant(sportId: string, name: string, { externalId, ...overrides }: Partial<Participant> & { externalId?: string } = {}): Participant {
    const sportLeagueId = this.sportLeagues.find((league) => league.sportId === sportId)?.id ?? UNPLACED_SPORT_LEAGUE_ID;
    const participant: Participant = stamp({
      id: this.id('participant'), sportLeagueId, name, participantType: 'INDIVIDUAL', status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' }, ranking: null, isTestData: false, ...overrides,
    });
    this.participants.push(participant);
    if (externalId !== undefined) {
      this.mappings.push(stamp({
        id: this.id('mapping'), providerId: TEST_PROVIDER_ROWS.BALLDONTLIE.id, providerName: TEST_PROVIDER_ROWS.BALLDONTLIE.name,
        participantId: participant.id, sportLeagueId, participantType: participant.participantType, externalId, mappedAt: participant.createdAt,
      }));
    }
    return participant;
  }

  /** The sport league a participant belongs to, for binding a provider mapping in that league. */
  leagueOf(participantId: string): string {
    return (this.participants.find((row) => row.id === participantId) as Participant).sportLeagueId;
  }

  /** Moves a participant into a sport league, with a ranking there. */
  affiliate(sportLeagueId: string, participantId: string, ranking: number | null = null): void {
    Object.assign(this.participants.find((row) => row.id === participantId) as Participant, { sportLeagueId, ranking });
  }

  /**
   * An event, by default on a placeholder sport league and in no slot.
   * Pass `sportLeagueId` (and `sportLeagueSeasonId`, `slotDefinitions`) to place it on a real one;
   * its championship year is its Season's.
   */
  addEvent({ providerRef, ...overrides }: Partial<SportEvent> & { providerRef?: ProviderEventRef } = {}): SportEvent {
    const event: SportEvent = stamp({
      id: this.id('event'), providerMappings: providerRef === undefined ? [] : [providerMappingOf(providerRef)], sport: 'GOLF', sportUrlSegment: 'golf', name: 'Open',
      slotDefinitions: [], sportLeagueSeasonId: IN_MEMORY_SEASON_ID, sportLeagueId: UNPLACED_SPORT_LEAGUE_ID,
      startDate: new Date('2026-06-04T12:00:00.000Z'), status: 'SCHEDULED',
      autoLifecycleEnabled: true, ...sportPlay(overrides.sport ?? Sport.GOLF), ...overrides,
      championshipYear: 0,
    });
    event.championshipYear = overrides.championshipYear ?? this.seasonYears.get(event.sportLeagueSeasonId) ?? IN_MEMORY_SEASON_YEAR;
    this.events.push(event);
    return event;
  }

  /** The event's id at the provider with this adapter id, if the provider has one for it. */
  externalIdAt(sportEventId: string, providerId: string): string | undefined {
    return this.events.find((row) => row.id === sportEventId)?.providerMappings
      .find((mapping) => providerSourceIdOf(mapping.providerCode) === providerId)?.externalId;
  }

  /** The adapter id of the provider the league's selected mapping names, if it has one. */
  private syncProviderIdOf(sportLeagueId: string): string | undefined {
    return this.sportLeagues.find((league) => league.id === sportLeagueId)?.selectedProviderMapping?.providerId;
  }

  /** Gives an event these rounds, through the round repository's one insert. */
  addRounds(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void> {
    return this.roundRepo().createMany(rounds.map((round) => ({ sportEventId, ...round })));
  }

  /** Gives an event these tiers, through the tier repository's one insert. */
  addTiers(sportEventId: string, tiers: readonly SportEventTierDefinition[]): Promise<void> {
    return this.tierRepo().createMany(tiers.map((tier) => ({ sportEventId, ...tier })));
  }

  addToField(sportEventId: string, participantId: string, overrides: Partial<SportEventParticipant> = {}): SportEventParticipant {
    const entry = stamp({ id: this.id('sep'), sportEventId, participantId, isActive: true, isPlayInPlace: false, metadata: {}, ...overrides });
    this.field.push(entry);
    return entry;
  }

  roundNumberOf(sportEventRoundId: string): number {
    return this.roundRows.find((round) => round.id === sportEventRoundId)?.roundNumber ?? 0;
  }

  // --- Ports ---------------------------------------------------------------------------

  sportRepo(): SportRepository {
    return {
      findById: async (id) => this.sports.find((sport) => sport.id === id) ?? null,
      findBySport: async (sport) => findSportRow(this.sports, sport) ?? null,
      findAll: async () => [...this.sports],
    };
  }

  sportLeagueRepo(): SportLeagueRepository {
    return {
      findById: async (id) => this.sportLeagues.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.sportLeagues.filter((row) => ids.includes(row.id)),
      findAll: async (filters) => this.sportLeagues.filter((row) => (
        (filters.sportId === undefined || row.sportId === filters.sportId)
        && (filters.isActive === undefined || row.isActive === filters.isActive)
      )),
      findEventSynced: async () => this.sportLeagues.filter((row) => row.isActive && row.selectedProviderMapping !== null),
      update: async (id, { syncProviderLeagueId, ...updates }) => {
        const row = this.sportLeagues.find((candidate) => candidate.id === id) as SportLeague;
        Object.assign(row, Object.fromEntries(Object.entries<unknown>(updates).filter(([, value]) => value !== undefined)));
        if (syncProviderLeagueId === null) row.selectedProviderMapping = null;
        // The store holds no provider leagues to map to: a test sets `selectedProviderMapping` itself.
        else if (syncProviderLeagueId !== undefined) throw new Error('The in-memory store cannot map a provider league; set selectedProviderMapping on the league.');
        return row;
      },
      deleteUnlessUsed: async () => { throw new Error('not used'); },
    };
  }

  participantRepo(): ParticipantRepository {
    return {
      findById: async (id) => this.participants.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.participants.filter((row) => ids.includes(row.id)),
      search: async () => [...this.participants],
      findMatchingAny: async (sportLeagueId, queries) => this.participants.filter((row) => row.sportLeagueId === sportLeagueId && queries.some((query) => (
        (query.id === undefined || row.id === query.id)
        && (query.externalId === undefined || this.mappings.some((mapping) => mapping.participantId === row.id && mapping.externalId === query.externalId))
        && (query.name === undefined || row.name.toLowerCase() === query.name.toLowerCase())
      ))),
      findBySportLeague: async (sportLeagueId, testData = false) => this.participants
        .filter((row) => row.sportLeagueId === sportLeagueId && row.isTestData === testData)
        .sort((left, right) => (left.ranking ?? Infinity) - (right.ranking ?? Infinity) || left.name.localeCompare(right.name)),
      updateRankings: async () => undefined,
      countBySportLeagues: async (ids) => new Map(ids.map((id) => [id, this.participants.filter((row) => row.sportLeagueId === id).length])),
      create: async () => { throw new Error('not used'); },
      createWithProviderMapping: async () => { throw new Error('not used'); },
      deleteUnfieldedTestParticipants: async () => { throw new Error('not used'); },
      update: async () => { throw new Error('not used'); },
      deleteUnlessOnAField: async () => { throw new Error('not used'); },
    };
  }

  /** The sport league a mapping lookup is scoped to holds the participant (#1853). */
  private inScope(participantId: string, scope: ProviderMappingScope): boolean {
    const participant = this.participants.find((row) => row.id === participantId);
    if (!participant) return false;
    if ('sportLeagueId' in scope) return participant.sportLeagueId === scope.sportLeagueId;
    if ('sportEventId' in scope) return this.events.find((event) => event.id === scope.sportEventId)?.sportLeagueId === participant.sportLeagueId;
    const league = this.sportLeagues.find((row) => row.id === participant.sportLeagueId);
    return this.sports.some((sport) => sport.id === league?.sportId && sport.sport === scope.sport);
  }

  mappingRepo(): ParticipantProviderMappingRepository {
    return {
      findByParticipant: async (participantId) => this.mappings.filter((row) => row.participantId === participantId),
      findByParticipantIds: async (participantIds) => this.mappings.filter((row) => participantIds.includes(row.participantId)),
      findByProviderExternalIds: async (providerCode, scope, externalIds) => this.mappings.filter((row) => row.providerId === TEST_PROVIDER_ROWS[providerCode].id
        && externalIds.includes(row.externalId) && this.inScope(row.participantId, scope)),
      findByProviderAndSportLeague: async (providerId, sportLeagueId) => this.mappings.filter((row) => row.providerId === providerId
        && row.sportLeagueId === sportLeagueId),
      findSyncProviderId: async () => { throw new Error('not used'); },
      bind: async (mapping) => {
        const provider = Object.values(TEST_PROVIDER_ROWS).find((candidate) => candidate.id === mapping.providerId);
        if (!provider) return null;
        this.mappings = this.mappings.filter((row) => !(row.providerId === mapping.providerId && row.externalId === mapping.externalId
          && row.sportLeagueId === mapping.sportLeagueId && row.participantType === mapping.participantType));
        const row = stamp({ id: this.id('mapping'), ...mapping, providerName: provider.name });
        this.mappings.push(row);
        return row;
      },
    };
  }

  sportEventRepo(): SportEventRepository {
    const count = (ids: readonly string[], of: (id: string) => number) => new Map(ids.map((id) => [id, of(id)]));
    return {
      findById: async (id) => this.events.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.events.filter((row) => ids.includes(row.id)),
      findLinks: async (ids) => this.events
        .filter((row) => ids.includes(row.id))
        .map(({ id, name, sportLeagueId }) => {
          const syncProviderId = this.syncProviderIdOf(sportLeagueId);
          const held = syncProviderId !== undefined && this.externalIdAt(id, syncProviderId) !== undefined;
          return { id, name, sportLeagueId, providerId: held ? syncProviderId : null };
        }),
      findByProviderRef: async (providerId, externalId) => this.events.find((row) => this.externalIdAt(row.id, providerId) === externalId) ?? null,
      findByProviderRefs: async (providerId, externalIds) => this.events.filter((row) => externalIds.includes(this.externalIdAt(row.id, providerId) ?? '')),
      // No sport filter: every event is golf while Sport has one member.
      findAll: async (filters) => this.events.filter((row) => (
        (filters.statuses === undefined || filters.statuses.includes(row.status))
        && (filters.sportLeagueId === undefined || row.sportLeagueId === filters.sportLeagueId)
        && (filters.sportLeagueSeasonId === undefined || row.sportLeagueSeasonId === filters.sportLeagueSeasonId)
        && (filters.slotDefinitionIds === undefined || row.slotDefinitions.some((definition) => filters.slotDefinitionIds?.includes(definition.id) === true))
        && (filters.q === undefined || row.name.toLowerCase().includes(filters.q.toLowerCase()))
        && (!filters.releasedOnly || row.status !== 'DRAFT')
        // An event's league the store never made (addEvent's default) counts as on.
        && (!filters.activeSportLeaguesOnly || !this.sportLeagues.some((league) => league.id === row.sportLeagueId && !league.isActive))
        && (filters.startsFrom === undefined || row.startDate >= filters.startsFrom)
        && (filters.startsBefore === undefined || row.startDate < filters.startsBefore)
      )),
      createMany: async (inputs: readonly SportEventCreate[]) => {
        // A Season slot belongs to at most one event: its unique key, raised the same way.
        const taken = new Set([...this.slotsByEvent.values()].flat().map((slot) => slot.id));
        for (const slotId of inputs.flatMap((input) => input.seasonSlotIds ?? [])) {
          if (taken.has(slotId)) {
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
              meta: { target: ['sport_league_season_id', 'sport_league_season_phase_slot_id'] },
            });
          }
          taken.add(slotId);
        }
        return inputs.map(({ seasonSlotIds, ...input }) => {
          const event = this.addEvent(input);
          const slots = this.seasonSlots.filter((slot) => seasonSlotIds?.includes(slot.id));
          if (slots.length > 0) this.slotsByEvent.set(event.id, slots);
          return event;
        });
      },
      update: async (id, updates: SportEventUpdate, options) => {
        const row = this.events.find((candidate) => candidate.id === id) as SportEvent;
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = nullable(value);
        }
        this.backgroundJobs.push(...(options?.jobs ?? []));
        return row;
      },
      transitionStatus: async (id, transition) => {
        const row = this.events.find((candidate) => candidate.id === id);
        if (!row || row.status !== transition.from) return null;
        row.status = transition.to;
        if (transition.endDate) row.endDate = transition.endDate;
        this.backgroundJobs.push(...(transition.jobs ?? []));
        return row;
      },
      delete: async (id) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === id).map((row) => row.id));
        this.field = this.field.filter((row) => row.sportEventId !== id);
        this.valuationRows = this.valuationRows.filter((row) => !entryIds.has(row.sportEventParticipantId));
        this.roundRows = this.roundRows.filter((row) => row.sportEventId !== id);
        this.tierRows = this.tierRows.filter((row) => row.sportEventId !== id);
        this.events = this.events.filter((row) => row.id !== id);
      },
      countParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => row.sportEventId === id).length),
      countUntieredActiveParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => (
        row.sportEventId === id
        && row.isActive
        && !this.valuationRows.some((valuation) => valuation.sportEventParticipantId === row.id && (valuation.sportEventTierId || valuation.tierAssignedSource))
      )).length),
      countUnpricedActiveParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => (
        row.sportEventId === id
        && row.isActive
        && !this.valuationRows.some((valuation) => valuation.sportEventParticipantId === row.id && valuation.price !== null)
      )).length),
      countTiers: async (ids) => count(ids, (id) => this.tierRows.filter((row) => row.sportEventId === id).length),
      findEmptyTierLabels: async (ids) => new Map(ids.map((id) => [id, this.tierRows
        .filter((tier) => tier.sportEventId === id && !this.valuationRows.some((valuation) => (
          valuation.sportEventTierId === tier.id
          && this.field.some((row) => row.id === valuation.sportEventParticipantId && row.isActive)
        )))
        .sort((left, right) => left.tierNumber - right.tierNumber)
        .map((tier) => tier.label)])),
      countContests: async (ids) => count(ids, (id) => this.contestsByEvent.get(id) ?? 0),
      findSlots: async (ids) => new Map(ids.map((id) => [id, [...(this.slotsByEvent.get(id) ?? [])]])),
      isTestEvent: async (id) => (this.events.some((event) => event.id === id) ? (this.slotsByEvent.get(id) ?? []).some((slot) => slot.isTestData) : null),
      countBySportLeagues: async (ids) => count(ids, (id) => this.events.filter((row) => row.sportLeagueId === id).length),
      sportLeagueHasLoadedBracket: async (sportLeagueId) => this.matchRows.some((match) => (
        this.events.some((event) => event.id === match.sportEventId && event.sportLeagueId === sportLeagueId)
      )),
      summarizeByProviders: async (providerIds) => new Map(providerIds.map((providerId) => {
        const events = this.events.filter((row) => this.externalIdAt(row.id, providerId) !== undefined);
        const changed = events.map((row) => row.updatedAt.getTime());
        return [providerId, {
          activeEventCount: events.filter((row) => row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS').length,
          lastChangedAt: changed.length > 0 ? new Date(Math.max(...changed)) : null,
        }];
      })),
      findLiveNotifiedEvents: async (query) => this.events
        .filter((row) => this.externalIdAt(row.id, query.providerId) !== undefined && row.sport === query.sport
          && (row.status === 'IN_PROGRESS' || (query.startedBy !== undefined && row.status === 'SCHEDULED'
            && row.autoLifecycleEnabled && row.startDate <= query.startedBy))
          && ('externalId' in query
            ? this.externalIdAt(row.id, query.providerId) === query.externalId
            // An event's mapping sits under its league's selected provider mapping, whose provider league names it.
            : this.sportLeagues.find((league) => league.id === row.sportLeagueId)?.selectedProviderMapping?.providerLeagueCode === query.providerLeagueCode))
        .map((row) => ({
          sportEventId: row.id,
          sport: row.sport,
          providerId: query.providerId,
          externalId: this.externalIdAt(row.id, query.providerId) as string,
          holdsGame: query.gameId !== undefined
            && this.matchRows.some((match) => match.sportEventId === row.id && match.externalGameId === query.gameId),
          inProgress: row.status === 'IN_PROGRESS',
        })),
      recordProviderNotification: async (receipt) => {
        this.providerNotifications.push(receipt);
      },
      findReleaseFacts: async (event) => ({
        scheduledRoundCount: this.roundRows.filter((round) => round.sportEventId === event.id).length,
        contestSetupCount: this.contestSetupCounts.get(event.sportLeagueId) ?? 1,
      }),
      findAutoReleaseCandidates: async (now, horizon) => this.events.flatMap((row) => {
        const league = this.sportLeagues.find((candidate) => candidate.id === row.sportLeagueId);
        if (row.status !== 'DRAFT' || row.startDate <= now || row.startDate > horizon) return [];
        if (!league?.isActive || league.selectedProviderMapping === null || league.autoReleaseDaysBeforeStart === null) return [];
        // A test event is released by hand only (#2004).
        if ((this.slotsByEvent.get(row.id) ?? []).some((slot) => slot.isTestData)) return [];
        return [{
          id: row.id, startDate: row.startDate,
          syncProviderId: league.selectedProviderMapping.providerId, autoReleaseDaysBeforeStart: league.autoReleaseDaysBeforeStart,
        }];
      }),
      recordAutoReleaseCheck: async (sportEventId, check) => {
        if (check === null) this.autoReleaseChecks.delete(sportEventId);
        else this.autoReleaseChecks.set(sportEventId, check);
      },
      findAutoReleaseCheck: async (sportEventId) => this.autoReleaseChecks.get(sportEventId) ?? null,
      findAutoLifecycleCandidates: async () => this.events.filter((row) => (
        row.autoLifecycleEnabled
        && (row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS' || row.status === 'POSTPONED')
      )),
    };
  }

  roundRepo(): SportEventRoundRepository {
    return {
      findBySportEvent: async (sportEventId) => this.roundRows
        .filter((row) => row.sportEventId === sportEventId)
        .sort((left, right) => left.roundNumber - right.roundNumber),
      findBySportEvents: async (sportEventIds) => new Map(sportEventIds.map((sportEventId) => [
        sportEventId,
        this.roundRows
          .filter((row) => row.sportEventId === sportEventId)
          .sort((left, right) => left.roundNumber - right.roundNumber),
      ])),
      createMany: async (rounds) => {
        for (const round of rounds) {
          this.roundRows.push(stamp({ id: this.id('round'), sportEventId: round.sportEventId, roundNumber: round.roundNumber, scheduledDate: round.scheduledDate, scheduledEndAt: round.scheduledEndAt ?? null }));
        }
      },
      reschedule: async (sportEventId, rounds) => {
        if (rounds.some((round) => !this.roundRows.some((row) => row.sportEventId === sportEventId && row.roundNumber === round.roundNumber))) {
          throw new Error('unknown round');
        }
        for (const round of rounds) {
          const row = this.roundRows.find((candidate) => candidate.sportEventId === sportEventId && candidate.roundNumber === round.roundNumber) as SportEventRound;
          row.scheduledDate = round.scheduledDate;
          if (round.scheduledEndAt !== undefined) row.scheduledEndAt = round.scheduledEndAt;
        }
      },
      findOrCreate: async (sportEventId, roundNumber) => {
        let row = this.roundRows.find((candidate) => candidate.sportEventId === sportEventId && candidate.roundNumber === roundNumber);
        if (!row) {
          row = stamp({ id: this.id('round'), sportEventId, roundNumber, scheduledDate: T0, scheduledEndAt: null });
          this.roundRows.push(row);
        }
        return row;
      },
      // The in-memory store keeps no match or participant-round rows: every round reads as scheduled.
      findResultFacts: async () => new Map(),
    };
  }

  fieldRepo(): SportEventParticipantRepository {
    const apply = (row: SportEventParticipant, patch: SportEventParticipantPatch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = nullable(value);
      }
    };
    const valuationOf = (id: string) => {
      let valuation = this.valuationRows.find((row) => row.sportEventParticipantId === id);
      if (!valuation) {
        valuation = stamp({ id: this.id('valuation'), sportEventParticipantId: id, sportEventTierId: null, tierOrderIndex: null, tierAssignedSource: null, price: null, priceAssignedSource: null });
        this.valuationRows.push(valuation);
      }
      return valuation;
    };
    const setPrice = (id: string, price: number | null) => {
      const valuation = valuationOf(id);
      valuation.price = price;
      valuation.priceAssignedSource = 'MANUAL';
    };
    const setTier = (id: string, tier: { sportEventTierId: string; tierOrderIndex: number }) => {
      Object.assign(valuationOf(id), tier, { tierAssignedSource: 'MANUAL' });
    };
    const bySeed = (sportEventId: string) => this.field
      .filter((row) => row.sportEventId === sportEventId)
      .sort((left, right) => (left.seedNumber ?? Infinity) - (right.seedNumber ?? Infinity));
    return {
      findById: async (id) => this.field.find((row) => row.id === id) ?? null,
      findByIds: async (ids) => this.field.filter((row) => ids.includes(row.id)),
      findBySportEvent: async (sportEventId) => bySeed(sportEventId),
      findBySportEvents: async (sportEventIds) => [...sportEventIds].sort().flatMap((sportEventId) => bySeed(sportEventId)),
      findFieldForEvent: async (sportEventId, sportLeagueId) => bySeed(sportEventId).map((entry) => this.fieldRow(entry, sportLeagueId)),
      findFieldsForEvents: async (events) => events.flatMap(({ sportEventId, sportLeagueId }) => bySeed(sportEventId).map((entry) => this.fieldRow(entry, sportLeagueId))),
      findFieldRow: async (sportEventId, sportEventParticipantId, sportLeagueId) => {
        const entry = this.field.find((row) => row.id === sportEventParticipantId && row.sportEventId === sportEventId);
        return entry ? this.fieldRow(entry, sportLeagueId) : null;
      },
      countDistinctParticipants: async (sportEventIds) => new Set(this.field
        .filter((row) => sportEventIds.includes(row.sportEventId))
        .map((row) => row.participantId)).size,
      createMany: async (sportEventId, rows: readonly SportEventParticipantCreate[], jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        for (const { participantId, ...patch } of rows) {
          apply(this.addToField(sportEventId, participantId), patch);
        }
      },
      updateMany: async (entries, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        if (entries.some((entry) => !this.field.some((row) => row.id === entry.id))) {
          throw new Error('unknown field row');
        }
        for (const entry of entries) {
          apply(this.field.find((row) => row.id === entry.id) as SportEventParticipant, entry.updates);
          if (entry.price !== undefined) setPrice(entry.id, entry.price);
          if (entry.tier !== undefined) setTier(entry.id, entry.tier);
        }
      },
      delete: async (id, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        this.field = this.field.filter((row) => row.id !== id);
        this.valuationRows = this.valuationRows.filter((row) => row.sportEventParticipantId !== id);
      },
      countPicks: async (id) => this.picksByEntry.get(id) ?? 0,
      fillPlayInSlot: async ({ id, winnerParticipantId, pairingParticipantId }, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const row = this.field.find((entry) => entry.id === id);
        const pairing = this.participants.find((participant) => participant.id === pairingParticipantId);
        if (!row || !pairing) throw new Error('unknown field row or participant');
        row.participantId = winnerParticipantId;
        row.isPlayInPlace = false;
        pairing.status = ParticipantStatus.INACTIVE;
      },
    };
  }

  tierRepo(): SportEventTierRepository {
    const findBySportEvents = async (sportEventIds: readonly string[]) => this.tierRows
      .filter((row) => sportEventIds.includes(row.sportEventId))
      .sort((left, right) => left.sportEventId.localeCompare(right.sportEventId) || left.tierNumber - right.tierNumber);
    return {
      findBySportEvent: async (sportEventId) => findBySportEvents([sportEventId]),
      findBySportEvents,
      createMany: async (tiers) => {
        for (const tier of tiers) this.tierRows.push(stamp({ id: this.id('tier'), ...tier }));
      },
      replace: async (sportEventId, tiers, reassignTo) => {
        const existing = this.tierRows.filter((row) => row.sportEventId === sportEventId);
        const keep = new Set(tiers.map((tier) => tier.tierKey));
        for (const tier of tiers) {
          const row = existing.find((candidate) => candidate.tierKey === tier.tierKey);
          if (row) Object.assign(row, tier);
          else this.tierRows.push(stamp({ id: this.id('tier'), sportEventId, ...tier }));
        }
        const removed = new Set(existing.filter((row) => !keep.has(row.tierKey)).map((row) => row.id));
        const target = this.tierRows.find((row) => row.sportEventId === sportEventId && row.tierKey === reassignTo);
        for (const valuation of this.valuationRows) {
          if (valuation.sportEventTierId && removed.has(valuation.sportEventTierId)) {
            valuation.sportEventTierId = target?.id ?? null;
            valuation.tierOrderIndex = null;
            if (!target) valuation.tierAssignedSource = null;
          }
        }
        this.tierRows = this.tierRows.filter((row) => !removed.has(row.id));
      },
      countValuations: async (sportEventId) => new Map(this.tierRows
        .filter((row) => row.sportEventId === sportEventId)
        .map((tier): [string, number] => [tier.id, this.valuationRows.filter((valuation) => valuation.sportEventTierId === tier.id).length])
        .filter(([, count]) => count > 0)),
    };
  }

  /** The tier profile each sport league names, by league id: what the tier service reads. */
  platformTierProfileRepo(): Pick<PlatformTierProfileRepository, 'findBySportLeague' | 'findById'> {
    return {
      findBySportLeague: async (sportLeagueId) => this.profileOf(this.platformTierProfiles, sportLeagueId, 'platformTierProfileId'),
      findById: async (id) => {
        const profile = this.platformTierProfiles.find((row) => row.id === id);
        return profile ? { ...profile } : null;
      },
    };
  }

  /** The pricing profile each sport league names, by league id. */
  platformPricingProfileRepo(): Pick<PlatformPricingProfileRepository, 'findBySportLeague'> {
    return { findBySportLeague: async (sportLeagueId) => this.profileOf(this.platformPricingProfiles, sportLeagueId, 'platformPricingProfileId') };
  }

  /** A league the store doesn't hold (an event's placeholder league) names the default profiles. */
  private profileOf<T extends { id: string }>(profiles: T[], sportLeagueId: string, key: 'platformTierProfileId' | 'platformPricingProfileId'): T | null {
    const league = this.sportLeagues.find((row) => row.id === sportLeagueId);
    const profileId = league ? league[key] : { platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID }[key];
    const profile = profiles.find((row) => row.id === profileId);
    return profile ? { ...profile } : null;
  }

  /** A sport league of its own naming a new tier profile of this layout (#1844), for events to sit in. */
  addLeagueWithPlatformTierProfile(layout: Pick<PlatformTierProfile, 'tierCount' | 'tierSize'> & Partial<Pick<PlatformTierProfile, 'lastTier' | 'lastTierMax'>>): SportLeague {
    const profile: PlatformTierProfile = stamp({ id: this.id('tier-profile'), code: `TIERS_${layout.tierCount}_OF_${layout.tierSize}`, name: `${layout.tierCount} tiers of ${layout.tierSize}`, lastTier: 'ALL_REMAINING' as const, lastTierMax: null, ...layout });
    this.platformTierProfiles.push(profile);
    return Object.assign(this.addSportLeague('sport-1', `League ${profile.id}`), { platformTierProfileId: profile.id });
  }

  /** A sport league of its own naming a new pricing profile with these values (#1844). */
  addLeagueWithPlatformPricingProfile(values: BudgetPricingProfile): SportLeague {
    const id = this.id('pricing-profile');
    const profile: PlatformPricingProfile = stamp({ id, code: id.toUpperCase().replaceAll('-', '_'), ...values });
    this.platformPricingProfiles.push(profile);
    return Object.assign(this.addSportLeague('sport-1', `League ${profile.id}`), { platformPricingProfileId: profile.id });
  }

  valuationRepo(): SportEventParticipantValuationRepository {
    const valuationFor = (sportEventParticipantId: string) => {
      let row = this.valuationRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
      if (!row) {
        row = stamp({ id: this.id('valuation'), sportEventParticipantId, sportEventTierId: null, tierOrderIndex: null, tierAssignedSource: null, price: null, priceAssignedSource: null });
        this.valuationRows.push(row);
      }
      return row;
    };
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.valuationRows.filter((row) => entryIds.has(row.sportEventParticipantId));
      },
      findBySportEvents: async (sportEventIds) => {
        const entryIds = new Set(this.field.filter((row) => sportEventIds.includes(row.sportEventId)).map((row) => row.id));
        return this.valuationRows.filter((row) => entryIds.has(row.sportEventParticipantId));
      },
      assignTiers: async (assignments) => {
        for (const assignment of assignments) {
          Object.assign(valuationFor(assignment.sportEventParticipantId), {
            sportEventTierId: assignment.sportEventTierId,
            tierOrderIndex: assignment.tierOrderIndex,
            tierAssignedSource: assignment.source,
          });
        }
      },
      assignEventTiers: async ({ sportEventId, tierConfig, assignments }) => {
        for (const assignment of assignments) {
          Object.assign(valuationFor(assignment.sportEventParticipantId), {
            sportEventTierId: assignment.sportEventTierId,
            tierOrderIndex: assignment.tierOrderIndex,
            tierAssignedSource: assignment.source,
          });
        }
        Object.assign(this.events.find((row) => row.id === sportEventId) as SportEvent, { tierConfig });
      },
      assignEventPrices: async ({ sportEventId, pricingConfig, assignments }) => {
        for (const assignment of assignments) {
          Object.assign(valuationFor(assignment.sportEventParticipantId), { price: assignment.price, priceAssignedSource: assignment.source });
        }
        Object.assign(this.events.find((row) => row.id === sportEventId) as SportEvent, { pricingConfig });
      },
    };
  }

  /** One field row with everything the field read carries, as copies. */
  private fieldRow(entry: SportEventParticipant, sportLeagueId: string): SportEventParticipantView {
    const standing = this.standingRows.find((row) => row.sportEventParticipantId === entry.id);
    const standingGolf = standing && this.golfStandingRows.find((row) => row.standingId === standing.id);
    const valuation = this.valuationRows.find((row) => row.sportEventParticipantId === entry.id);
    const raceResult = this.raceResultRows.find((row) => row.sportEventParticipantId === entry.id);
    return {
      entry: { ...entry },
      participant: { ...(this.participants.find((participant) => participant.id === entry.participantId) as Participant) },
      valuation: valuation ? { ...valuation } : null,
      standing: standing ? { standing: { ...standing }, golf: standingGolf ? { ...standingGolf } : null } : null,
      rounds: this.participantRoundRows
        .filter((row) => row.sportEventParticipantId === entry.id)
        .map((row) => ({ ...row, roundNumber: this.roundNumberOf(row.sportEventRoundId) }))
        .sort((left, right) => left.roundNumber - right.roundNumber)
        .map((round) => {
          const golf = this.golfRoundRows.find((row) => row.participantRoundId === round.id);
          return {
            round,
            golf: golf ? { ...golf } : null,
          };
        }),
      raceResult: raceResult ? { ...raceResult } : null,
      matches: this.matchRows
        .filter((match) => match.homeSportEventParticipantId === entry.id || match.awaySportEventParticipantId === entry.id)
        .sort((left, right) => left.matchNumber - right.matchNumber)
        .map((match) => ({ ...match, periodScores: [...match.periodScores].sort((left, right) => left.periodNumber - right.periodNumber) })),
      affiliatedWithSportLeague: this.participants.some((row) => row.id === entry.participantId && row.sportLeagueId === sportLeagueId),
    };
  }

  // Reads and writes hand back copies, as a database does: a caller holding an earlier read
  // must not see it change under a later write.
  private golfRoundResults(): GolfRoundResult[] {
    return this.participantRoundRows.flatMap((row) => {
      const golf = this.golfRoundRows.find((candidate) => candidate.participantRoundId === row.id);
      return golf ? [{ participantRound: { ...row, roundNumber: this.roundNumberOf(row.sportEventRoundId) }, golf: { ...golf } }] : [];
    }).sort((left, right) => left.participantRound.roundNumber - right.participantRound.roundNumber);
  }

  private golfStandingResults(): GolfStandingResult[] {
    return this.standingRows.flatMap((standing) => {
      const golf = this.golfStandingRows.find((candidate) => candidate.standingId === standing.id);
      return golf ? [{ standing: { ...standing }, golf: { ...golf } }] : [];
    });
  }

  private writeGolfRound(write: GolfRoundWrite): GolfRoundResult {
    let core = this.participantRoundRows.find((row) => row.sportEventParticipantId === write.sportEventParticipantId && row.sportEventRoundId === write.sportEventRoundId);
    if (!core) {
      core = stamp({ id: this.id('participant-round'), sportEventParticipantId: write.sportEventParticipantId, sportEventRoundId: write.sportEventRoundId, status: write.status, completedAt: write.completedAt });
      this.participantRoundRows.push(core);
    }
    Object.assign(core, { status: write.status, completedAt: write.completedAt });
    let golf = this.golfRoundRows.find((row) => row.participantRoundId === core.id);
    if (!golf) {
      golf = stamp({ id: this.id('golf-round'), participantRoundId: core.id, strokes: 0, scoreToPar: 0, thru: null });
      this.golfRoundRows.push(golf);
    }
    Object.assign(golf, { strokes: write.strokes, scoreToPar: write.scoreToPar, thru: write.thru });
    return { participantRound: { ...core, roundNumber: this.roundNumberOf(core.sportEventRoundId) }, golf: { ...golf } };
  }

  golfRoundRepo(): SportEventParticipantGolfRoundRepository {
    return {
      findBySportEventRound: async (id) => this.golfRoundResults().filter((result) => result.participantRound.sportEventRoundId === id),
      findBySportEventParticipants: async (ids) => this.golfRoundResults().filter((result) => ids.includes(result.participantRound.sportEventParticipantId)),
      upsert: async (write) => this.writeGolfRound(write),
      upsertMany: async (writes) => {
        if (writes.some((write) => !this.field.some((row) => row.id === write.sportEventParticipantId))) {
          throw new Error('unknown field row');
        }
        return writes.map((write) => this.writeGolfRound(write));
      },
    };
  }

  golfStandingRepo(): SportEventParticipantGolfStandingRepository {
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
        return this.golfStandingResults().filter((result) => entryIds.has(result.standing.sportEventParticipantId));
      },
      findBySportEventParticipants: async (ids) => this.golfStandingResults().filter((result) => ids.includes(result.standing.sportEventParticipantId)),
      upsertMany: async (writes) => writes.map((write) => this.writeGolfStanding(write)),
      updateRanks: async (ranks, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        for (const rank of ranks) {
          const standing = this.standingRows.find((row) => row.id === rank.standingId);
          if (!standing) throw new Error('unknown standing');
          Object.assign(standing, { position: rank.position, displayPosition: rank.displayPosition });
        }
      },
    };
  }

  private writeGolfStanding(write: GolfStandingWrite): GolfStandingResult {
    let standing = this.standingRows.find((row) => row.sportEventParticipantId === write.sportEventParticipantId);
    if (!standing) {
      standing = stamp({ id: this.id('standing'), sportEventParticipantId: write.sportEventParticipantId, position: null, displayPosition: null, status: write.status, asOf: write.asOf, currentRound: write.currentRound });
      this.standingRows.push(standing);
    }
    Object.assign(standing, { status: write.status, asOf: write.asOf, currentRound: write.currentRound });
    let golf = this.golfStandingRows.find((row) => row.standingId === standing.id);
    if (!golf) {
      golf = stamp({ id: this.id('golf-standing'), standingId: standing.id, eventScoreToPar: 0, eventStrokes: 0, currentRoundThru: null });
      this.golfStandingRows.push(golf);
    }
    Object.assign(golf, { eventScoreToPar: write.eventScoreToPar, eventStrokes: write.eventStrokes, currentRoundThru: write.currentRoundThru });
    return { standing: { ...standing }, golf: { ...golf } };
  }

  matchRepo(): SportEventRoundMatchRepository {
    const findBySportEvents = async (sportEventIds: readonly string[]) => this.matchRows
      .filter((row) => sportEventIds.includes(row.sportEventId))
      .sort((left, right) => left.sportEventId.localeCompare(right.sportEventId) || left.matchNumber - right.matchNumber)
      .map((row) => ({ ...row, periodScores: [...row.periodScores].sort((left, right) => left.periodNumber - right.periodNumber) }));
    const requireRow = (id: string) => {
      const row = this.matchRows.find((match) => match.id === id);
      if (!row) throw new Error('unknown match');
      return row;
    };
    return {
      findById: async (id) => {
        const row = this.matchRows.find((match) => match.id === id);
        return row ? { ...row, periodScores: [...row.periodScores].sort((left, right) => left.periodNumber - right.periodNumber) } : null;
      },
      findBySportEvent: async (sportEventId) => findBySportEvents([sportEventId]),
      findBySportEvents,
      replaceBracket: async (sportEventId, matches, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const roundNumbers = new Set(this.roundRows.filter((round) => round.sportEventId === sportEventId).map((round) => round.roundNumber));
        if (matches.some((match) => !roundNumbers.has(match.roundNumber))) throw new Error('unknown round');
        this.matchRows = [
          ...this.matchRows.filter((row) => row.sportEventId !== sportEventId),
          ...matches.map((match) => stamp({
            ...match,
            sportEventId,
            homeSpread: null,
            externalGameId: null,
            resultSource: null,
            completedAt: null,
            periodScores: [],
            status: MatchStatus.SCHEDULED,
            winnerSide: null,
            homeScore: null,
            awayScore: null,
            homeShootoutScore: null,
            awayShootoutScore: null, ending: MatchEnding.PLAYED,
          })),
        ];
      },
      linkGames: async (links) => {
        for (const { id, externalGameId } of links) {
          const row = this.matchRows.find((match) => match.id === id);
          if (!row) throw new Error('unknown match');
          row.externalGameId = externalGameId;
        }
      },
      applyLiveScores: async (scores) => {
        for (const { id, ...values } of scores) {
          const row = this.matchRows.find((match) => match.id === id);
          if (!row) throw new Error('unknown match');
          // As the Prisma adapter does: a match with a result or cancelled keeps it.
          if (isMatchUnplayed(row.status) || row.status === MatchStatus.IN_PROGRESS) Object.assign(row, values);
        }
      },
      placeSides: async (sides, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        for (const { id, ...placed } of sides) {
          const row = this.matchRows.find((match) => match.id === id);
          if (!row) throw new Error('unknown match');
          Object.assign(row, placed);
        }
      },
      update: async (id, patch, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const row = this.matchRows.find((match) => match.id === id);
        if (!row) throw new Error('unknown match');
        Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
      },
      applyResult: async ({ result, sideFill, standings, jobs }) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const { id, ...values } = result;
        const row = this.matchRows.find((match) => match.id === id);
        if (!row) throw new Error('unknown match');
        Object.assign(row, values);
        if (sideFill) {
          const next = this.matchRows.find((match) => match.id === sideFill.id);
          if (!next) throw new Error('unknown match');
          if (sideFill.side === MatchSide.HOME) next.homeSportEventParticipantId = sideFill.sportEventParticipantId;
          else next.awaySportEventParticipantId = sideFill.sportEventParticipantId;
        }
        for (const { sportEventParticipantId, ...standing } of standings) {
          let stored = this.standingRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
          if (!stored) {
            stored = stamp({ id: this.id('standing'), sportEventParticipantId, ...standing });
            this.standingRows.push(stored);
          }
          Object.assign(stored, standing);
        }
      },
      savePeriodScore: async (sportEventRoundMatchId, score, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const row = requireRow(sportEventRoundMatchId);
        row.periodScores = [...row.periodScores.filter((other) => other.periodNumber !== score.periodNumber), { ...score }];
      },
    };
  }

  raceResultRepo(): SportEventParticipantRaceResultRepository {
    const entryIdsOf = (sportEventId: string) => new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
    return {
      findBySportEvent: async (sportEventId) => {
        const entryIds = entryIdsOf(sportEventId);
        return this.raceResultRows
          .filter((row) => entryIds.has(row.sportEventParticipantId))
          .sort((left, right) => left.sportEventParticipantId.localeCompare(right.sportEventParticipantId))
          .map((row) => ({ ...row }));
      },
      applyResults: async (sportEventId, { results, isOfficial, standings, jobs }) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const entryIds = entryIdsOf(sportEventId);
        if ([...results, ...standings].some((write) => !entryIds.has(write.sportEventParticipantId))) {
          throw new Error('unknown field row');
        }
        for (const { sportEventParticipantId, ...values } of results) {
          let row = this.raceResultRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
          if (!row) {
            row = stamp({ id: this.id('race-result'), sportEventParticipantId, ...values, isOfficial });
            this.raceResultRows.push(row);
          }
          Object.assign(row, values);
        }
        for (const row of this.raceResultRows) {
          if (entryIds.has(row.sportEventParticipantId)) row.isOfficial = isOfficial;
        }
        for (const { sportEventParticipantId, ...values } of standings) {
          let standing = this.standingRows.find((row) => row.sportEventParticipantId === sportEventParticipantId);
          if (!standing) {
            standing = stamp({ id: this.id('standing'), sportEventParticipantId, ...values });
            this.standingRows.push(standing);
          }
          Object.assign(standing, values);
        }
      },
    };
  }
}
