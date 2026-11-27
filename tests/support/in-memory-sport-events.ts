/**
 * An in-memory implementation of the event-core and FIELD Game ports (#236, #622, #2008), for
 * service tests that assert what a service leaves behind rather than which repository
 * calls it made (testing-rules §1D, the plan's test layering). The Prisma adapters
 * behind the same ports are tested against Postgres in sport-event-repositories.integration.
 *
 * Deliberately simple: ids are sequential, "all or none" writes validate every row
 * before applying any, and orderings follow each port's documented contract.
 */

import type {
  ParticipantProviderMappingRepository,
  ProviderMappingScope,
  ParticipantRepository,
  SportEventCreate,
  SportEventParticipantCreate,
  SportEventParticipantPatch,
  FieldGameRepository,
  FieldSideResult,
  ProviderNotificationReceipt,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventParticipantView,
  GameSideScoreWrite,
  MatchSideTeam,
  SportEventRoundMatchGameRepository,
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
  AutoLifecycleCandidate,
} from '@poolmaster/shared/db';
import { TEST_PROVIDER_ROWS } from './balldontlie-provider-rows';
import type { SportEventBracketServiceDeps } from '../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { compareMatchPlaces, MatchEnding, SeasonSlotStatus, SeriesFormat, SlotKind, SlotPairing, SlotWindowStatus, type SlotWindow, findSportRow, providerSourceIdOf, requireProviderCodeOfSourceId, type ProviderEventRef, type SportEventProviderMapping, HomeAway, isMatchUnplayed, MatchSideOutcome, MatchStatus, PeriodKind, PeriodKindOrder, Sport, FieldOrderBasis, TierProfileType, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import { sportEventSlots, sportPlay } from './sport-play';
import type {
  AutoReleaseCheck,
  BackgroundJobRequest,
  Participant,
  ParticipantProviderMapping,
  SportConfig,
  SportEvent,
  SportEventRoundMatch,
  SportEventRoundMatchGame,
  SportEventParticipant,
  SportEventParticipantStanding,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventRoundSlot,
  SlotPeriods,
  SportEventTier,
  SportLeague,
  BudgetPricingProfile,
  PlatformPricingProfile,
  PlatformTierProfile,
  SportLeagueSeasonSlot,
  EqualGroupsLayout,
  TierRange,
} from '@poolmaster/shared/domain';
import { sportRowKeys } from './sport-rows';

const T0 = new Date('2026-01-01T00:00:00.000Z');

/** A round's slot as the round read gives it (#2006). */
function roundSlotOf({ id, slotDefinitionId, name, slotKind, weekNumber, seriesGames, pairing }: SportLeagueSeasonSlot, periods: SlotPeriods | null): SportEventRoundSlot {
  return { seasonSlotId: id, slotDefinitionId, name, slotKind, weekNumber, seriesGames, pairing, canEndTied: false, periods, tiebreakerMatchId: null };
}

/** A Game read back, as a database hands it: a copy, its side results in side order. */
function copyGame(game: SportEventRoundMatchGame): SportEventRoundMatchGame {
  return {
    ...game,
    sideResults: [...game.sideResults]
      .sort((left, right) => left.sideNumber - right.sideNumber)
      .map((result) => ({
        ...result,
        periodScores: [...result.periodScores]
          .sort((left, right) => PeriodKindOrder.orderIndex[left.kind] - PeriodKindOrder.orderIndex[right.kind] || left.periodNumber - right.periodNumber)
          .map((period) => ({ ...period })),
      })),
  };
}

/** A match read back: a copy, with its sides and its Games in order. */
function copyMatch(match: SportEventRoundMatch): SportEventRoundMatch {
  return {
    ...match,
    sides: [...match.sides].sort((left, right) => left.sideNumber - right.sideNumber).map((side) => ({ ...side })),
    games: [...match.games].sort((left, right) => left.gameNumber - right.gameNumber).map(copyGame),
  };
}

/** A Game with each side's score written, where it played when given, and its shoot-out or none (as the Prisma adapter's writeSideScores). */
function withSideScores(match: SportEventRoundMatch, game: SportEventRoundMatchGame, scores: readonly (GameSideScoreWrite & { homeAway?: HomeAway })[]): SportEventRoundMatchGame {
  const results = [...game.sideResults];
  for (const { sideNumber, score, shootoutScore, homeAway } of scores) {
    const side = match.sides.find((each) => each.sideNumber === sideNumber);
    if (!side) throw new Error('unknown side');
    const index = results.findIndex((result) => result.sideNumber === sideNumber);
    const stored = index === -1 ? { sportEventRoundMatchSideId: side.id, sideNumber, score: null, homeAway: HomeAway.NONE, position: null, startPosition: null, scoreToPar: null, periodsCompleted: null, status: null, periodScores: [] } : results[index];
    const written = {
      ...stored,
      score,
      homeAway: homeAway ?? stored.homeAway,
      periodScores: [
        ...stored.periodScores.filter((period) => period.kind !== PeriodKind.SHOOTOUT),
        ...(shootoutScore === null ? [] : [{ kind: PeriodKind.SHOOTOUT, periodNumber: 1, score: shootoutScore }]),
      ],
    };
    if (index === -1) results.push(written);
    else results[index] = written;
  }
  return { ...game, sideResults: results };
}

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

/** Every source, odds first: the order every seeded profile but the NFL's lists (#2160). */
export const ODDS_FIRST: readonly FieldOrderBasis[] = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];

export class InMemorySportEvents {
  private sequence = 0;
  sports: SportConfig[] = [];
  sportLeagues: SportLeague[] = [];
  /** The profiles sport leagues name (#1844): golf's six tiers of ten, and Standard pricing. */
  platformTierProfiles: PlatformTierProfile[] = [stamp({ id: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, code: 'TIERS_6_OF_10', name: '6 tiers of 10', description: 'A profile for this test.', sources: [...ODDS_FIRST], type: TierProfileType.EQUAL_GROUPS, tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING' as const, lastTierMax: null })];
  platformPricingProfiles: PlatformPricingProfile[] = [stamp({ id: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID, code: 'STANDARD', name: 'Standard', description: 'A profile for this test.', sources: [...ODDS_FIRST], salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 })];
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
  /** Each Season slot's periods, from its definition (#2047), by its id; a slot a test leaves out keeps no score by period. */
  slotPeriods = new Map<string, SlotPeriods>();

  /**
   * A Season slot of the league's current Season (#2004): a test slot unless `isTestData` is
   * false, starting `startsAt`. Answers its id.
   */
  addTestSlot(sportLeague: Pick<SportLeague, 'id' | 'currentSeasonId'>, startsAt: Date, overrides: Partial<SportLeagueSeasonSlot & { sportLeagueSeasonId: string }> = {}): string {
    const id = this.id('season-slot');
    this.seasonSlots.push({
      id, slotDefinitionId: 'slot-definition', key: 'TEST_EVENT', slotKind: SlotKind.TOURNAMENT, weekNumber: null, name: null,
      startsAt, endsAt: null, status: SeasonSlotStatus.SCHEDULED, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
      isTestData: true, label: id, window: null, sportLeagueId: sportLeague.id, sportLeagueSeasonId: sportLeague.currentSeasonId ?? IN_MEMORY_SEASON_ID,
      ...overrides,
    });
    return id;
  }

  /** The PROVIDER_CODE value each synced slot's definition is mapped by, as `findSyncSlots` reads it (#2005). */
  slotProviderCodes = new Map<string, string>();
  /** The synced slots an active contest template lists (#2005). */
  templateCoveredSlotIds = new Set<string>();
  /** The league's NAME_PATTERN mappings, as `findSlotNamePatterns` reads them (#2011). */
  slotNamePatterns: Array<{ slotDefinitionId: string; pattern: string }> = [];
  /** The tournament code each Season slot was linked to by name (#2011). */
  slotLinks = new Map<string, string>();
  /** The slot definitions a template lists, so a Season slot created by name is covered (#2011). */
  templateCoveredDefinitionIds = new Set<string>();
  /** Slot definitions whose phase the Season lacks: a name match on one makes no Season slot (#2011). */
  definitionsWithoutSeasonPhase = new Set<string>();

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

  /** The synced slots placed by date window, each with its window or none (#2012). */
  slotWindows = new Map<string, SlotWindow | null>();

  /** Each synced slot's Season competition, where a test sets one; every other slot is in its Season's one competition. */
  slotCompetitions = new Map<string, string>();

  /** Each Season competition's proper name, where a test sets one (#2154). */
  competitionNames = new Map<string, string>();

  /** The synced slots matched REST_OF_PHASE (#2154): their window takes the games no other slot places. */
  restOfPhaseSlotIds = new Set<string>();

  /** The provider game ids the sync placed in each Season slot (#2154), by slot id. */
  placedGameIds = new Map<string, string[]>();

  /** A synced slot placed by date window, with `window` or none, listed by a template (#2012). Answers its id. */
  addWindowSlot(sportLeague: Pick<SportLeague, 'id' | 'currentSeasonId'>, key: string, window: SlotWindow | null): string {
    const id = this.addSyncSlot(sportLeague, null);
    const slot = this.seasonSlots.find((candidate) => candidate.id === id);
    if (slot) Object.assign(slot, { key, window });
    this.slotWindows.set(id, window);
    return id;
  }

  /** The Season slot reads an event create makes, and the events sync's slot reads and writes. */
  seasonRepo(): Pick<SportLeagueSeasonRepository, 'findSlot' | 'findSlotsByIds' | 'findSyncSlots' | 'findSlotNamePatterns' | 'linkNameMatchedSlots' | 'recordSyncedSlots'> {
    const ownerOf = (slotId: string) => [...this.slotsByEvent.entries()].find(([, slots]) => slots.some((each) => each.id === slotId))?.[0] ?? null;
    return {
      findSyncSlots: async (sportLeagueSeasonId) => this.seasonSlots
        .filter((slot) => slot.sportLeagueSeasonId === sportLeagueSeasonId && !slot.isTestData)
        .map((slot) => ({
          seasonSlotId: slot.id,
          slotDefinitionId: slot.slotDefinitionId,
          key: slot.key,
          providerCode: this.slotProviderCodes.get(slot.id) ?? null,
          linkedCode: this.slotLinks.get(slot.id) ?? null,
          coveredByTemplate: this.templateCoveredSlotIds.has(slot.id) || this.templateCoveredDefinitionIds.has(slot.slotDefinitionId),
          sportEventId: ownerOf(slot.id),
          seasonCompetitionId: this.slotCompetitions.get(slot.id) ?? `competition-of-${slot.sportLeagueSeasonId}`,
          competitionName: this.competitionNames.get(this.slotCompetitions.get(slot.id) ?? '') ?? null,
          restOfPhase: this.restOfPhaseSlotIds.has(slot.id),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          placedByWindow: this.slotWindows.has(slot.id),
          window: this.slotWindows.get(slot.id) ?? null,
        })),
      findSlotNamePatterns: async () => [...this.slotNamePatterns],
      linkNameMatchedSlots: async ({ sportLeagueId, sportLeagueSeasonId, links, creates }) => {
        const taken = new Set(this.slotLinks.values());
        const link = (seasonSlotId: string, code: string) => {
          if (this.slotLinks.has(seasonSlotId) || taken.has(code)) return;
          this.slotLinks.set(seasonSlotId, code);
          taken.add(code);
        };
        for (const each of links) link(each.seasonSlotId, each.code);
        const competitionMissing: string[] = [];
        for (const create of creates) {
          if (this.definitionsWithoutSeasonPhase.has(create.slotDefinitionId)) {
            competitionMissing.push(create.slotDefinitionId);
            continue;
          }
          const id = this.addTestSlot({ id: sportLeagueId, currentSeasonId: sportLeagueSeasonId }, new Date(0), {
            isTestData: false, label: null, startsAt: null, slotDefinitionId: create.slotDefinitionId, key: create.slotDefinitionId, sportLeagueSeasonId,
          });
          link(id, create.code);
        }
        return { competitionMissing };
      },
      recordSyncedSlots: async ({ eventSlots, slotDates, confirmedWindows, placedGames }) => {
        for (const { seasonSlotId, externalIds } of placedGames?.bySlot ?? []) {
          for (const [slotId, ids] of this.placedGameIds) this.placedGameIds.set(slotId, ids.filter((id) => !externalIds.includes(id)));
          this.placedGameIds.set(seasonSlotId, [...externalIds]);
        }
        for (const slotId of confirmedWindows) {
          const window = this.slotWindows.get(slotId);
          if (window) this.slotWindows.set(slotId, { ...window, status: SlotWindowStatus.CONFIRMED });
        }
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
      findSlot: async (id) => this.slotWithEvent(id),
      findSlotsByIds: async (ids) => ids.flatMap((id) => {
        const found = this.slotWithEvent(id);
        return found === null ? [] : [found];
      }),
    };
  }
  picksByEntry = new Map<string, number>();
  roundRows: SportEventRound[] = [];
  field: SportEventParticipant[] = [];
  tierRows: SportEventTier[] = [];
  valuationRows: SportEventParticipantValuation[] = [];
  standingRows: SportEventParticipantStanding[] = [];
  /**
   * Each competitor's side result in its event's FIELD Games (#2008): a race's one Game, a golf
   * round's, with the round and the Game's status it is read with.
   */
  fieldSideRows: Array<FieldSideResult & { sportEventId: string; sportEventRoundId: string; gameCompletedAt: Date | null }> = [];
  /** Each match with its sides and its Games (#2007, #2046). */
  matchRows: SportEventRoundMatch[] = [];
  /** Every match's Games (#2007): read from `matchRows`, where they are kept. */
  get gameRows(): SportEventRoundMatchGame[] {
    return this.matchRows.flatMap((match) => match.games);
  }
  gameMappings: Array<{ sportEventRoundMatchGameId: string; providerCode: string; externalId: string }> = [];
  /** Each provider notification recorded against events (#1499). */
  readonly providerNotifications: ProviderNotificationReceipt[] = [];
  /** The jobs each status move or edit wrote with it (#1448, #1464). */
  backgroundJobs: BackgroundJobRequest[] = [];
  /** Active contest setups each sport league offers (#1823); a league not listed offers one. */
  contestSetupCounts = new Map<string, number>();
  /** Each event's tiered and budget setups, by event id; an event not listed has one. */
  rosterSetupCounts = new Map<string, number>();
  /** Each Season's championship year (#2003), which an event reads through its Season. */
  seasonYears = new Map<string, number>([[IN_MEMORY_SEASON_ID, IN_MEMORY_SEASON_YEAR]]);

  id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  // --- Fixtures ---------------------------------------------------------------------

  addSport(sport: SportConfig['sport']): SportConfig {
    const row: SportConfig = stamp({ id: this.id('sport'), sport, ...sportRowKeys(sport) });
    this.sports.push(row);
    return row;
  }

  addSportLeague(sportId: string, name = 'PGA Tour'): SportLeague {
    const play = sportPlay(this.sports.find((row) => row.id === sportId)?.sport ?? Sport.GOLF);
    const sportLeague = stamp({ id: this.id('sport-league'), sportId, name, urlSegment: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ...play, platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID, matchPeriodLayout: null, squaresFromRound: null, noun: null, displayOrder: null, currentSeasonId: IN_MEMORY_SEASON_ID, timeZone: 'UTC', isActive: true, selectedProviderMapping: null, autoReleaseDaysBeforeStart: 7 });
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
      slotDefinitions: sportEventSlots(overrides.sport ?? Sport.GOLF), sportLeagueSeasonId: IN_MEMORY_SEASON_ID, sportLeagueId: UNPLACED_SPORT_LEAGUE_ID,
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

  /** A Season slot with its Season and the event on it, as `findSlot` answers. */
  private slotWithEvent(id: string) {
    const slot = this.seasonSlots.find((candidate) => candidate.id === id);
    if (!slot) return null;
    const owner = [...this.slotsByEvent.entries()].find(([, slots]) => slots.some((each) => each.id === id));
    const { sportLeagueId, sportLeagueSeasonId, ...seasonSlot } = slot;
    return { slot: seasonSlot, sportLeagueId, sportLeagueSeasonId, sportEventId: owner?.[0] ?? null };
  }

  /**
   * The event's one slot (#2006): the slot it was made on, else a slot of its Season the sync keeps,
   * given to it now (an event a test added straight to the store has none), so it stays no test
   * event. Throws for an event of several.
   */
  eventSlotOf(sportEventId: string, overrides: Partial<SportLeagueSeasonSlot> = {}): SportLeagueSeasonSlot {
    const slots = this.slotsByEvent.get(sportEventId) ?? [];
    if (slots.length > 1) throw new Error(`Sport event ${sportEventId} has ${String(slots.length)} slots; name the round's.`);
    // poolmaster-allow-position: the event's one slot
    if (slots.length === 1) return slots[0];
    const event = this.events.find((row) => row.id === sportEventId);
    if (!event) throw new Error(`unknown sport event ${sportEventId}`);
    const id = this.addTestSlot({ id: event.sportLeagueId, currentSeasonId: event.sportLeagueSeasonId }, event.startDate, { isTestData: false, label: null, ...overrides });
    const slot = this.seasonSlots.find((candidate) => candidate.id === id) as SportLeagueSeasonSlot;
    this.slotsByEvent.set(sportEventId, [slot]);
    return slot;
  }

  private roundSlotOfEvent(sportEventId: string): SportEventRoundSlot {
    const slot = this.eventSlotOf(sportEventId);
    return roundSlotOf(slot, this.slotPeriods.get(slot.id) ?? null);
  }

  /**
   * Gives an event these rounds, through the round repository's one insert: all in its one slot,
   * or each in the slot `seasonSlotIdOf` names for it.
   */
  addRounds(sportEventId: string, rounds: readonly SportEventRoundSchedule[], seasonSlotIdOf?: (roundNumber: number) => string): Promise<void> {
    const seasonSlotOf = seasonSlotIdOf ?? (() => this.eventSlotOf(sportEventId).id);
    return this.roundRepo().createMany(rounds.map((round) => ({ sportEventId, seasonSlotId: seasonSlotOf(round.roundNumber), ...round })));
  }

  /**
   * Gives an event one slot per round, each of the kind given in order (a bracket: its FINAL last),
   * slots the sync keeps unless `isTestData` says otherwise. Answers the slots' ids, for `addRounds`.
   */
  addRoundSlots(sportEventId: string, slots: ReadonlyArray<Partial<SportLeagueSeasonSlot> & { slotKind: SlotKind }>): string[] {
    const event = this.events.find((row) => row.id === sportEventId);
    if (!event) throw new Error(`unknown sport event ${sportEventId}`);
    const added = slots.map((overrides) => {
      const id = this.addTestSlot({ id: event.sportLeagueId, currentSeasonId: event.sportLeagueSeasonId }, event.startDate, { isTestData: false, label: null, ...overrides });
      return this.seasonSlots.find((candidate) => candidate.id === id) as SportLeagueSeasonSlot;
    });
    this.slotsByEvent.set(sportEventId, [...(this.slotsByEvent.get(sportEventId) ?? []), ...added]);
    return added.map((slot) => slot.id);
  }

  /** Gives an event these tiers, through the tier repository's one insert. */
  addTiers(sportEventId: string, tiers: readonly SportEventTierDefinition[]): Promise<void> {
    return this.tierRepo().createMany(tiers.map((tier) => ({ sportEventId, ...tier })));
  }

  addToField(sportEventId: string, participantId: string, overrides: Partial<SportEventParticipant> = {}): SportEventParticipant {
    const entry = stamp({ id: this.id('sep'), sportEventId, participantId, status: SportEventParticipantStatus.ACTIVE, metadata: {}, ...overrides });
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
      findBySportLeague: async (sportLeagueId, testData = false) => this.participants
        .filter((row) => row.sportLeagueId === sportLeagueId && row.isTestData === testData)
        .sort((left, right) => (left.ranking ?? Infinity) - (right.ranking ?? Infinity) || left.name.localeCompare(right.name)),
      updateRankings: async () => undefined,
      countBySportLeagues: async (ids) => new Map(ids.map((id) => [id, this.participants.filter((row) => row.sportLeagueId === id).length])),
      create: async () => { throw new Error('not used'); },
      createWithProviderMapping: async () => { throw new Error('not used'); },
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
      findByProviderRefs: async (providerId, externalIds) => this.events.filter((row) => externalIds.includes(this.externalIdAt(row.id, providerId) ?? '')),
      findFieldFeedIds: async (providerId, sportLeagueId, ids) => {
        const provider = TEST_PROVIDER_ROWS[requireProviderCodeOfSourceId(providerId)].id;
        const fields = new Map<string, Set<string>>();
        for (const row of this.field.filter((entry) => ids.includes(entry.sportEventId) && entry.status === SportEventParticipantStatus.ACTIVE)) {
          const field = fields.get(row.sportEventId) ?? new Set<string>();
          for (const mapping of this.mappings) {
            if (mapping.participantId === row.participantId && mapping.providerId === provider && mapping.sportLeagueId === sportLeagueId) field.add(mapping.externalId);
          }
          fields.set(row.sportEventId, field);
        }
        return fields;
      },
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
              meta: { target: ['sport_league_season_id', 'sport_league_season_competition_slot_id'] },
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
      deleteTestSlot: async () => { throw new Error('not used'); },
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
        && row.status === SportEventParticipantStatus.ACTIVE
        && !this.valuationRows.some((valuation) => valuation.sportEventParticipantId === row.id && (valuation.sportEventTierId || valuation.tierAssignedSource))
      )).length),
      countUnpricedActiveParticipants: async (ids) => count(ids, (id) => this.field.filter((row) => (
        row.sportEventId === id
        && row.status === SportEventParticipantStatus.ACTIVE
        && !this.valuationRows.some((valuation) => valuation.sportEventParticipantId === row.id && valuation.price !== null)
      )).length),
      countTiers: async (ids) => count(ids, (id) => this.tierRows.filter((row) => row.sportEventId === id).length),
      findEmptyTierNumbers: async (ids) => new Map(ids.map((id) => [id, this.tierRows
        .filter((tier) => tier.sportEventId === id && !this.valuationRows.some((valuation) => (
          valuation.sportEventTierId === tier.id
          && this.field.some((row) => row.id === valuation.sportEventParticipantId && row.status === SportEventParticipantStatus.ACTIVE)
        )))
        .sort((left, right) => left.tierNumber - right.tierNumber)
        .map((tier) => tier.tierNumber)])),
      countContests: async (ids) => count(ids, (id) => this.contestsByEvent.get(id) ?? 0),
      findSlots: async (ids) => new Map(ids.map((id) => [id, [...(this.slotsByEvent.get(id) ?? [])]])),
      isTestEvent: async (id) => (this.events.some((event) => event.id === id) ? (this.slotsByEvent.get(id) ?? []).some((slot) => slot.isTestData) : null),
      countBySportLeagues: async (ids) => count(ids, (id) => this.events.filter((row) => row.sportLeagueId === id).length),
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
            : query.sportEventIds.includes(row.id)))
        .map((row) => ({
          sportEventId: row.id,
          sport: row.sport,
          providerId: query.providerId,
          externalId: this.externalIdAt(row.id, query.providerId) as string,
          inProgress: row.status === 'IN_PROGRESS',
        })),
      recordProviderNotification: async (receipt) => {
        this.providerNotifications.push(receipt);
      },
      findReleaseFacts: async (event) => ({
        scheduledRoundCount: this.roundRows.filter((round) => round.sportEventId === event.id).length,
        contestSetupCount: this.contestSetupCounts.get(event.sportLeagueId) ?? 1,
        rosterSetupCount: this.rosterSetupCounts.get(event.id) ?? 1,
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
      findAutoLifecycleCandidates: async () => this.events.filter((row): row is AutoLifecycleCandidate => (
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
          // A round is played in one of its own event's slots: the composite key, raised as a throw.
          const slot = (this.slotsByEvent.get(round.sportEventId) ?? []).find((candidate) => candidate.id === round.seasonSlotId)
            // A test that takes an event's slots away keeps its rounds' slot playable.
            ?? (this.roundRows.some((row) => row.sportEventId === round.sportEventId && row.slot.seasonSlotId === round.seasonSlotId)
              ? this.seasonSlots.find((candidate) => candidate.id === round.seasonSlotId)
              : undefined);
          if (!slot) throw new Error(`Season slot ${round.seasonSlotId} is not one of sport event ${round.sportEventId}'s slots.`);
          this.roundRows.push(stamp({ id: this.id('round'), sportEventId: round.sportEventId, roundNumber: round.roundNumber, scheduledDate: round.scheduledDate, scheduledEndAt: round.scheduledEndAt ?? null, slot: roundSlotOf(slot, this.slotPeriods.get(slot.id) ?? null) }));
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
          row = stamp({ id: this.id('round'), sportEventId, roundNumber, scheduledDate: T0, scheduledEndAt: null, slot: this.roundSlotOfEvent(sportEventId) });
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
  platformPricingProfileRepo(): Pick<PlatformPricingProfileRepository, 'findBySportLeague' | 'findById'> {
    return {
      findBySportLeague: async (sportLeagueId) => this.profileOf(this.platformPricingProfiles, sportLeagueId, 'platformPricingProfileId'),
      findById: async (id) => {
        const profile = this.platformPricingProfiles.find((row) => row.id === id);
        return profile ? { ...profile } : null;
      },
    };
  }

  /** A league the store doesn't hold (an event's placeholder league) names the default profiles. */
  private profileOf<T extends { id: string }>(profiles: T[], sportLeagueId: string, key: 'platformTierProfileId' | 'platformPricingProfileId'): T | null {
    const league = this.sportLeagues.find((row) => row.id === sportLeagueId);
    const profileId = league ? league[key] : { platformTierProfileId: IN_MEMORY_PLATFORM_TIER_PROFILE_ID, platformPricingProfileId: IN_MEMORY_PLATFORM_PRICING_PROFILE_ID }[key];
    const profile = profiles.find((row) => row.id === profileId);
    return profile ? { ...profile } : null;
  }

  /** A sport league of its own naming a new tier profile of this layout (#1844), for events to sit in. */
  addLeagueWithPlatformTierProfile(
    layout: Pick<EqualGroupsLayout, 'tierCount' | 'tierSize'> & Partial<Pick<EqualGroupsLayout, 'lastTier' | 'lastTierMax'>>,
    sources: readonly FieldOrderBasis[] = ODDS_FIRST,
  ): SportLeague {
    const profile: PlatformTierProfile = stamp({ id: this.id('tier-profile'), code: `TIERS_${layout.tierCount}_OF_${layout.tierSize}`, name: `${layout.tierCount} tiers of ${layout.tierSize}`, description: 'A tier profile for this test.', sources: [...sources], type: TierProfileType.EQUAL_GROUPS, lastTier: 'ALL_REMAINING' as const, lastTierMax: null, ...layout });
    this.platformTierProfiles.push(profile);
    return Object.assign(this.addSportLeague('sport-1', `League ${profile.id}`), { platformTierProfileId: profile.id });
  }

  /**
   * A sport league of its own naming a new RANGES tier profile (#2160) and a pricing profile with
   * Standard's values and the same sources, so the league's two profiles start with one source.
   */
  addLeagueWithRangesTierProfile(ranges: TierRange[], sources: readonly FieldOrderBasis[]): SportLeague {
    const profile: PlatformTierProfile = stamp({ id: this.id('tier-profile'), code: `RANGES_${ranges.length}`, name: `${ranges.length} ranges`, description: 'A tier profile for this test.', sources: [...sources], type: TierProfileType.RANGES, ranges });
    this.platformTierProfiles.push(profile);
    const pricingId = this.id('pricing-profile');
    this.platformPricingProfiles.push(stamp({ id: pricingId, code: pricingId.toUpperCase().replaceAll('-', '_'), name: `Standard by ${sources[0]}`, description: 'A pricing profile for this test.', sources: [...sources], salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 }));
    return Object.assign(this.addSportLeague('sport-1', `League ${profile.id}`), { platformTierProfileId: profile.id, platformPricingProfileId: pricingId });
  }

  /** A sport league of its own naming a new pricing profile with these values (#1844). */
  addLeagueWithPlatformPricingProfile(values: BudgetPricingProfile, sources: readonly FieldOrderBasis[] = ODDS_FIRST): SportLeague {
    const id = this.id('pricing-profile');
    const profile: PlatformPricingProfile = stamp({ id, code: id.toUpperCase().replaceAll('-', '_'), description: 'A pricing profile for this test.', sources: [...sources], ...values });
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
    const valuation = this.valuationRows.find((row) => row.sportEventParticipantId === entry.id);
    return {
      entry: { ...entry },
      participant: { ...(this.participants.find((participant) => participant.id === entry.participantId) as Participant) },
      valuation: valuation ? { ...valuation } : null,
      standing: standing ? { ...standing } : null,
      fieldResults: this.fieldSideRows
        .filter((row) => row.sportEventParticipantId === entry.id)
        .sort((left, right) => left.roundNumber - right.roundNumber)
        .map((row) => ({
          sportEventRoundId: row.sportEventRoundId,
          roundNumber: row.roundNumber,
          gameStatus: row.gameStatus,
          gameCompletedAt: row.gameCompletedAt,
          result: {
            sportEventRoundMatchSideId: `field-side-${entry.id}-${row.roundNumber}`, sideNumber: 1, score: row.score, homeAway: HomeAway.NONE,
            position: row.position, startPosition: row.startPosition, scoreToPar: row.scoreToPar, periodsCompleted: row.periodsCompleted, status: row.status, periodScores: [],
          },
          updatedAt: row.updatedAt,
        })),
      matches: this.matchRows
        .filter((match) => match.sides.some((side) => side.sportEventParticipantId === entry.id))
        .sort(compareMatchPlaces)
        .map(copyMatch),
      affiliatedWithSportLeague: this.participants.some((row) => row.id === entry.participantId && row.sportLeagueId === sportLeagueId),
    };
  }

  /** The match a Game is on, and the Game. */
  private requireGame(id: string): { match: SportEventRoundMatch; game: SportEventRoundMatchGame } {
    for (const match of this.matchRows) {
      const game = match.games.find((each) => each.id === id);
      if (game) return { match, game };
    }
    throw new Error('unknown game');
  }

  /** Replaces one Game of its match. */
  private putGame(match: SportEventRoundMatch, game: SportEventRoundMatchGame): void {
    match.games = [...match.games.filter((each) => each.id !== game.id), game].sort((left, right) => left.gameNumber - right.gameNumber);
  }

  gameRepo(): SportEventRoundMatchGameRepository {
    const mapped = (game: SportEventRoundMatchGame, providerCode: string) => ({
      game: copyGame(game),
      externalId: this.gameMappings.find((mapping) => mapping.sportEventRoundMatchGameId === game.id && mapping.providerCode === providerCode)?.externalId ?? null,
    });
    return {
      findBySportEvent: async (sportEventId, providerCode) => this.gameRows
        .filter((game) => game.sportEventId === sportEventId)
        .sort((left, right) => left.sportEventRoundMatchId.localeCompare(right.sportEventRoundMatchId) || left.gameNumber - right.gameNumber)
        .map((game) => mapped(game, providerCode)),
      findByProviderExternalIds: async (providerCode, externalIds) => this.gameRows
        .filter((game) => this.gameMappings.some((mapping) => mapping.sportEventRoundMatchGameId === game.id && mapping.providerCode === providerCode && externalIds.includes(mapping.externalId)))
        .map((game) => mapped(game, providerCode)),
      applySync: async ({ providerCode, created, mapped: maps, moved, scores }) => {
        for (const game of created) {
          const match = this.matchRows.find((row) => row.id === game.sportEventRoundMatchId);
          if (!match) throw new Error('unknown match');
          this.putGame(match, stamp({ ...game, scheduledDate: null, venue: null, location: null, status: MatchStatus.SCHEDULED, completedAt: null, movedToGameId: null, lastProviderNotificationAt: null, sideResults: [] }));
        }
        const ids = new Set(maps.map((each) => each.externalId));
        const games = new Set(maps.map((each) => each.sportEventRoundMatchGameId));
        this.gameMappings = [
          ...this.gameMappings.filter((mapping) => mapping.providerCode !== providerCode || (!ids.has(mapping.externalId) && !games.has(mapping.sportEventRoundMatchGameId))),
          ...maps.map((each) => ({ ...each, providerCode })),
        ];
        for (const { id, movedToGameId } of moved) {
          const { match, game } = this.requireGame(id);
          this.putGame(match, { ...game, movedToGameId });
        }
        for (const { id, sides, ...values } of scores) {
          const { match, game } = this.requireGame(id);
          this.putGame(match, withSideScores(match, { ...game, ...values }, sides));
        }
      },
      recordProviderNotification: async (gameIds, receivedAt) => {
        for (const match of this.matchRows) {
          match.games = match.games.map((game) => (gameIds.includes(game.id) ? { ...game, lastProviderNotificationAt: receivedAt } : game));
        }
      },
    };
  }

  matchRepo(): SportEventRoundMatchRepository {
    const findBySportEvents = async (sportEventIds: readonly string[]) => this.matchRows
      .filter((row) => sportEventIds.includes(row.sportEventId))
      .sort((left, right) => left.sportEventId.localeCompare(right.sportEventId) || compareMatchPlaces(left, right))
      .map(copyMatch);
    const requireRow = (id: string) => {
      const row = this.matchRows.find((match) => match.id === id);
      if (!row) throw new Error('unknown match');
      return row;
    };
    const setTeams = (row: SportEventRoundMatch, teams: readonly MatchSideTeam[]) => {
      row.sides = row.sides.map((side) => {
        const team = teams.find((each) => each.sideNumber === side.sideNumber);
        return team === undefined ? side : { ...side, sportEventParticipantId: team.sportEventParticipantId };
      });
    };
    return {
      findById: async (id) => {
        const row = this.matchRows.find((match) => match.id === id);
        return row ? copyMatch(row) : null;
      },
      findBySportEvent: async (sportEventId) => findBySportEvents([sportEventId]),
      findBySportEvents,
      replaceBracket: async (sportEventId, matches, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const roundsByNumber = new Map(this.roundRows.filter((round) => round.sportEventId === sportEventId).map((round) => [round.roundNumber, round]));
        const roundOf = (roundNumber: number) => {
          const round = roundsByNumber.get(roundNumber);
          if (!round) throw new Error('unknown round');
          return round;
        };
        for (const match of matches) roundOf(match.roundNumber);
        // As the Prisma adapter does: the event's Games go with its matches, and each match has its sides and its Game 1.
        const goneGames = new Set(this.gameRows.filter((game) => game.sportEventId === sportEventId).map((game) => game.id));
        this.gameMappings = this.gameMappings.filter((mapping) => !goneGames.has(mapping.sportEventRoundMatchGameId));
        this.matchRows = [
          ...this.matchRows.filter((row) => row.sportEventId !== sportEventId),
          ...matches.map(({ sides, isNeutralSite, ...match }) => {
            const stored = sides.map((side) => ({ id: `${match.id}-s${String(side.sideNumber)}`, sideNumber: side.sideNumber, sportEventParticipantId: side.sportEventParticipantId, spread: null, outcome: MatchSideOutcome.PENDING }));
            return stamp({
              ...match,
              sportEventId,
              slot: roundOf(match.roundNumber).slot,
              status: MatchStatus.SCHEDULED,
              ending: MatchEnding.PLAYED,
              sides: stored,
              games: [stamp({
                id: `${match.id}-g1`, sportEventId, sportEventRoundMatchId: match.id, sportEventSlotId: `event-slot-${String(match.roundNumber)}`, gameNumber: 1,
                scheduledDate: match.scheduledDate, isNeutralSite, venue: null, location: null, status: MatchStatus.SCHEDULED, completedAt: null, movedToGameId: null, lastProviderNotificationAt: null,
                sideResults: sides.map((side, index) => ({ sportEventRoundMatchSideId: stored[index].id, sideNumber: side.sideNumber, score: null, homeAway: side.homeAway, position: null, startPosition: null, scoreToPar: null, periodsCompleted: null, status: null, periodScores: [] })),
              })],
            });
          }),
        ];
      },
      applyStatuses: async (statuses) => {
        for (const { id, status } of statuses) {
          const row = requireRow(id);
          // As the Prisma adapter does: a match with a result or cancelled keeps it.
          if (isMatchUnplayed(row.status) || row.status === MatchStatus.IN_PROGRESS) row.status = status;
        }
      },
      placeSides: async (matches, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        for (const { id, sides } of matches) setTeams(requireRow(id), sides);
      },
      update: async (id, { sides = [], spread, gameOneHomeAway = [], isNeutralSite, ...patch }, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const row = requireRow(id);
        Object.assign(row, patch);
        setTeams(row, sides);
        if (spread !== undefined) row.sides = row.sides.map((side) => (side.sideNumber === 1 ? { ...side, spread } : side));
        row.games = row.games.map((game) => ({ ...game, isNeutralSite: isNeutralSite ?? game.isNeutralSite }));
        row.games = row.games.map((game) => (game.gameNumber !== 1 ? game : {
          ...game,
          sideResults: game.sideResults.map((result) => ({ ...result, homeAway: gameOneHomeAway.find((each) => each.sideNumber === result.sideNumber)?.homeAway ?? result.homeAway })),
        }));
      },
      applyResult: async ({ result, sideFill, standings, jobs }) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const { id, outcomes, gameOne, completedAt, ...values } = result;
        const row = requireRow(id);
        Object.assign(row, values);
        row.sides = row.sides.map((side) => ({ ...side, outcome: outcomes.find((each) => each.sideNumber === side.sideNumber)?.outcome ?? side.outcome }));
        if (gameOne !== null) {
          const game = row.games.find((each) => each.id === gameOne.gameId);
          if (!game) throw new Error('unknown game');
          this.putGame(row, withSideScores(row, { ...game, status: values.status, completedAt }, gameOne.scores));
        }
        if (sideFill) setTeams(requireRow(sideFill.id), [sideFill]);
        for (const { sportEventParticipantId, ...standing } of standings) {
          let stored = this.standingRows.find((candidate) => candidate.sportEventParticipantId === sportEventParticipantId);
          if (!stored) {
            stored = stamp({ id: this.id('standing'), sportEventParticipantId, total: null, scoreToPar: null, ...standing });
            this.standingRows.push(stored);
          }
          Object.assign(stored, standing);
        }
      },
      saveGamePeriodScores: async ({ sportEventRoundMatchId, gameId, sides }, jobs) => {
        this.backgroundJobs.push(...(jobs ?? []));
        const row = requireRow(sportEventRoundMatchId);
        const game = row.games.find((each) => each.id === gameId);
        if (!game) throw new Error('unknown game');
        // A Game's periods of play are replaced together; its shoot-out stays.
        const withResults = withSideScores(row, game, []);
        const results = [...withResults.sideResults];
        for (const { sideNumber, periodScores } of sides) {
          const side = row.sides.find((each) => each.sideNumber === sideNumber);
          if (!side) throw new Error('unknown side');
          const index = results.findIndex((each) => each.sideNumber === sideNumber);
          const stored = index === -1 ? { sportEventRoundMatchSideId: side.id, sideNumber, score: null, homeAway: HomeAway.NONE, position: null, startPosition: null, scoreToPar: null, periodsCompleted: null, status: null, periodScores: [] } : results[index];
          const written = { ...stored, periodScores: [...stored.periodScores.filter((period) => period.kind === PeriodKind.SHOOTOUT), ...periodScores.map((period) => ({ ...period }))] };
          if (index === -1) results.push(written);
          else results[index] = written;
        }
        this.putGame(row, { ...game, sideResults: results });
      },
    };
  }

  /** The FIELD Game port (#2008): a race's or a golf round's side results, and the event's standings. */
  fieldGameRepo(): FieldGameRepository {
    const entryIdsOf = (sportEventId: string) => new Set(this.field.filter((row) => row.sportEventId === sportEventId).map((row) => row.id));
    return {
      findResults: async (sportEventId) => this.fieldSideRows
        .filter((row) => row.sportEventId === sportEventId)
        .sort((left, right) => left.roundNumber - right.roundNumber || left.sportEventParticipantId.localeCompare(right.sportEventParticipantId))
        .map(({ sportEventId: _event, sportEventRoundId: _round, gameCompletedAt: _completed, ...row }) => ({ ...row })),
      findStandings: async (sportEventId) => {
        const entryIds = entryIdsOf(sportEventId);
        return this.standingRows
          .filter((row) => entryIds.has(row.sportEventParticipantId))
          .sort((left, right) => left.sportEventParticipantId.localeCompare(right.sportEventParticipantId))
          .map(({ createdAt: _created, updatedAt: _updated, ...row }) => ({ ...row }));
      },
      applyResults: async (sportEventId, { games, standings, jobs }) => {
        const entryIds = entryIdsOf(sportEventId);
        if ([...games.flatMap((game) => game.sides), ...standings].some((write) => !entryIds.has(write.sportEventParticipantId))) {
          throw new Error('unknown field row');
        }
        const now = new Date();
        for (const game of games) {
          const round = this.roundRows.find((row) => row.sportEventId === sportEventId && row.roundNumber === game.roundNumber);
          if (!round) throw new Error(`no round ${game.roundNumber}`);
          for (const side of game.sides) {
            const row = { ...side, sportEventId, sportEventRoundId: round.id, roundNumber: game.roundNumber, gameStatus: game.status, gameCompletedAt: game.completedAt, updatedAt: now };
            const index = this.fieldSideRows.findIndex((candidate) => candidate.sportEventParticipantId === side.sportEventParticipantId && candidate.roundNumber === game.roundNumber);
            if (index === -1) this.fieldSideRows.push(row);
            else this.fieldSideRows[index] = row;
          }
          for (const row of this.fieldSideRows) {
            if (row.sportEventId === sportEventId && row.roundNumber === game.roundNumber) Object.assign(row, { gameStatus: game.status, gameCompletedAt: game.completedAt });
          }
        }
        for (const { sportEventParticipantId, ...values } of standings) {
          let standing = this.standingRows.find((row) => row.sportEventParticipantId === sportEventParticipantId);
          if (!standing) {
            standing = stamp({ id: this.id('standing'), sportEventParticipantId, ...values });
            this.standingRows.push(standing);
          }
          Object.assign(standing, values);
        }
        this.backgroundJobs.push(...(jobs ?? []));
      },
    };
  }
}
