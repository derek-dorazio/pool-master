/**
 * Loads a test data file (sport-data-file.ts) into a running PoolMaster through its admin
 * API: the sport leagues, players, events and fields a commissioner would otherwise type.
 *
 * Data goes in through the same root-admin endpoints the Manage screens use, so every rule
 * they apply applies here too and nothing writes the database behind the service's back.
 * Every file is test data (#1850), so it stays out of migrations (reference data only goes
 * there) and loads only into a local or QA site: real events and fields come from the provider
 * sync. A player carrying a provider's feed id is the participant that id is mapped to, or the
 * id is bound to the one the run finds or creates, so the sync and the test data share it.
 *
 * Re-entrant: each run compares the file with the site and fills in what differs. A missing
 * sport league, player, event or field entry is added; an event's name, dates, venue,
 * location, rounds or par that differ are updated; a field entry's ranking and seed are set;
 * a player the file drops from a field is marked withdrawn, never removed. An event that has
 * started (or was cancelled or postponed) is never changed: a difference there is reported
 * as a conflict. A player's existing league ranking is left alone, so a hand edit survives.
 * Running the same file twice reports everything as a skip. A dry run reads the site and
 * reports the same rows without writing.
 *
 * What a run may change is limited by the file's `scope.contents`: a file without SCHEDULE
 * never edits an event, so a file with just next week's fields cannot rewrite the schedule.
 *
 * A test seed (a file with RESULTS) adds the made-up parts: its dates move forward by whole
 * weeks so the first event starts at least a week after the run, and each event that is
 * still a draft gets odds, tiers, prices and stored scores and is released for contests (a
 * bracket's play-in places then take their winners and a week's postponed games are cancelled
 * before its results go in; a race's finishing order goes in after release, as the admin's
 * official result). A
 * draft that an earlier run stopped part-way through is finished the same way.
 *
 * A file with BRACKET in its contents also loads each event's bracket, after its field. Before
 * release a bracket that differs anywhere is loaded whole again, as the admin's Load bracket
 * does. Release locks a bracket event's pairings and seeds, and results fill its later sides, so
 * after release only a match's time and site are changed, and a field that differs is a conflict.
 *
 * A test slate (isTestSlate) fills the field of one event already on the site, named by the
 * run, with the slate's players in file order; it never creates a sport league or an event.
 * It is re-entrant the same way, unless the run asks to replace the field: then every field
 * row the slate does not list is removed, and one a contest entry has picked is withdrawn
 * instead, because removing it would break that entry.
 */

import { describeMatchPlace, eventPlaysMatches, findSportRow, isAtPlace, MatchPlaceMap, matchPlaceOf, MatchSide, MatchStatus, type ProviderCode, ScoringFamily, type MatchPlace, type Sport, SportEventStatus, type SportLeagueDefinition, sportLeagueDefinitionOf, sportPlaysMatches } from '@poolmaster/shared/domain';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import type {
  AutoAssignSportEventPricesRequest,
  LoadSportEventBracketRequest,
  SportEventBracketResponse,
  SportEventDto,
  SportEventListResponse,
  SportLeagueDto,
  SportEventParticipantResponse,
  UpdateSportEventRoundMatchRequest,
  UpdateSportEventParticipantsRequest,
  UpdateSportEventRequest,
} from '@poolmaster/shared/generated/hey-api';
import {
  addEventParticipants,
  applyEventGolfRoundScores,
  applyEventRaceResults,
  bindParticipantProviderMapping,
  autoAssignEventPrices,
  autoAssignEventTiers,
  cancelEventMatch,
  createEvent,
  createParticipant,
  createTestSlot,
  getSportLeagueStructure,
  getEventBracket,
  listEventParticipants,
  listEvents,
  listParticipants,
  listSportLeagueParticipants,
  listPlatformPricingProfiles,
  listProviders,
  listSportLeagues,
  listSportLeagueProviderMappings,
  listSportLeagueSeasons,
  listSports,
  loadEventBracket,
  proposeEventRoundMatchups,
  recordEventMatchPeriodScore,
  recordEventMatchResult,
  releaseEvent,
  removeEventParticipant,
  setEventRoundMatchups,
  transitionEvent,
  updateEvent,
  updateEventBracketMatch,
  updateEventParticipants,
} from '@poolmaster/shared/generated/hey-api';
import { LoadAction, LoadMode, LoadSubject, type LoadRow } from './load-report';
import {
  dueResultMatches,
  golferRoundScore,
  seedDateOffsetDays,
  selectTestSeedEvents,
  shiftedEventDates,
  shiftedMatchTimes,
  type StoredTestEvent,
  testEventTransitions,
  testSeedEventNameOf,
  type TestSeedSelection,
} from './seed-golf-data';
import {
  isTestEventName,
  isTestSlate,
  SportDataContent,
  type SportDataEvent,
  type SportDataFieldEntry,
  type SportDataFile,
  type SportDataLeague,
  type SportDataMatch,
  type SportDataPlayer,
} from './sport-data-file';

export interface LoadSportDataOptions {
  /** A root-admin client. Called before each event, so a long run can sign in again. */
  getClient: () => Promise<Client>;
  now: Date;
  mode: LoadMode;
  log?: (line: string) => void;
  /** A test slate's target: the name of an event already on the site, in the slate's sport league. */
  event?: string;
  /** A test slate only: remove field rows the slate does not list, rather than withdraw them. */
  replaceField?: boolean;
  /** A test seed only: the days to move its dates by, in place of the whole-file offset (#1524). */
  offsetDays?: number;
  /**
   * Whether a test seed's events are released for contests as they load (#1524): unless this is
   * false, when each is still set up whole, but left a draft.
   */
  release?: boolean;
  /**
   * A test seed only (#1720): a game's result goes in once its kickoff is at or before this time,
   * so games still to come stay open for picks and squares. Defaults to `now`.
   */
  resultsThrough?: Date;
}

type StoredEvent = SportEventListResponse['events'][number];
type StoredFieldRow = SportEventParticipantResponse['participant'];
type FieldPatch = UpdateSportEventParticipantsRequest['participants'][number];
type StoredMatch = SportEventBracketResponse['matches'][number];
type BracketMatchWrite = LoadSportEventBracketRequest['matches'][number];
/** What a field is written from: a file event's field, or a test slate's players. */
type FieldSource = Pick<SportDataEvent, 'name' | 'field'>;

/** An event that has started, or will not run as scheduled: the loader leaves it alone. */
const EDITABLE_STATUSES: ReadonlySet<StoredEvent['status']> = new Set([SportEventStatus.DRAFT, SportEventStatus.SCHEDULED]);
/** How far a renamed event's start may be from the file's and still be the same event. */
const RENAME_MATCH_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response?: Response;
}

async function must<T>(call: Promise<SdkResult<T>>, what: string): Promise<T> {
  const result = await call;
  if (result.data === undefined || result.error !== undefined) {
    throw new Error(`${what} failed (HTTP ${result.response?.status ?? 'none'}): ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is missing`);
  return value;
}

/** A provider identity as one key: the provider's id and its feed id for the participant. */
function feedKey(providerCode: ProviderCode, externalId: string): string {
  return `${providerCode}:${externalId}`;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const space = name.indexOf(' ');
  return space < 0 ? { firstName: name, lastName: name } : { firstName: name.slice(0, space), lastName: name.slice(space + 1) };
}

function day(iso: string | null): string | null {
  return iso === null ? null : iso.slice(0, 10);
}

function names(list: readonly string[]): string {
  return list.length <= 5 ? list.join(', ') : `${list.slice(0, 5).join(', ')} and ${list.length - 5} more`;
}

/** The pricing profile every sport league names unless a root admin moves it (#1844), by its code. */
const STANDARD_PLATFORM_PRICING_PROFILE_CODE = 'STANDARD';

/** The Standard pricing profile: its id, and its values as an event's price assignment sends them. */
async function standardPricing(client: Client): Promise<{ platformPricingProfileId: string; request: AutoAssignSportEventPricesRequest }> {
  const { platformPricingProfiles } = await must(listPlatformPricingProfiles({ client }), 'List pricing profiles');
  const { id, salaryCap, unit, topSharePercent, floorSharePercent, steepness } = found(platformPricingProfiles.find((profile) => profile.code === STANDARD_PLATFORM_PRICING_PROFILE_CODE), 'The Standard pricing profile');
  return { platformPricingProfileId: id, request: { platformPricingProfileId: id, salaryCap, unit, topSharePercent, floorSharePercent, steepness } };
}

/** "round 1 match 3, round 2 match 1": matches as a run's detail names them, each by its round and number. */
function matchList(places: readonly MatchPlace[]): string {
  return names(places.map((place) => describeMatchPlace(place)));
}

/**
 * What the file would change on an event's bracket, each match found by its round and number. Before
 * release (`locked` false) any difference in a match's sides, site, time, link or region, or a match
 * only one side has, means loading the bracket whole again. After release pairings are locked, so
 * only each match's site and time are changed, as one edit per match. A match only one side has, or
 * a changed link, region or named side, is then a conflict. Results fill the later sides, so only the sides the
 * file names are compared.
 */
function bracketChanges(
  matches: readonly SportDataMatch[],
  participantIds: ReadonlyMap<string, string | null>,
  storedField: readonly StoredFieldRow[],
  storedBracket: readonly StoredMatch[],
  { locked }: { locked: boolean },
): { changes: string[]; conflicts: string[]; edits: Array<{ place: MatchPlace; edit: UpdateSportEventRoundMatchRequest }> } {
  const byPlace = new MatchPlaceMap(storedBracket.map((match) => [match, match] as const));
  const placeById = new Map(storedBracket.map((match) => [match.id, matchPlaceOf(match)]));
  const participantOfRow = new Map(storedField.map((row) => [row.id, row.participantId]));
  const filePlaces = new MatchPlaceMap(matches.map((match) => [match, true] as const));
  const missing = matches.filter((match) => !byPlace.has(match)).map(matchPlaceOf);
  const extra = storedBracket.filter((match) => !filePlaces.has(match)).map(matchPlaceOf);
  const timeMoved = (match: SportDataMatch, stored: StoredMatch): boolean => match.scheduledAt !== undefined
    && (stored.scheduledDate === null || Date.parse(stored.scheduledDate) !== Date.parse(match.scheduledAt));
  const sameSide = (key: string | null, rowId: string | null): boolean => {
    if (key === null) return rowId === null;
    const participantId = participantIds.get(key) ?? null;
    return participantId !== null && rowId !== null && participantOfRow.get(rowId) === participantId;
  };
  const sameLink = (match: SportDataMatch, stored: StoredMatch): boolean => {
    const advancesTo = stored.advancesToMatchId === null ? null : placeById.get(stored.advancesToMatchId) ?? null;
    const sameNext = advancesTo === null || match.advancesTo === null ? advancesTo === match.advancesTo : isAtPlace(advancesTo, match.advancesTo);
    return sameNext && stored.advancesToSide === (match.advancesTo?.side ?? null)
      && stored.regionLabel === (match.regionLabel ?? null);
  };

  if (locked) {
    const repaired = matches.filter((match) => {
      const stored = byPlace.get(match);
      return stored !== undefined && (!sameLink(match, stored)
        || (match.home !== null && !sameSide(match.home, stored.homeSportEventParticipantId))
        || (match.away !== null && !sameSide(match.away, stored.awaySportEventParticipantId)));
    }).map(matchPlaceOf);
    const conflicts = [
      ...(missing.length > 0 ? [`${matchList(missing)} not on the site`] : []),
      ...(extra.length > 0 ? [`${matchList(extra)} not in the file`] : []),
      ...(repaired.length > 0 ? [`pairing, link or region of ${matchList(repaired)} differs`] : []),
    ];
    const edits = matches.flatMap((match) => {
      const stored = byPlace.get(match);
      if (!stored) return [];
      const edit: UpdateSportEventRoundMatchRequest = {};
      if (stored.isNeutralSite !== match.isNeutralSite) edit.isNeutralSite = match.isNeutralSite;
      if (match.scheduledAt !== undefined && timeMoved(match, stored)) edit.scheduledDate = new Date(match.scheduledAt).toISOString();
      return Object.keys(edit).length > 0 ? [{ place: matchPlaceOf(match), edit }] : [];
    });
    return { changes: edits.length > 0 ? [`time or site of ${matchList(edits.map((entry) => entry.place))}`] : [], conflicts, edits };
  }

  if (storedBracket.length === 0) return { changes: [`${matches.length} matches`], conflicts: [], edits: [] };
  const changed = matches.filter((match) => {
    const stored = byPlace.get(match);
    if (!stored) return false;
    return !sameSide(match.home, stored.homeSportEventParticipantId)
      || !sameSide(match.away, stored.awaySportEventParticipantId)
      || stored.isNeutralSite !== match.isNeutralSite
      || timeMoved(match, stored)
      || !sameLink(match, stored);
  }).map(matchPlaceOf);
  const changes = [
    ...(changed.length > 0 ? [`${matchList(changed)} changed`] : []),
    ...(missing.length > 0 ? [`${matchList(missing)} added`] : []),
    ...(extra.length > 0 ? [`${matchList(extra)} removed`] : []),
  ];
  return { changes: changes.length > 0 ? [...changes, 'bracket loaded whole again'] : [], conflicts: [], edits: [] };
}

class Loader {
  readonly rows: LoadRow[] = [];
  /** Each sport league's definition on the site, by name: its sport's, with the league's participant type and scoring family. */
  private readonly leagueDefinitions = new Map<string, SportLeagueDefinition>();
  private readonly apply: boolean;
  private readonly contents: ReadonlySet<SportDataContent>;
  private readonly offsetDays: number;
  private readonly log: (line: string) => void;
  /** A test seed's withdrawals come from its made-up scores, so it never reinstates a player. */
  private readonly testSeed: boolean;
  private readonly replaceField: boolean;
  /** A test seed's events are released once set up, unless the run holds them back as drafts. */
  private readonly releaseTestEvents: boolean;
  /** The Standard pricing profile, read once per run when a league is made or an event first priced. */
  private pricing: ReturnType<typeof standardPricing> | null = null;

  private readonly file: SportDataFile;

  constructor(file: SportDataFile, private readonly options: LoadSportDataOptions) {
    this.apply = options.mode === LoadMode.APPLY;
    this.contents = new Set(file.scope.contents);
    this.testSeed = this.contents.has(SportDataContent.RESULTS);
    this.offsetDays = this.testSeed ? (options.offsetDays ?? seedDateOffsetDays(file, options.now)) : 0;
    // A test seed's game times move with its event dates.
    this.file = shiftedMatchTimes(file, this.offsetDays);
    this.log = options.log ?? (() => {});
    this.replaceField = options.replaceField ?? false;
    this.releaseTestEvents = options.release ?? true;
  }

  private get sport(): Sport {
    return this.file.scope.sport;
  }

  /** The league's definition, as ensureLeague read it off the site. */
  private definitionOf(league: SportDataLeague): SportLeagueDefinition {
    return this.leagueDefinitions.get(league.name) ?? sportLeagueDefinitionOf(this.sport, this.file.scope);
  }

  /**
   * A finishing order comes from no feed: an admin enters it. Automatic lifecycle would
   * complete such an event at its end time and settle its contests on no result, so the loader
   * creates it with the lifecycle run by hand (docs/RACE-SETUP-PROCEDURES.md).
   */
  private get resultsEnteredByHand(): boolean {
    return this.file.scope.scoringFamily === ScoringFamily.FINISH_POSITION;
  }

  private report(row: LoadRow): void {
    this.rows.push(row);
    if (row.action !== LoadAction.SKIP) this.log(`${row.sportLeague}: ${row.action} ${row.subject} ${row.name}${row.detail ? ` (${row.detail})` : ''}`);
  }

  async run(): Promise<void> {
    if (this.offsetDays > 0) this.log(`Moving ${this.file.scope.season} test dates forward ${this.offsetDays} days.`);
    for (const league of this.file.sportLeagues) await this.loadLeague(league);
  }

  /** The league's id. The league must be on the site already: a missing one is refused. */
  private async ensureLeague(client: Client, league: SportDataLeague): Promise<SportLeagueDto> {
    const { name, urlSegment } = league;
    const { sportLeagues } = await must(listSportLeagues({ client, query: { sport: this.sport } }), 'List sport leagues');
    // A file that names the league's stored URL segment finds it by that; an older file, by name.
    const existing = urlSegment === undefined
      ? sportLeagues.find((row) => row.name.toLowerCase() === name.toLowerCase())
      : sportLeagues.find((row) => row.urlSegment === urlSegment);
    if (existing && (existing.participantType !== this.file.scope.participantType || existing.scoringFamily !== this.file.scope.scoringFamily)) {
      // The league on the site is the one home of how it plays (#2001); a file that says otherwise is wrong.
      throw new Error(`${name} on the site plays ${existing.participantType} ${existing.scoringFamily}; the file says ${this.file.scope.participantType} ${this.file.scope.scoringFamily}.`);
    }
    if (existing) {
      this.leagueDefinitions.set(name, sportLeagueDefinitionOf(this.sport, existing));
      this.report({ sportLeague: name, subject: LoadSubject.SPORT_LEAGUE, name, action: LoadAction.SKIP, detail: null });
      return existing;
    }
    // A sport league is added by migration with its phases and slots (the add-sport skill), never by
    // a test data file, so a file naming a league the site lacks is refused, in a dry run too.
    throw new Error(`No ${this.sport} sport league named ${name}: a sport league is added by migration, not by test data.`);
  }

  /**
   * The free test slot a file event is made on (#2004): the current Season's free test slot of the
   * named slot definition labelled with the event's key, made with the event's shifted dates when
   * the Season has none (so a load that stopped part way picks its slot up again). Null when the
   * league has no definition of that key.
   */
  private async testSlotFor(client: Client, sportLeagueId: string, event: SportDataEvent, slotKey: string): Promise<string | null> {
    const { phases } = await must(getSportLeagueStructure({ client, path: { sportLeagueId } }), 'Read the league\'s slot definitions');
    const definition = phases.flatMap((phase) => phase.competitions).flatMap((competition) => competition.slots).find((slot) => slot.key === slotKey);
    if (definition === undefined) return null;
    // A file event's key is unique in its file and short enough for a label. Another event of the
    // same key (a copy under another name) has its own slot, labelled with the next number.
    const { seasons } = await must(listSportLeagueSeasons({ client, path: { sportLeagueId } }), 'Read the league\'s Seasons');
    const labelled = (seasons.find((season) => season.isCurrent)?.phases ?? [])
      .flatMap((phase) => phase.competitions)
      .flatMap((competition) => competition.slots)
      .filter((slot) => slot.isTestData && slot.slotDefinitionId === definition.id && (slot.label === event.key || slot.label?.startsWith(`${event.key} `) === true));
    const free = labelled.find((slot) => slot.sportEventId === null);
    if (free) return free.id;
    const label = labelled.length === 0 ? event.key : `${event.key} ${String(labelled.length + 1)}`;
    const dates = shiftedEventDates(event, this.offsetDays);
    const { slot } = await must(createTestSlot({
      client,
      path: { sportLeagueId },
      body: { slotDefinitionId: definition.id, label, startsAt: dates.startDate, endsAt: dates.endDate },
    }), `Add a test slot for ${event.name}`);
    return slot.id;
  }

  /**
   * Each player's participant id (null in a dry run that would create it): the league's participant
   * a provider maps the player's feed id to (#1850), else the league's participant found by exact
   * name, else created in the league at the file's ranking (#1853). A
   * participant belongs to one sport league, so a player is only ever found among the league's
   * own. A player made in a provider-synced league carries its sync provider's feed id, written
   * with it (#2096); one the file gives no such id for is made a test participant, which joins only
   * the test slots' events this load makes, since the league takes no other participant without
   * a feed id. Any other feed id the league has
   * no participant mapped to yet is bound to the player's participant, so the provider's sync fields
   * that participant rather than creating a second. A player already in the league keeps the
   * ranking it has.
   */
  private async ensurePlayers(client: Client, league: SportDataLeague, siteLeague: SportLeagueDto): Promise<Map<string, string | null>> {
    const sportLeagueId = siteLeague.id;
    const syncProviderCode = siteLeague.selectedProviderMapping?.providerCode ?? null;
    const { participants } = await must(listParticipants({ client, query: { sportLeagueId } }), `List ${league.name} players`);
    const byName = new Map(participants.map((p) => [p.name.toLowerCase(), p.id]));
    // The league's test participants (#2096), which take no feed id: a re-run finds them by name above.
    const testIds = new Set((await must(
      listSportLeagueParticipants({ client, path: { sportLeagueId }, query: { testData: true } }),
      `List ${league.name} test players`,
    )).participants.map((p) => p.id));
    const providerIds = await this.providerIdsByCode(client, league);
    const byFeedId = await this.feedIdsOnSite(client, providerIds, sportLeagueId);

    const ids = new Map<string, string | null>();
    const binds: Array<{ participantId: string | null; player: SportDataPlayer; providerCode: ProviderCode; externalId: string }> = [];
    for (const player of league.players) {
      const feedIds = Object.entries(player.feedIds ?? {}) as Array<[ProviderCode, string]>;
      const mapped = feedIds.flatMap(([providerCode, externalId]) => {
        const participantId = byFeedId.get(feedKey(providerCode, externalId));
        return participantId === undefined ? [] : [participantId];
      });
      let id = mapped.at(0) ?? byName.get(player.name.toLowerCase()) ?? null;
      // A test participant, made here or by an earlier run, never takes a feed id (#2096).
      let isTestParticipant = id !== null && testIds.has(id);
      if (new Set(mapped).size > 1) {
        throw new Error(`${league.name}: ${player.name}'s feed ids are mapped to ${new Set(mapped).size} different participants; merge them on the site first.`);
      }
      if (id === null) {
        this.report({ sportLeague: league.name, subject: LoadSubject.PLAYER, action: LoadAction.ADD, name: player.name, detail: `ranked ${player.ranking}` });
        if (this.apply) {
          const feedId = syncProviderCode === null ? undefined : player.feedIds?.[syncProviderCode];
          isTestParticipant = syncProviderCode !== null && feedId === undefined;
          const created = await must(createParticipant({
            client,
            body: {
              sportLeagueId,
              ranking: player.ranking,
              participantType: this.definitionOf(league).participantType,
              name: player.name,
              nationality: player.countryCode,
              ...splitName(player.name),
              // A synced league takes a player with its sync provider's feed id, or as test data.
              ...(feedId !== undefined ? { feedId } : { isTestData: isTestParticipant }),
            },
          }), `Create player ${player.name}`);
          id = created.participant.id;
          // The create mapped the sync provider's feed id with the player.
          if (feedId !== undefined && syncProviderCode !== null) byFeedId.set(feedKey(syncProviderCode, feedId), id);
        }
      } else {
        this.report({ sportLeague: league.name, subject: LoadSubject.PLAYER, action: LoadAction.SKIP, name: player.name, detail: null });
      }
      for (const [providerCode, externalId] of isTestParticipant ? [] : feedIds) {
        if (!byFeedId.has(feedKey(providerCode, externalId))) binds.push({ participantId: id, player, providerCode, externalId });
      }
      ids.set(player.key, id);
    }
    for (const { participantId, player, providerCode, externalId } of binds) {
      this.report({ sportLeague: league.name, subject: LoadSubject.PLAYER, action: LoadAction.UPDATE, name: player.name, detail: `${providerCode} feed id ${externalId} bound` });
      if (this.apply) {
        await must(bindParticipantProviderMapping({
          client,
          path: { id: found(participantId ?? undefined, `${player.name}'s id`) },
          body: { providerId: found(providerIds.get(providerCode), `${providerCode}'s Provider row`), externalId },
        }), `Bind ${providerCode} ${externalId} to ${player.name}`);
      }
    }
    return ids;
  }

  /**
   * The Provider row of each provider the league's players name a feed id of, by its code (#2040):
   * one read of the providers, none when no player names a feed id. An unknown code stops the load.
   */
  private async providerIdsByCode(client: Client, league: SportDataLeague): Promise<Map<ProviderCode, string>> {
    const codes = new Set(league.players.flatMap((player) => Object.keys(player.feedIds ?? {}) as ProviderCode[]));
    if (codes.size === 0) return new Map();
    const { providers } = await must(listProviders({ client }), 'List providers');
    // Only the providers the players name, so the feed id read below asks no other.
    const ids = new Map(providers.flatMap(({ settings }) => (settings === null || !codes.has(settings.code) ? [] : [[settings.code, settings.id] as const])));
    for (const code of codes) found(ids.get(code), `${league.name}: provider ${code}'s Provider row`);
    return ids;
  }

  /**
   * The participant each provider maps a feed id to, among the sport league's participants, keyed
   * by `feedKey`: one read per provider the league's players name a feed id of, none when none does.
   */
  private async feedIdsOnSite(client: Client, providerIds: ReadonlyMap<ProviderCode, string>, sportLeagueId: string): Promise<Map<string, string>> {
    const byFeedId = new Map<string, string>();
    for (const [providerCode, providerId] of providerIds) {
      const { providerMappings } = await must(listSportLeagueProviderMappings({ client, query: { providerId, sportLeagueId } }), `List ${providerCode} feed ids`);
      for (const mapping of providerMappings) byFeedId.set(feedKey(providerCode, mapping.externalId), mapping.participantId);
    }
    return byFeedId;
  }

  private async loadLeague(league: SportDataLeague): Promise<void> {
    const client = await this.options.getClient();
    const siteLeague = await this.ensureLeague(client, league);
    const sportLeagueId = siteLeague.id;
    const participantIds = this.contents.has(SportDataContent.PLAYERS)
      ? await this.ensurePlayers(client, league, siteLeague)
      : new Map<string, string | null>();

    const stored = await currentSeasonEvents(client, siteLeague);
    const matches = this.matchEvents(league, stored);
    for (const event of league.events) {
      await this.loadEvent(await this.options.getClient(), { league, sportLeagueId, event, stored: matches.get(event) ?? null, participantIds });
    }
  }

  /**
   * Each file event's stored event: same name (any case), else the one unclaimed event whose
   * start is within a few days, which is how a sponsor's rename is found. A test event
   * ("Test- ...") is only ever matched with a test event, so a run never renames or rewrites the
   * real events the provider sync created beside it (#1524).
   */
  private matchEvents(league: SportDataLeague, stored: readonly StoredEvent[]): Map<SportDataEvent, StoredEvent> {
    const matches = new Map<SportDataEvent, StoredEvent>();
    const claimed = new Set<string>();
    for (const event of league.events) {
      const byName = stored.find((candidate) => candidate.name.toLowerCase() === event.name.toLowerCase());
      if (byName) {
        matches.set(event, byName);
        claimed.add(byName.id);
      }
    }
    for (const event of league.events) {
      if (matches.has(event)) continue;
      const start = Date.parse(shiftedEventDates(event, this.offsetDays).startDate);
      const near = stored.filter((candidate) => !claimed.has(candidate.id)
        && isTestEventName(candidate.name) === isTestEventName(event.name)
        && !league.events.some((other) => other.name.toLowerCase() === candidate.name.toLowerCase())
        && Math.abs(Date.parse(candidate.startDate) - start) <= RENAME_MATCH_DAYS * DAY_MS);
      if (near.length === 1) {
        matches.set(event, near[0]);
        claimed.add(near[0].id);
      }
    }
    return matches;
  }

  /** What the file would change on a stored event, as an update body and a description. */
  private eventChanges(event: SportDataEvent, stored: StoredEvent): { body: UpdateSportEventRequest; changes: string[] } {
    const body: UpdateSportEventRequest = {};
    const changes: string[] = [];
    const dates = shiftedEventDates(event, this.offsetDays);
    if (stored.name !== event.name) {
      body.name = event.name;
      changes.push(`name ${stored.name} → ${event.name}`);
    }
    // A released test event keeps the dates its own run gave it; only a draft moves to this run's.
    // An event on a test slot takes its dates from the slot, which an edit cannot move (#2004).
    const compareDates = stored.slots.length === 0 && (!this.testSeed || stored.status === SportEventStatus.DRAFT);
    // A file that gives the exact start (a post time) moves a start on the same day too.
    const startChanged = event.startsAt === undefined
      ? day(stored.startDate) !== day(dates.startDate)
      : Date.parse(stored.startDate) !== Date.parse(dates.startDate);
    if (compareDates && startChanged) {
      body.startDate = dates.startDate;
      // The real start time of an event stored at its date-only placeholder (noon UTC) is a data
      // correction, not a move: its leagues are not told (#1042).
      const fillsInTime = event.startsAt !== undefined
        && Date.parse(stored.startDate) === Date.parse(shiftedEventDates({ ...event, startsAt: undefined }, this.offsetDays).startDate);
      if (fillsInTime) body.tellMembers = false;
      changes.push(event.startsAt === undefined
        ? `start ${day(stored.startDate)} → ${day(dates.startDate)}`
        : `start ${stored.startDate} → ${dates.startDate}${fillsInTime ? ' (time filled in, leagues not told)' : ''}`);
    }
    if (compareDates && day(stored.endDate) !== day(dates.endDate)) {
      body.endDate = dates.endDate;
      changes.push(`end ${day(stored.endDate) ?? 'none'} → ${day(dates.endDate)}`);
    }
    // The run enters a test event's results and moves it on itself (catchUpTestEvents).
    if (stored.autoLifecycleEnabled) {
      body.autoLifecycleEnabled = false;
      changes.push('automatic lifecycle → off');
    }
    if (stored.venue !== event.venue) {
      body.venue = event.venue;
      changes.push(`venue ${stored.venue ?? 'none'} → ${event.venue ?? 'none'}`);
    }
    if (stored.location !== event.location) {
      body.location = event.location;
      changes.push(`location ${stored.location ?? 'none'} → ${event.location ?? 'none'}`);
    }
    if (stored.rounds !== event.rounds) {
      body.rounds = event.rounds;
      changes.push(`rounds ${stored.rounds ?? 'none'} → ${event.rounds}`);
    }
    if (stored.roundsPar !== event.roundsPar) {
      body.roundsPar = event.roundsPar;
      changes.push(`par ${stored.roundsPar ?? 'none'} → ${event.roundsPar ?? 'none'}`);
    }
    return { body, changes };
  }

  /**
   * What the file would change on an event's field: players to add (by participant id; null
   * for a player a dry run would create), row patches for ranking, seed and (test data) odds,
   * reinstatements for withdrawn rows the file lists again, and withdrawals for active rows
   * the file no longer lists. When the run replaces the field, every row the file does not
   * list is to be removed instead.
   */
  private fieldChanges(
    league: SportDataLeague,
    event: FieldSource,
    participantIds: ReadonlyMap<string, string | null>,
    storedField: readonly StoredFieldRow[],
  ): {
    add: Array<{ name: string; participantId: string | null }>;
    patches: Array<{ participantId: string; patch: Omit<FieldPatch, 'sportEventParticipantId'> }>;
    withdrawn: StoredFieldRow[];
    removed: StoredFieldRow[];
    changes: string[];
  } {
    const players = new Map(league.players.map((player) => [player.key, player.name]));
    const byParticipant = new Map(storedField.map((row) => [row.participantId, row]));
    const add: Array<{ name: string; participantId: string | null }> = [];
    const patches: Array<{ participantId: string; patch: Omit<FieldPatch, 'sportEventParticipantId'> }> = [];
    const listed = new Set<string>();
    const reinstated: string[] = [];
    event.field.forEach((entry, index) => {
      const name = players.get(entry.player) ?? entry.player;
      const participantId = found(participantIds.get(entry.player), `${event.name}: the participant id for ${entry.player}`);
      const row = participantId === null ? undefined : byParticipant.get(participantId);
      if (participantId !== null) listed.add(participantId);
      if (!row) add.push({ name, participantId });
      const patch: Omit<FieldPatch, 'sportEventParticipantId'> = {};
      if (entry.ranking !== undefined && row?.ranking !== entry.ranking) patch.ranking = entry.ranking;
      const seed = entry.seed === undefined ? index + 1 : entry.seed;
      if (row?.seedNumber !== seed) patch.seedNumber = seed;
      if (entry.oddsToWin !== undefined && row?.oddsToWin !== entry.oddsToWin) patch.oddsToWin = entry.oddsToWin;
      // Back in the field after a withdrawal (a re-commitment).
      if (!this.testSeed && row && row.status === 'WITHDRAWN') {
        patch.status = 'ACTIVE';
        reinstated.push(name);
      }
      if (participantId !== null && Object.keys(patch).length > 0) patches.push({ participantId, patch });
    });
    const unlisted = storedField.filter((row) => !listed.has(row.participantId));
    const removed = this.replaceField ? unlisted : [];
    const withdrawn = this.replaceField ? [] : unlisted.filter((row) => row.status === 'ACTIVE');
    const addedIds = new Set(add.map((entry) => entry.participantId));
    const updated = patches.filter(({ participantId, patch }) => !addedIds.has(participantId) && patch.status === undefined
      && (patch.ranking !== undefined || patch.seedNumber !== undefined || patch.oddsToWin !== undefined)).length;
    const changes = [
      ...(add.length > 0 ? [`${add.length} added (${names(add.map((entry) => entry.name))})`] : []),
      ...(updated > 0 ? [`${updated} re-ranked or re-seeded`] : []),
      ...(reinstated.length > 0 ? [`${reinstated.length} reinstated (${names(reinstated)})`] : []),
      ...(withdrawn.length > 0 ? [`${withdrawn.length} withdrawn (${names(withdrawn.map((row) => row.participant.name))})`] : []),
      ...(removed.length > 0 ? [`${removed.length} removed (${names(removed.map((row) => row.participant.name))}); any a contest entry has picked are withdrawn instead`] : []),
    ];
    return { add, patches, withdrawn, removed, changes };
  }

  private async loadEvent(client: Client, input: {
    league: SportDataLeague;
    sportLeagueId: string;
    event: SportDataEvent;
    stored: StoredEvent | null;
    participantIds: ReadonlyMap<string, string | null>;
  }): Promise<void> {
    const { league, event, participantIds } = input;
    const at = { sportLeague: league.name, name: event.name };
    const loadsSchedule = this.contents.has(SportDataContent.SCHEDULE);
    // An empty field means the file has no field for this event yet (not announced), never that everyone withdrew.
    const loadsField = this.contents.has(SportDataContent.FIELDS) && event.field.length > 0;
    // Likewise an event with no matches has no bracket in the file yet.
    const matches = event.matches ?? [];
    const loadsBracket = this.contents.has(SportDataContent.BRACKET) && matches.length > 0;
    const { stored } = input;

    if (!stored) {
      if (!loadsSchedule) {
        this.report({ ...at, subject: LoadSubject.EVENT, action: LoadAction.CONFLICT, detail: 'not on the site, and this file does not carry the schedule' });
        return;
      }
      // A test event is made on a test slot of one of the league's slot definitions (#2004): an
      // event the league has no slot for could never be synced, so it is not loaded either.
      const slotKeys = event.roundSlotKeys ?? (event.slotKey === undefined ? [] : [event.slotKey]);
      if (slotKeys.length === 0) {
        this.report({ ...at, subject: LoadSubject.EVENT, action: LoadAction.CONFLICT, detail: 'names no slot definition, and the league plays only its own slots' });
        return;
      }
      this.report({
        ...at,
        subject: LoadSubject.EVENT,
        action: LoadAction.ADD,
        detail: `${this.releaseTestEvents ? 'released' : 'a draft'} with odds, tiers, prices and scores`,
      });
      if (loadsField) {
        const plan = this.fieldChanges(league, event, participantIds, []);
        this.report({ ...at, subject: LoadSubject.FIELD, action: LoadAction.ADD, detail: `${plan.add.length} players` });
      }
      if (loadsBracket) this.report({ ...at, subject: LoadSubject.BRACKET, action: LoadAction.ADD, detail: `${matches.length} matches` });
      if (!this.apply) return;
      // One test slot per key: a bracket over several slots plays a round in each (#2006).
      const seasonSlotIds: string[] = [];
      for (const slotKey of slotKeys) {
        const seasonSlotId = await this.testSlotFor(client, input.sportLeagueId, event, slotKey);
        if (seasonSlotId === null) {
          this.report({ ...at, subject: LoadSubject.EVENT, action: LoadAction.CONFLICT, detail: `the league has no slot definition ${slotKey}` });
          return;
        }
        seasonSlotIds.push(seasonSlotId);
      }
      const created = await must(createEvent({
        client,
        body: {
          seasonSlotIds,
          name: event.name,
          ...(event.venue ? { venue: event.venue } : {}),
          ...(event.location ? { location: event.location } : {}),
          autoLifecycleEnabled: false,
        },
      }), `Create ${event.name}`);
      // The create gives the league's default round count; the file's own count and par are edits.
      const edits = {
        ...(created.event.rounds !== event.rounds && { rounds: event.rounds }),
        ...(event.roundsPar !== null && { roundsPar: event.roundsPar }),
      };
      if (Object.keys(edits).length > 0) {
        await must(updateEvent({ client, path: { eventId: created.event.id }, body: edits }), `Set rounds and par for ${event.name}`);
      }
      if (loadsField) await this.writeField(client, created.event.id, league, event, participantIds, []);
      if (loadsBracket) await this.writeBracket(client, created.event.id, event, participantIds, []);
      await this.finishTestEvent(client, created.event.id, event, participantIds);
      return;
    }

    const editable = EDITABLE_STATUSES.has(stored.status);
    // Release locks a bracket event's pairings, seeds and play-in places with its field.
    const bracketLocked = eventPlaysMatches(stored) && stored.status !== SportEventStatus.DRAFT;
    const eventPlan = loadsSchedule ? this.eventChanges(event, stored) : { body: {}, changes: [] };
    const storedField = loadsField || loadsBracket
      ? (await must(listEventParticipants({ client, path: { eventId: stored.id } }), `Read the field of ${event.name}`)).participants
      : [];
    const storedBracket = loadsBracket || (loadsField && bracketLocked)
      ? (await must(getEventBracket({ client, path: { eventId: stored.id } }), `Read the bracket of ${event.name}`)).matches
      : [];
    const fieldPlan = loadsField ? this.fieldChanges(league, event, participantIds, storedField) : null;
    const bracketPlan = loadsBracket ? bracketChanges(matches, participantIds, storedField, storedBracket, { locked: bracketLocked }) : null;
    const finishesDraft = stored.status === SportEventStatus.DRAFT;

    if (!editable) {
      const differences = [...eventPlan.changes, ...(fieldPlan?.changes ?? [])];
      this.report({
        ...at,
        subject: LoadSubject.EVENT,
        action: differences.length > 0 ? LoadAction.CONFLICT : LoadAction.SKIP,
        detail: differences.length > 0 ? `${stored.status}, so not changed: ${differences.join('; ')}` : null,
      });
      return;
    }

    const eventDetail = [
      ...eventPlan.changes,
      ...(finishesDraft ? [`finishes the draft: odds, tiers, prices, scores${this.releaseTestEvents ? ', release' : ''}`] : []),
    ];
    this.report({ ...at, subject: LoadSubject.EVENT, action: eventDetail.length > 0 ? LoadAction.UPDATE : LoadAction.SKIP, detail: eventDetail.join('; ') || null });
    const writesField = fieldPlan !== null && fieldPlan.changes.length > 0 && !bracketLocked;
    if (fieldPlan) {
      const action = fieldPlan.changes.length === 0 ? LoadAction.SKIP : bracketLocked ? LoadAction.CONFLICT : LoadAction.UPDATE;
      const detail = action === LoadAction.CONFLICT
        ? `${stored.status}, so the field is locked with its bracket: ${fieldPlan.changes.join('; ')}`
        : fieldPlan.changes.join('; ') || null;
      this.report({ ...at, subject: LoadSubject.FIELD, action, detail });
    }
    if (bracketPlan) {
      const action = bracketPlan.conflicts.length > 0 ? LoadAction.CONFLICT
        : bracketPlan.changes.length === 0 ? LoadAction.SKIP
          : storedBracket.length === 0 ? LoadAction.ADD : LoadAction.UPDATE;
      const detail = action === LoadAction.CONFLICT
        ? `${stored.status}, so the bracket is not changed: ${[...bracketPlan.conflicts, ...bracketPlan.changes].join('; ')}`
        : bracketPlan.changes.join('; ') || null;
      this.report({ ...at, subject: LoadSubject.BRACKET, action, detail });
    }
    if (!this.apply) return;
    if (eventPlan.changes.length > 0) {
      await must(updateEvent({ client, path: { eventId: stored.id }, body: eventPlan.body }), `Update ${event.name}`);
    }
    if (fieldPlan && writesField) await this.writeField(client, stored.id, league, event, participantIds, storedField);
    if (bracketPlan && bracketPlan.conflicts.length === 0 && bracketPlan.changes.length > 0) {
      if (bracketLocked) {
        for (const { place, edit } of bracketPlan.edits) {
          await must(updateEventBracketMatch({ client, path: { eventId: stored.id, ...place }, body: edit }), `Update ${describeMatchPlace(place)} of ${event.name}`);
        }
      } else {
        await this.writeBracket(client, stored.id, event, participantIds, storedBracket);
      }
    }
    if (finishesDraft) await this.finishTestEvent(client, stored.id, event, participantIds);
  }

  /** The Standard pricing profile, read on first use and kept for the rest of the run. */
  private standardPricing(client: Client): ReturnType<typeof standardPricing> {
    this.pricing ??= standardPricing(client);
    return this.pricing;
  }

  /** The Standard pricing values, which every seeded event is priced with. */
  private async defaultPricing(client: Client): Promise<AutoAssignSportEventPricesRequest> {
    return (await this.standardPricing(client)).request;
  }

  /**
   * Loads the file's bracket whole, each side's player key turned into its field row; a match
   * time the file leaves out keeps the one stored for that match's round and number.
   */
  private async writeBracket(client: Client, eventId: string, event: SportDataEvent, participantIds: ReadonlyMap<string, string | null>, storedBracket: readonly StoredMatch[]): Promise<void> {
    const { participants: rows } = await must(listEventParticipants({ client, path: { eventId } }), `Read the field of ${event.name}`);
    const rowByParticipant = new Map(rows.map((row) => [row.participantId, row.id]));
    const storedTime = new MatchPlaceMap(storedBracket.map((match) => [match, match.scheduledDate] as const));
    const rowOf = (key: string | null): string | null => {
      if (key === null) return null;
      const participantId = found(participantIds.get(key) ?? undefined, `${event.name}: the participant id for ${key}`);
      return found(rowByParticipant.get(participantId), `${event.name}: the field row for ${key}`);
    };
    const body: BracketMatchWrite[] = (event.matches ?? []).map((match) => ({
      matchNumber: match.matchNumber,
      roundNumber: match.roundNumber,
      homeSportEventParticipantId: rowOf(match.home),
      awaySportEventParticipantId: rowOf(match.away),
      isNeutralSite: match.isNeutralSite,
      scheduledDate: match.scheduledAt === undefined ? storedTime.get(match) ?? null : new Date(match.scheduledAt).toISOString(),
      advancesTo: match.advancesTo,
      regionLabel: match.regionLabel ?? null,
    }));
    await must(loadEventBracket({ client, path: { eventId }, body: { matches: body } }), `Load the bracket of ${event.name}`);
  }

  /** Writes the field; returns the names of rows it withdrew because a contest entry had picked them. */
  private async writeField(client: Client, eventId: string, league: SportDataLeague, event: FieldSource, participantIds: ReadonlyMap<string, string | null>, storedField: readonly StoredFieldRow[]): Promise<string[]> {
    const path = { eventId };
    const plan = this.fieldChanges(league, event, participantIds, storedField);
    const picked: StoredFieldRow[] = [];
    for (const row of plan.removed) {
      const result = await removeEventParticipant({ client, path: { eventId, sportEventParticipantId: row.id } });
      if (result.error?.error.code === 'EVENT_PARTICIPANT_HAS_PICKS') {
        picked.push(row);
      } else if (result.error !== undefined || !result.response?.ok) {
        throw new Error(`Remove ${row.participant.name} from the field of ${event.name} failed (HTTP ${result.response?.status ?? 'none'}): ${JSON.stringify(result.error)}`);
      }
    }
    if (plan.add.length > 0) {
      const ids = plan.add.map((entry) => found(entry.participantId ?? undefined, `${event.name}: the participant id for ${entry.name}`));
      await must(addEventParticipants({ client, path, body: { participantIds: ids } }), `Add players to the field of ${event.name}`);
    }
    const { participants: rows } = await must(listEventParticipants({ client, path }), `Read the field of ${event.name}`);
    const rowByParticipant = new Map(rows.map((row) => [row.participantId, row.id]));
    const participants: FieldPatch[] = [
      ...plan.patches.map(({ participantId, patch }) => ({
        sportEventParticipantId: found(rowByParticipant.get(participantId), `${event.name}: the field row for ${participantId}`),
        ...patch,
      })),
      ...[...plan.withdrawn, ...picked.filter((row) => row.status === 'ACTIVE')]
        .map((row) => ({ sportEventParticipantId: row.id, status: 'WITHDRAWN' as const })),
    ];
    if (participants.length > 0) {
      await must(updateEventParticipants({ client, path, body: { participants } }), `Set the field of ${event.name}`);
    }
    return picked.map((row) => row.participant.name);
  }

  /**
   * Fills the named event's field from the slate's one sport league: its players in file
   * order, each at their ranking. The sport league and the event must already be on the site.
   */
  async runSlate(eventName: string): Promise<void> {
    const league = found(this.file.sportLeagues[0], 'The test slate\'s sport league');
    const client = await this.options.getClient();
    const { sportLeagues } = await must(listSportLeagues({ client, query: { sport: this.sport } }), 'List sport leagues');
    const sportLeague = sportLeagues.find((candidate) => candidate.name.toLowerCase() === league.name.toLowerCase());
    if (!sportLeague) throw new Error(`No ${league.name} sport league on the site; a test slate fills an event that is already there.`);
    const { events } = await must(listEvents({ client, query: { sportLeagueId: sportLeague.id } }), `List ${league.name} events`);
    const named = events.filter((candidate) => candidate.name.toLowerCase() === eventName.trim().toLowerCase());
    const editable = named.filter((candidate) => EDITABLE_STATUSES.has(candidate.status));
    const at = { sportLeague: league.name, name: eventName };
    if (named.length === 0) throw new Error(`No ${league.name} event named ${eventName}.`);
    if (editable.length > 1) {
      throw new Error(`${editable.length} ${league.name} events not yet started are named ${eventName} (${editable.map((event) => event.championshipYear).join(', ')}); rename one so the name picks one event.`);
    }
    if (editable.length === 0) {
      this.report({ ...at, subject: LoadSubject.EVENT, action: LoadAction.CONFLICT, detail: `${named.map((event) => event.status).join(', ')}, so its field is not changed` });
      return;
    }
    const stored = editable[0];

    this.report({ sportLeague: league.name, subject: LoadSubject.SPORT_LEAGUE, action: LoadAction.SKIP, name: league.name, detail: null });
    const participantIds = await this.ensurePlayers(client, league, sportLeague);
    const slate: FieldSource = {
      name: stored.name,
      field: league.players.map((player): SportDataFieldEntry => ({ player: player.key, ranking: player.ranking })),
    };
    const { participants: storedField } = await must(listEventParticipants({ client, path: { eventId: stored.id } }), `Read the field of ${stored.name}`);
    const plan = this.fieldChanges(league, slate, participantIds, storedField);
    this.report({ ...at, name: stored.name, subject: LoadSubject.FIELD, action: plan.changes.length > 0 ? LoadAction.UPDATE : LoadAction.SKIP, detail: plan.changes.join('; ') || null });
    if (!this.apply || plan.changes.length === 0) return;
    const picked = await this.writeField(client, stored.id, league, slate, participantIds, storedField);
    if (picked.length > 0) {
      this.report({ ...at, name: stored.name, subject: LoadSubject.FIELD, action: LoadAction.UPDATE, detail: `${picked.length} withdrawn, not removed, because a contest entry picked them (${names(picked)})` });
    }
  }

  /**
   * The made-up parts of a test seed: tiers by odds, default prices, stored scores or results,
   * release. An event the run holds back stays a draft with what goes in before release; a bracket
   * event's play-in winners, cancellations and results go in on a later run, after its release.
   */
  private async finishTestEvent(client: Client, eventId: string, event: SportDataEvent, participantIds: ReadonlyMap<string, string | null>): Promise<void> {
    const path = { eventId };
    const release = async (): Promise<void> => {
      if (this.releaseTestEvents) await must(releaseEvent({ client, path }), `Release ${event.name}`);
    };
    // Tiers and prices follow the field's one order (#1807).
    await must(autoAssignEventTiers({ client, path, body: {} }), `Assign tiers for ${event.name}`);
    await must(autoAssignEventPrices({ client, path, body: await this.defaultPricing(client) }), `Assign prices for ${event.name}`);
    if (sportPlaysMatches(this.sport)) {
      if (!this.releaseTestEvents) return;
      await release();
      await cancelPostponedGamesFor(client, eventId, event);
      await enterBracketResultsFor(client, eventId, event, this.options.resultsThrough ?? this.options.now, new Date(shiftedEventDates(event, this.offsetDays).startDate));
      return;
    }
    if (this.resultsEnteredByHand) {
      // Results before release, so a run that dies between them leaves a draft the rerun finishes.
      await enterRaceResultsFor(client, eventId, event, participantIds);
      await release();
      return;
    }
    for (let roundNumber = 1; roundNumber <= event.rounds; roundNumber += 1) {
      const rows = event.field.flatMap((entry) => {
        const score = event.roundsPar === null ? null : golferRoundScore(entry, roundNumber, event.roundsPar);
        const participantId = found(participantIds.get(entry.player) ?? undefined, `${event.name}: the participant id for ${entry.player}`);
        return score ? [{ participantId, ...score }] : [];
      });
      if (rows.length > 0) {
        await must(applyEventGolfRoundScores({ client, path: { eventId, roundNumber }, body: { rows } }), `Store round ${roundNumber} of ${event.name}`);
      }
    }
    await release();
  }
}

/** A race test seed's finishing order, entered on the released event as one official result. */
async function enterRaceResultsFor(client: Client, eventId: string, event: SportDataEvent, participantIds: ReadonlyMap<string, string | null>): Promise<void> {
  const rows = event.field.flatMap(({ player, raceResult }) => (raceResult === undefined ? [] : [{
    participantId: found(participantIds.get(player) ?? undefined, `${event.name}: the participant id for ${player}`),
    resultStatus: raceResult.status,
    finishPosition: raceResult.finishPosition,
    startPosition: raceResult.startPosition ?? null,
    riderName: raceResult.riderName ?? null,
  }]));
  await must(applyEventRaceResults({ client, path: { eventId }, body: { isOfficial: true, rows } }), `Enter the finishing order of ${event.name}`);
}

/**
 * A week test seed's postponed games, cancelled on the released event before any result, as an
 * admin cancels a game moved out of its week: it counts for no pick and no standing.
 */
async function cancelPostponedGamesFor(client: Client, eventId: string, event: SportDataEvent): Promise<void> {
  for (const match of (event.matches ?? []).filter((candidate) => candidate.cancelled === true)) {
    await must(cancelEventMatch({ client, path: { eventId, ...matchPlaceOf(match) } }), `Cancel the postponed ${describeMatchPlace(match)} of ${event.name}`);
  }
}

/**
 * A bracket test seed's results for the games already played (#1720): each match with a result in
 * the file whose kickoff (or, without one, the event's start) is at or before `through` and that
 * the site still has open. A round placed by reseeding (its sides wait on no link) takes the
 * server's proposed pairing first, the rule a real reseed follows, unless the site has placed it
 * already; each match's result then names the side as the match stands. Which rounds reseed is the
 * server's rule (reseededRounds in bracket-reseed.ts), read here from the file's links; keep the
 * two alike. Returns how many results went in.
 */
async function enterBracketResultsFor(client: Client, eventId: string, event: SportDataEvent, through: Date, eventStart: Date): Promise<number> {
  const matches = event.matches ?? [];
  if (!matches.some((match) => match.result !== undefined)) return 0;
  const stored = await must(getEventBracket({ client, path: { eventId } }), `Read the bracket of ${event.name}`);
  const dueMatches = dueResultMatches(matches, stored.matches, through, eventStart);
  const due = new MatchPlaceMap(dueMatches.map((place) => [place, true] as const));
  const rounds = [...new Set(matches.map((match) => match.roundNumber))].sort((left, right) => left - right);
  const links = matches.flatMap((match) => (match.advancesTo ? [match.advancesTo] : []));
  const linked = (match: SportDataMatch, side: MatchSide) => links.some((link) => link.side === side && isAtPlace(link, match));
  for (const roundNumber of rounds) {
    const round = matches.filter((match) => match.roundNumber === roundNumber);
    const waitsOnReseed = round.some((match) => (match.home === null && !linked(match, MatchSide.HOME))
      || (match.away === null && !linked(match, MatchSide.AWAY)));
    const results = round.flatMap((match) => (match.result && due.has(match) ? [{ place: matchPlaceOf(match), result: match.result, periodScores: match.periodScores ?? [] }] : []));
    if (results.length === 0) continue;
    const unplaced = stored.matches.some((match) => match.roundNumber === roundNumber
      && (match.homeSportEventParticipantId === null || match.awaySportEventParticipantId === null));
    if (waitsOnReseed && unplaced) {
      const proposal = await must(proposeEventRoundMatchups({ client, path: { eventId, roundNumber } }), `Propose round ${roundNumber} of ${event.name}`);
      await must(setEventRoundMatchups({ client, path: { eventId, roundNumber }, body: { matches: proposal.matches } }), `Place round ${roundNumber} of ${event.name}`);
    }
    for (const { place, result, periodScores } of results) {
      for (const { periodNumber, ...score } of periodScores) {
        await must(recordEventMatchPeriodScore({ client, path: { eventId, ...place, periodNumber }, body: score }), `Enter the score at the end of period ${periodNumber} of ${describeMatchPlace(place)} of ${event.name}`);
      }
      const body = {
        winnerSide: result.winner,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        homeShootoutScore: result.homeShootoutScore ?? null,
        awayShootoutScore: result.awayShootoutScore ?? null,
        ending: result.ending,
      };
      await must(recordEventMatchResult({ client, path: { eventId, ...place }, body }), `Enter the result of ${describeMatchPlace(place)} of ${event.name}`);
    }
  }
  return dueMatches.length;
}

/**
 * Brings the test events a test seed loaded on an earlier run up to date (#1720): enters the
 * results of the games played since, and moves each event on as a real one goes, to In Progress
 * once it starts and to Completed (which settles its contests) once every result is in. Only for
 * a test seed whose file carries results; the event's dates are the site's, not the file's.
 */
export async function catchUpTestEvents(
  file: SportDataFile,
  options: Pick<LoadSportDataOptions, 'getClient' | 'now' | 'mode' | 'log' | 'resultsThrough'>,
): Promise<LoadRow[]> {
  if (!file.scope.contents.includes(SportDataContent.RESULTS)) return [];
  const apply = options.mode === LoadMode.APPLY;
  const through = options.resultsThrough ?? options.now;
  const client = await options.getClient();
  const { sportLeagues } = await must(listSportLeagues({ client, query: { sport: file.scope.sport } }), 'List sport leagues');
  const rows: LoadRow[] = [];
  for (const league of file.sportLeagues) {
    const siteLeague = sportLeagues.find((row) => row.name.toLowerCase() === league.name.toLowerCase());
    if (!siteLeague) continue;
    const events = await currentSeasonEvents(client, siteLeague);
    for (const stored of events) {
      if (stored.status !== SportEventStatus.SCHEDULED && stored.status !== SportEventStatus.IN_PROGRESS) continue;
      const fileName = testSeedEventNameOf(stored.name);
      const fileEvent = fileName === null ? undefined : league.events.find((event) => event.name === fileName);
      if (!fileEvent) continue;
      const eventStart = new Date(stored.startDate);
      const playsMatches = eventPlaysMatches(stored);
      const details: string[] = [];
      let everyResultIn = true;
      if (playsMatches) {
        const bracket = await must(getEventBracket({ client, path: { eventId: stored.id } }), `Read the bracket of ${stored.name}`);
        const due = dueResultMatches(fileEvent.matches ?? [], bracket.matches, through, eventStart);
        const decided = new MatchPlaceMap([...due, ...bracket.matches.filter((match) => match.status !== MatchStatus.SCHEDULED)].map((match) => [match, true] as const));
        everyResultIn = (fileEvent.matches ?? []).every((match) => match.result === undefined || decided.has(match));
        if (due.length > 0) {
          if (apply) await enterBracketResultsFor(client, stored.id, { ...fileEvent, name: stored.name }, through, eventStart);
          details.push(`${due.length} ${due.length === 1 ? 'result' : 'results'} entered`);
        }
      }
      let action: LoadAction = LoadAction.UPDATE;
      for (const toStatus of testEventTransitions(stored, { now: options.now, playsMatches, everyResultIn })) {
        const label = toStatus === SportEventStatus.COMPLETED ? 'Completed' : 'In Progress';
        if (apply) {
          // A refused move (a result the server still waits on) is reported, not fatal: the rest of the run goes on.
          const { error } = await transitionEvent({ client, path: { eventId: stored.id }, body: { toStatus } });
          if (error !== undefined) {
            action = LoadAction.CONFLICT;
            details.push(`not moved to ${label}: ${refusalMessage(error)}`);
            break;
          }
        }
        details.push(toStatus === SportEventStatus.COMPLETED ? 'moved to Completed, settling its contests' : 'moved to In Progress');
      }
      if (details.length === 0) continue;
      const row: LoadRow = { sportLeague: league.name, subject: LoadSubject.EVENT, action, name: stored.name, detail: details.join('; ') };
      rows.push(row);
      options.log?.(`${league.name} ${stored.name}: ${row.detail}`);
    }
  }
  return rows;
}

/** What a refused API call says: the error envelope's message, or the body as JSON when it has none. */
function refusalMessage(error: unknown): string {
  const envelope = typeof error === 'object' && error !== null && 'error' in error ? error.error : null;
  return typeof envelope === 'object' && envelope !== null && 'message' in envelope && typeof envelope.message === 'string'
    ? envelope.message
    : JSON.stringify(error);
}

/** selectTestSeedEvents against the site: reads each sport league's events of the seed's season. */
export async function selectTestSeedEventsOnSite(
  file: SportDataFile,
  getClient: () => Promise<Client>,
  eventsPerLeague: number,
  now: Date,
): Promise<TestSeedSelection> {
  const client = await getClient();
  const { sportLeagues } = await must(listSportLeagues({ client, query: { sport: file.scope.sport } }), 'List sport leagues');
  const stored = new Map<string, StoredTestEvent[]>();
  for (const league of file.sportLeagues) {
    const existing = sportLeagues.find((row) => row.name.toLowerCase() === league.name.toLowerCase());
    if (!existing) continue;
    const events = await currentSeasonEvents(client, existing);
    stored.set(league.name.toLowerCase(), events.map((event) => ({ name: event.name, status: event.status, startDate: event.startDate })));
  }
  return selectTestSeedEvents(file, stored, eventsPerLeague, now);
}

/**
 * A site league's events in its current Season (#2003). Test events are dated forward to now, so
 * they are created in, and read from, the Season under way; a league with no Season is refused,
 * since Seasons are added by migration.
 */
async function currentSeasonEvents(client: Client, league: Pick<SportLeagueDto, 'id' | 'name' | 'currentSeasonId'>): Promise<SportEventDto[]> {
  if (league.currentSeasonId === null) {
    throw new Error(`${league.name} has no current Season: a sport league's Seasons are added by migration, not by test data.`);
  }
  const { events } = await must(listEvents({ client, query: { sportLeagueSeasonId: league.currentSeasonId } }), `List ${league.name} events`);
  return events;
}

/** Loads the file, or in a dry run reports what loading it would do. Returns one row per subject. */
export async function loadSportData(file: SportDataFile, options: LoadSportDataOptions): Promise<LoadRow[]> {
  const { sports } = await must(listSports({ client: await options.getClient() }), 'List sports');
  if (!findSportRow(sports, file.scope.sport)) throw new Error(`No ${file.scope.sport} sport row; the reference-data migration has not run.`);
  const loader = new Loader(file, options);
  if (isTestSlate(file)) {
    if (!options.event?.trim()) throw new Error('A test slate fills one event: name it (--event).');
    await loader.runSlate(options.event);
  } else {
    if (options.event !== undefined || options.replaceField) {
      throw new Error('--event and --replace-field go with a test slate; this file carries its own events.');
    }
    await loader.run();
  }
  return loader.rows;
}
