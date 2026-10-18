/**
 * Loads a sport data file (sport-data-file.ts) into a running PoolMaster through its admin
 * API: the sport leagues, players, events and fields a commissioner would otherwise type.
 *
 * Data goes in through the same root-admin endpoints the Manage screens use, so every rule
 * they apply applies here too and nothing writes the database behind the service's back.
 * Seed data is test data, so it stays out of migrations (reference data only goes there).
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
 * A test seed (`testData: true`) adds the made-up parts: its dates move forward by whole
 * weeks so the first event starts at least a week after the run, and each event that is
 * still a draft gets odds, tiers, prices and stored scores and is released for contests (a
 * bracket's play-in places then take their winners before its results go in; a race's finishing
 * order goes in after release, as the admin's official result). A
 * draft that an earlier run stopped part-way through is finished the same way. A real file
 * never releases an event, writes odds, tiers, prices or scores, or deletes anything.
 *
 * A file with BRACKET in its contents also loads each event's bracket, after its field. Before
 * release a bracket that differs anywhere is loaded whole again, as the admin's Load bracket
 * does. Release locks a bracket event's pairings, seeds and play-in places, and results fill
 * its later sides, so after release only a match's time and site are changed, and a field that
 * differs is a conflict. A play-in place already filled with its winner is recognised by its
 * bracket place and left alone.
 *
 * A test slate (isTestSlate) fills the field of one event already on the site, named by the
 * run, with the slate's players in file order; it never creates a sport league or an event.
 * It is re-entrant the same way, unless the run asks to replace the field: then every field
 * row the slate does not list is removed, and one a contest entry has picked is withdrawn
 * instead, because removing it would break that entry.
 */

import { findSportRow, getSportDefinition, MatchSide, ScoringFamily, type Sport, SportEventStatus, sportPlaysBracket } from '@poolmaster/shared/domain';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import type {
  AutoAssignSportEventPricesRequest,
  LoadSportEventBracketRequest,
  SportEventBracketResponse,
  SportEventListResponse,
  SportEventParticipantResponse,
  UpdateSportEventMatchRequest,
  UpdateSportEventParticipantsRequest,
  UpdateSportEventRequest,
} from '@poolmaster/shared/generated/hey-api';
import {
  addEventParticipants,
  applyEventGolfRoundScores,
  applyEventRaceResults,
  applyParticipantLeagueAffiliationUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createEvent,
  createParticipant,
  createSportLeague,
  getEventBracket,
  getSettingsGroup,
  listEventParticipants,
  listParticipantLeagueAffiliations,
  listEvents,
  listParticipants,
  listSportLeagues,
  listSports,
  loadEventBracket,
  proposeEventRoundMatchups,
  recordEventMatchResult,
  releaseEvent,
  removeEventParticipant,
  setEventPlayInWinner,
  setEventRoundMatchups,
  updateEvent,
  updateEventBracketMatch,
  updateEventParticipants,
  updateSportLeague,
} from '@poolmaster/shared/generated/hey-api';
import { LoadAction, LoadMode, LoadSubject, type LoadRow } from './load-report';
import { golferRoundScore, seedDateOffsetDays, shiftedEventDates, shiftedMatchTimes } from './seed-golf-data';
import {
  isTestSlate,
  SportDataContent,
  type SportDataEvent,
  type SportDataFieldEntry,
  type SportDataFile,
  type SportDataLeague,
  type SportDataMatch,
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

/**
 * Every seeded tournament is priced for budget contests with the app's default Budget pricing
 * profile, the one the admin's price dialog starts on.
 */
async function defaultPricing(client: Client): Promise<AutoAssignSportEventPricesRequest> {
  const group = await must(getSettingsGroup({ client, path: { key: 'BUDGET_PRICING_CONFIG' } }), 'Read budget pricing settings');
  if (group.key !== 'BUDGET_PRICING_CONFIG') throw new Error(`Read budget pricing settings returned ${group.key}`);
  const { name, ...values } = found(group.value.profiles[0], 'The default budget pricing profile');
  return { profileName: name, ...values };
}

/** "matches 3, 7": match numbers as a run's detail names them. */
function matchList(numbers: readonly number[]): string {
  return `match${numbers.length === 1 ? '' : 'es'} ${names(numbers.map(String))}`;
}

/** The field row a stored match names on one side. */
function storedSide(match: StoredMatch, side: MatchSide): string | null {
  return side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
}

/**
 * The play-in places of a released bracket event already filled with their winner, by the file
 * entry's player key. Filling points the place's field row at the winning team, so the file's
 * pairing ("Texas / Xavier") has no row of its own; its row is the one on the bracket side the
 * file gives the pairing.
 */
function filledPlayInPlaces(
  event: SportDataEvent,
  participantIds: ReadonlyMap<string, string | null>,
  storedField: readonly StoredFieldRow[],
  storedBracket: readonly StoredMatch[],
): Map<string, StoredFieldRow> {
  const filled = new Map<string, StoredFieldRow>();
  const onField = new Set(storedField.map((row) => row.participantId));
  const listed = new Set(event.field.flatMap((entry) => {
    const participantId = participantIds.get(entry.player);
    return participantId ? [participantId] : [];
  }));
  for (const entry of event.field) {
    const participantId = participantIds.get(entry.player);
    if (entry.isPlayInPlace !== true || (participantId && onField.has(participantId))) continue;
    for (const match of event.matches ?? []) {
      const side = match.home === entry.player ? MatchSide.HOME : match.away === entry.player ? MatchSide.AWAY : null;
      const storedMatch = side === null ? undefined : storedBracket.find((candidate) => candidate.matchNumber === match.matchNumber);
      const rowId = side === null || !storedMatch ? null : storedSide(storedMatch, side);
      const row = storedField.find((candidate) => candidate.id === rowId);
      if (row && !listed.has(row.participantId)) filled.set(entry.player, row);
    }
  }
  return filled;
}

/**
 * What the file would change on an event's bracket. Before release (`locked` false) any
 * difference in a match's round, sides, site, time, link or region, or a match only one side has, means
 * loading the bracket whole again. After release pairings are locked, so only each match's site
 * and time are changed, as one edit per match. A match only one side has, or a changed round,
 * link, region or named side, is then a conflict. Results fill the later sides, so only the sides the
 * file names are compared, and a filled play-in place (`filled`) matches its pairing.
 */
function bracketChanges(
  matches: readonly SportDataMatch[],
  participantIds: ReadonlyMap<string, string | null>,
  storedField: readonly StoredFieldRow[],
  storedBracket: readonly StoredMatch[],
  { locked, filled }: { locked: boolean; filled: ReadonlyMap<string, StoredFieldRow> },
): { changes: string[]; conflicts: string[]; edits: Array<{ matchNumber: number; edit: UpdateSportEventMatchRequest }> } {
  const byNumber = new Map(storedBracket.map((match) => [match.matchNumber, match]));
  const numberById = new Map(storedBracket.map((match) => [match.id, match.matchNumber]));
  const participantOfRow = new Map(storedField.map((row) => [row.id, row.participantId]));
  const fileNumbers = new Set(matches.map((match) => match.matchNumber));
  const missing = matches.filter((match) => !byNumber.has(match.matchNumber)).map((match) => match.matchNumber);
  const extra = storedBracket.filter((match) => !fileNumbers.has(match.matchNumber)).map((match) => match.matchNumber);
  const timeMoved = (match: SportDataMatch, stored: StoredMatch): boolean => match.scheduledAt !== undefined
    && (stored.scheduledDate === null || Date.parse(stored.scheduledDate) !== Date.parse(match.scheduledAt));
  const sameSide = (key: string | null, rowId: string | null): boolean => {
    if (key === null) return rowId === null;
    if (rowId !== null && filled.get(key)?.id === rowId) return true;
    const participantId = participantIds.get(key) ?? null;
    return participantId !== null && rowId !== null && participantOfRow.get(rowId) === participantId;
  };
  const sameLink = (match: SportDataMatch, stored: StoredMatch): boolean => {
    const advancesTo = stored.advancesToMatchId === null ? null : numberById.get(stored.advancesToMatchId) ?? null;
    return advancesTo === (match.advancesTo?.matchNumber ?? null) && stored.advancesToSide === (match.advancesTo?.side ?? null)
      && stored.regionLabel === (match.regionLabel ?? null);
  };

  if (locked) {
    const repaired = matches.filter((match) => {
      const stored = byNumber.get(match.matchNumber);
      return stored !== undefined && (stored.roundNumber !== match.roundNumber || !sameLink(match, stored)
        || (match.home !== null && !sameSide(match.home, stored.homeSportEventParticipantId))
        || (match.away !== null && !sameSide(match.away, stored.awaySportEventParticipantId)));
    }).map((match) => match.matchNumber);
    const conflicts = [
      ...(missing.length > 0 ? [`${matchList(missing)} not on the site`] : []),
      ...(extra.length > 0 ? [`${matchList(extra)} not in the file`] : []),
      ...(repaired.length > 0 ? [`pairing, round, link or region of ${matchList(repaired)} differs`] : []),
    ];
    const edits = matches.flatMap((match) => {
      const stored = byNumber.get(match.matchNumber);
      if (!stored) return [];
      const edit: UpdateSportEventMatchRequest = {};
      if (stored.isNeutralSite !== match.isNeutralSite) edit.isNeutralSite = match.isNeutralSite;
      if (match.scheduledAt !== undefined && timeMoved(match, stored)) edit.scheduledDate = new Date(match.scheduledAt).toISOString();
      return Object.keys(edit).length > 0 ? [{ matchNumber: match.matchNumber, edit }] : [];
    });
    return { changes: edits.length > 0 ? [`time or site of ${matchList(edits.map((entry) => entry.matchNumber))}`] : [], conflicts, edits };
  }

  if (storedBracket.length === 0) return { changes: [`${matches.length} matches`], conflicts: [], edits: [] };
  const changed = matches.filter((match) => {
    const stored = byNumber.get(match.matchNumber);
    if (!stored) return false;
    return stored.roundNumber !== match.roundNumber
      || !sameSide(match.home, stored.homeSportEventParticipantId)
      || !sameSide(match.away, stored.awaySportEventParticipantId)
      || stored.isNeutralSite !== match.isNeutralSite
      || timeMoved(match, stored)
      || !sameLink(match, stored);
  }).map((match) => match.matchNumber);
  const changes = [
    ...(changed.length > 0 ? [`${matchList(changed)} changed`] : []),
    ...(missing.length > 0 ? [`${matchList(missing)} added`] : []),
    ...(extra.length > 0 ? [`${matchList(extra)} removed`] : []),
  ];
  return { changes: changes.length > 0 ? [...changes, 'bracket loaded whole again'] : [], conflicts: [], edits: [] };
}

class Loader {
  readonly rows: LoadRow[] = [];
  private readonly apply: boolean;
  private readonly contents: ReadonlySet<SportDataContent>;
  private readonly offsetDays: number;
  private readonly log: (line: string) => void;
  /** A test seed's withdrawals come from its made-up scores, so it never reinstates a player. */
  private readonly testSeed: boolean;
  private readonly replaceField: boolean;

  private readonly file: SportDataFile;

  constructor(file: SportDataFile, private readonly options: LoadSportDataOptions, private readonly sportId: string) {
    this.apply = options.mode === LoadMode.APPLY;
    this.contents = new Set(file.scope.contents);
    this.testSeed = file.testData && this.contents.has(SportDataContent.RESULTS);
    this.offsetDays = this.testSeed ? seedDateOffsetDays(file, options.now) : 0;
    // A test seed's game times move with its event dates.
    this.file = shiftedMatchTimes(file, this.offsetDays);
    this.log = options.log ?? (() => {});
    this.replaceField = options.replaceField ?? false;
  }

  private get sport(): Sport {
    return this.file.scope.sport;
  }

  /**
   * A finishing order comes from no feed: an admin enters it. Automatic lifecycle would
   * complete such an event at its end time and settle its contests on no result, so the loader
   * creates it with the lifecycle run by hand (docs/RACE-SETUP-PROCEDURES.md).
   */
  private get resultsEnteredByHand(): boolean {
    return getSportDefinition(this.sport).scoringFamily === ScoringFamily.FINISH_POSITION;
  }

  private report(row: LoadRow): void {
    this.rows.push(row);
    if (row.action !== LoadAction.SKIP) this.log(`${row.sportLeague}: ${row.action} ${row.subject} ${row.name}${row.detail ? ` (${row.detail})` : ''}`);
  }

  async run(): Promise<void> {
    if (this.offsetDays > 0) this.log(`Moving ${this.file.scope.season} test dates forward ${this.offsetDays} days.`);
    for (const league of this.file.sportLeagues) await this.loadLeague(league);
  }

  /**
   * The league's id, or null in a dry run that would create it. A bracket rule the file names
   * is set on a new league, and changed on an existing one that has another.
   */
  private async ensureLeague(client: Client, league: SportDataLeague): Promise<string | null> {
    const { name, bracketAdvancement } = league;
    const { sportLeagues } = await must(listSportLeagues({ client, query: { sport: this.sport } }), 'List sport leagues');
    const existing = sportLeagues.find((row) => row.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const changed = bracketAdvancement !== undefined && existing.bracketAdvancement !== bracketAdvancement;
      this.report({
        sportLeague: name,
        subject: LoadSubject.SPORT_LEAGUE,
        action: changed ? LoadAction.UPDATE : LoadAction.SKIP,
        name,
        detail: changed ? `bracket advancement ${existing.bracketAdvancement} -> ${bracketAdvancement}` : null,
      });
      if (changed && this.apply) {
        await must(updateSportLeague({ client, path: { sportLeagueId: existing.id }, body: { bracketAdvancement } }), `Update sport league ${name}`);
      }
      return existing.id;
    }
    this.report({ sportLeague: name, subject: LoadSubject.SPORT_LEAGUE, action: LoadAction.ADD, name, detail: null });
    if (!this.apply) return null;
    const created = await must(createSportLeague({ client, body: { sport: this.sport, name, matchKeyword: name, ...(bracketAdvancement && { bracketAdvancement }) } }), `Create sport league ${name}`);
    return created.sportLeague.id;
  }

  /**
   * Each player's participant id (null in a dry run that would create it): found by
   * externalId, then exact name, else created. A player not yet on the league joins it at the
   * file's ranking; one already on it keeps the ranking it has.
   */
  private async ensurePlayers(client: Client, league: SportDataLeague, sportLeagueId: string | null): Promise<Map<string, string | null>> {
    const { participants } = await must(listParticipants({ client, query: { sportId: this.sportId } }), 'List players');
    const byExternalId = new Map(participants.flatMap((p) => (p.externalId ? [[p.externalId, p.id] as const] : [])));
    const byName = new Map(participants.map((p) => [p.name.toLowerCase(), p.id]));
    const affiliated = new Set<string>();
    if (sportLeagueId) {
      const { affiliations } = await must(listParticipantLeagueAffiliations({ client, path: { sportLeagueId } }), `List ${league.name} players`);
      for (const affiliation of affiliations) affiliated.add(affiliation.participantId);
    }

    const ids = new Map<string, string | null>();
    const joins: Array<{ participantId: string; ranking: number }> = [];
    for (const player of league.players) {
      let id = byExternalId.get(player.key) ?? byName.get(player.name.toLowerCase()) ?? null;
      if (id === null) {
        this.report({ sportLeague: league.name, subject: LoadSubject.PLAYER, action: LoadAction.ADD, name: player.name, detail: `ranked ${player.ranking}` });
        if (this.apply) {
          const created = await must(createParticipant({
            client,
            body: { sportId: this.sportId, participantType: getSportDefinition(this.sport).participantType, name: player.name, externalId: player.key, nationality: player.countryCode, ...splitName(player.name) },
          }), `Create player ${player.name}`);
          id = created.participant.id;
          joins.push({ participantId: id, ranking: player.ranking });
        }
      } else if (!affiliated.has(id)) {
        this.report({ sportLeague: league.name, subject: LoadSubject.PLAYER, action: LoadAction.UPDATE, name: player.name, detail: `joins ${league.name}, ranked ${player.ranking}` });
        joins.push({ participantId: id, ranking: player.ranking });
      } else {
        this.report({ sportLeague: league.name, subject: LoadSubject.PLAYER, action: LoadAction.SKIP, name: player.name, detail: null });
      }
      ids.set(player.key, id);
    }
    if (this.apply && joins.length > 0) {
      await must(applyParticipantLeagueAffiliationUpload({ client, path: { sportLeagueId: found(sportLeagueId ?? undefined, `${league.name}'s id`) }, body: { rows: joins } }), `Add players to ${league.name}`);
    }
    return ids;
  }

  private async loadLeague(league: SportDataLeague): Promise<void> {
    const client = await this.options.getClient();
    const sportLeagueId = await this.ensureLeague(client, league);
    const participantIds = this.contents.has(SportDataContent.PLAYERS)
      ? await this.ensurePlayers(client, league, sportLeagueId)
      : new Map<string, string | null>();

    const stored = sportLeagueId
      ? (await must(listEvents({ client, query: { sportLeagueId, eventYear: this.file.scope.season } }), `List ${league.name} events`)).events
      : [];
    const matches = this.matchEvents(league, stored);
    for (const event of league.events) {
      await this.loadEvent(await this.options.getClient(), { league, sportLeagueId, event, stored: matches.get(event) ?? null, participantIds });
    }
  }

  /**
   * Each file event's stored event: same name (any case), else the one unclaimed event whose
   * start is within a few days, which is how a sponsor's rename is found.
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
    const compareDates = !this.file.testData || stored.status === SportEventStatus.DRAFT;
    // A file that gives the exact start (a post time) moves a start on the same day too.
    const startChanged = event.startsAt === undefined
      ? day(stored.startDate) !== day(dates.startDate)
      : Date.parse(stored.startDate) !== Date.parse(dates.startDate);
    if (compareDates && startChanged) {
      body.startDate = dates.startDate;
      changes.push(event.startsAt === undefined
        ? `start ${day(stored.startDate)} → ${day(dates.startDate)}`
        : `start ${stored.startDate} → ${dates.startDate}`);
    }
    // With an exact start the end can sit at the start (an evening post time), so it moves with it.
    const endChanged = event.startsAt === undefined
      ? day(stored.endDate) !== day(dates.endDate)
      : stored.endDate === null || Date.parse(stored.endDate) !== Date.parse(dates.endDate);
    if (compareDates && endChanged) {
      body.endDate = dates.endDate;
      changes.push(event.startsAt === undefined
        ? `end ${day(stored.endDate) ?? 'none'} → ${day(dates.endDate)}`
        : `end ${stored.endDate ?? 'none'} → ${dates.endDate}`);
    }
    if (this.resultsEnteredByHand && stored.autoLifecycleEnabled) {
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
   * list is to be removed instead. A play-in place already filled with its winner (`filled`,
   * by player key) is that entry's row, and is left as it is.
   */
  private fieldChanges(
    league: SportDataLeague,
    event: FieldSource,
    participantIds: ReadonlyMap<string, string | null>,
    storedField: readonly StoredFieldRow[],
    filled: ReadonlyMap<string, StoredFieldRow> = new Map(),
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
    const remarked: string[] = [];
    event.field.forEach((entry, index) => {
      const name = players.get(entry.player) ?? entry.player;
      const participantId = found(participantIds.get(entry.player), `${event.name}: the participant id for ${entry.player}`);
      const filledPlace = filled.get(entry.player);
      if (filledPlace) {
        listed.add(filledPlace.participantId);
        return;
      }
      const row = participantId === null ? undefined : byParticipant.get(participantId);
      if (participantId !== null) listed.add(participantId);
      if (!row) add.push({ name, participantId });
      const patch: Omit<FieldPatch, 'sportEventParticipantId'> = {};
      if (entry.ranking !== undefined && row?.ranking !== entry.ranking) patch.ranking = entry.ranking;
      const seed = entry.seed ?? index + 1;
      if (row?.seedNumber !== seed) patch.seedNumber = seed;
      if (entry.isPlayInPlace !== undefined && (row?.isPlayInPlace ?? false) !== entry.isPlayInPlace) {
        patch.isPlayInPlace = entry.isPlayInPlace;
        remarked.push(name);
      }
      if (entry.oddsToWin !== undefined && row?.oddsToWin !== entry.oddsToWin) patch.oddsToWin = entry.oddsToWin;
      // Back in the field after a withdrawal (a re-commitment).
      if (!this.testSeed && row && !row.isActive && row.inactiveReason === 'WITHDRAWN') {
        patch.isActive = true;
        patch.inactiveReason = null;
        reinstated.push(name);
      }
      if (participantId !== null && Object.keys(patch).length > 0) patches.push({ participantId, patch });
    });
    const unlisted = storedField.filter((row) => !listed.has(row.participantId));
    const removed = this.replaceField ? unlisted : [];
    const withdrawn = this.replaceField ? [] : unlisted.filter((row) => row.isActive);
    const addedIds = new Set(add.map((entry) => entry.participantId));
    const updated = patches.filter(({ participantId, patch }) => !addedIds.has(participantId) && patch.isActive === undefined
      && (patch.ranking !== undefined || patch.seedNumber !== undefined || patch.oddsToWin !== undefined)).length;
    const changes = [
      ...(add.length > 0 ? [`${add.length} added (${names(add.map((entry) => entry.name))})`] : []),
      ...(updated > 0 ? [`${updated} re-ranked or re-seeded`] : []),
      ...(remarked.length > 0 ? [`${remarked.length} play-in marks changed (${names(remarked)})`] : []),
      ...(reinstated.length > 0 ? [`${reinstated.length} reinstated (${names(reinstated)})`] : []),
      ...(withdrawn.length > 0 ? [`${withdrawn.length} withdrawn (${names(withdrawn.map((row) => row.participant.name))})`] : []),
      ...(removed.length > 0 ? [`${removed.length} removed (${names(removed.map((row) => row.participant.name))}); any a contest entry has picked are withdrawn instead`] : []),
    ];
    return { add, patches, withdrawn, removed, changes };
  }

  private async loadEvent(client: Client, input: {
    league: SportDataLeague;
    sportLeagueId: string | null;
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
      this.report({ ...at, subject: LoadSubject.EVENT, action: LoadAction.ADD, detail: this.file.testData ? 'released with odds, tiers, prices and scores' : null });
      if (loadsField) {
        const plan = this.fieldChanges(league, event, participantIds, []);
        this.report({ ...at, subject: LoadSubject.FIELD, action: LoadAction.ADD, detail: `${plan.add.length} players` });
      }
      if (loadsBracket) this.report({ ...at, subject: LoadSubject.BRACKET, action: LoadAction.ADD, detail: `${matches.length} matches` });
      if (!this.apply) return;
      const created = await must(createEvent({
        client,
        body: {
          sportLeagueId: found(input.sportLeagueId ?? undefined, `${league.name}'s id`),
          eventYear: this.file.scope.season,
          name: event.name,
          ...(event.venue ? { venue: event.venue } : {}),
          ...(event.location ? { location: event.location } : {}),
          ...shiftedEventDates(event, this.offsetDays),
          rounds: event.rounds,
          ...(this.file.testData || this.resultsEnteredByHand ? { autoLifecycleEnabled: false } : {}),
        },
      }), `Create ${event.name}`);
      if (event.roundsPar !== null) {
        await must(updateEvent({ client, path: { eventId: created.event.id }, body: { roundsPar: event.roundsPar } }), `Set par for ${event.name}`);
      }
      if (loadsField) await this.writeField(client, created.event.id, league, event, participantIds, []);
      if (loadsBracket) await this.writeBracket(client, created.event.id, event, participantIds, []);
      if (this.file.testData) await this.finishTestEvent(client, created.event.id, event, participantIds);
      return;
    }

    const editable = EDITABLE_STATUSES.has(stored.status);
    // Release locks a bracket event's pairings, seeds and play-in places with its field.
    const bracketLocked = sportPlaysBracket(this.sport) && stored.status !== SportEventStatus.DRAFT;
    const eventPlan = loadsSchedule ? this.eventChanges(event, stored) : { body: {}, changes: [] };
    const storedField = loadsField || loadsBracket
      ? (await must(listEventParticipants({ client, path: { eventId: stored.id } }), `Read the field of ${event.name}`)).participants
      : [];
    const storedBracket = loadsBracket || (loadsField && bracketLocked)
      ? (await must(getEventBracket({ client, path: { eventId: stored.id } }), `Read the bracket of ${event.name}`)).matches
      : [];
    const filled = bracketLocked ? filledPlayInPlaces(event, participantIds, storedField, storedBracket) : new Map<string, StoredFieldRow>();
    const fieldPlan = loadsField ? this.fieldChanges(league, event, participantIds, storedField, filled) : null;
    const bracketPlan = loadsBracket ? bracketChanges(matches, participantIds, storedField, storedBracket, { locked: bracketLocked, filled }) : null;
    const finishesDraft = this.file.testData && stored.status === SportEventStatus.DRAFT;

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

    const eventDetail = [...eventPlan.changes, ...(finishesDraft ? ['finishes the draft: odds, tiers, prices, scores, release'] : [])];
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
        for (const { matchNumber, edit } of bracketPlan.edits) {
          await must(updateEventBracketMatch({ client, path: { eventId: stored.id, matchNumber }, body: edit }), `Update match ${matchNumber} of ${event.name}`);
        }
      } else {
        await this.writeBracket(client, stored.id, event, participantIds, storedBracket);
      }
    }
    if (finishesDraft) await this.finishTestEvent(client, stored.id, event, participantIds);
  }

  /**
   * Loads the file's bracket whole, each side's player key turned into its field row; a match
   * time the file leaves out keeps the one stored for that match number.
   */
  private async writeBracket(client: Client, eventId: string, event: SportDataEvent, participantIds: ReadonlyMap<string, string | null>, storedBracket: readonly StoredMatch[]): Promise<void> {
    const { participants: rows } = await must(listEventParticipants({ client, path: { eventId } }), `Read the field of ${event.name}`);
    const rowByParticipant = new Map(rows.map((row) => [row.participantId, row.id]));
    const storedTime = new Map(storedBracket.map((match) => [match.matchNumber, match.scheduledDate]));
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
      scheduledDate: match.scheduledAt === undefined ? storedTime.get(match.matchNumber) ?? null : new Date(match.scheduledAt).toISOString(),
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
      } else if (result.error !== undefined || !(result.response as Response | undefined)?.ok) {
        // Typed as always present, but hey-api leaves the response undefined when the fetch itself throws.
        throw new Error(`Remove ${row.participant.name} from the field of ${event.name} failed (HTTP ${(result.response as Response | undefined)?.status ?? 'none'}): ${JSON.stringify(result.error)}`);
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
      ...[...plan.withdrawn, ...picked.filter((row) => row.isActive)]
        .map((row) => ({ sportEventParticipantId: row.id, isActive: false, inactiveReason: 'WITHDRAWN' as const })),
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
      throw new Error(`${editable.length} ${league.name} events not yet started are named ${eventName} (${editable.map((event) => event.eventYear).join(', ')}); rename one so the name picks one event.`);
    }
    if (editable.length === 0) {
      this.report({ ...at, subject: LoadSubject.EVENT, action: LoadAction.CONFLICT, detail: `${named.map((event) => event.status).join(', ')}, so its field is not changed` });
      return;
    }
    const stored = editable[0];

    this.report({ sportLeague: league.name, subject: LoadSubject.SPORT_LEAGUE, action: LoadAction.SKIP, name: league.name, detail: null });
    const participantIds = await this.ensurePlayers(client, league, sportLeague.id);
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

  /** The made-up parts of a test seed: tiers by odds, default prices, stored scores or results, release. */
  private async finishTestEvent(client: Client, eventId: string, event: SportDataEvent, participantIds: ReadonlyMap<string, string | null>): Promise<void> {
    const path = { eventId };
    await must(autoAssignEventTiers({ client, path, body: { source: 'ODDS' } }), `Assign tiers for ${event.name}`);
    await must(autoAssignEventPrices({ client, path, body: await defaultPricing(client) }), `Assign prices for ${event.name}`);
    if (sportPlaysBracket(this.sport)) {
      await must(releaseEvent({ client, path }), `Release ${event.name}`);
      await fillPlayInPlacesFor(client, eventId, event, participantIds);
      await enterBracketResultsFor(client, eventId, event);
      return;
    }
    if (this.resultsEnteredByHand) {
      // Results before release, so a run that dies between them leaves a draft the rerun finishes.
      await enterRaceResultsFor(client, eventId, event, participantIds);
      await must(releaseEvent({ client, path }), `Release ${event.name}`);
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
    await must(releaseEvent({ client, path }), `Release ${event.name}`);
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
 * A bracket test seed's play-in winners, set on the released event before any result: each place
 * the file gives a winner (the NBA play-in's 7 and 8 seeds) then names that team, keeping its seed,
 * tier, price and bracket side, as an admin's "Set winner" does.
 */
async function fillPlayInPlacesFor(client: Client, eventId: string, event: SportDataEvent, participantIds: ReadonlyMap<string, string | null>): Promise<void> {
  const places = event.field.filter((entry): entry is typeof entry & { playInWinner: string } => entry.playInWinner !== undefined);
  if (places.length === 0) return;
  const { participants: rows } = await must(listEventParticipants({ client, path: { eventId } }), `Read the field of ${event.name}`);
  for (const place of places) {
    const placeId = found(participantIds.get(place.player) ?? undefined, `${event.name}: the participant id for ${place.player}`);
    const winnerId = found(participantIds.get(place.playInWinner) ?? undefined, `${event.name}: the participant id for ${place.playInWinner}`);
    const row = found(rows.find((candidate) => candidate.participantId === placeId), `${event.name}: the field row of ${place.player}`);
    await must(setEventPlayInWinner({ client, path: { eventId, sportEventParticipantId: row.id }, body: { participantId: winnerId } }), `Set the winner of ${place.player} in ${event.name}`);
  }
}

/**
 * A bracket test seed's results, entered on the released event round by round. A round placed by
 * reseeding (its sides wait on no link) takes the server's proposed pairing first, the rule a
 * real reseed follows; each match's result then names the side as the match stands. Which rounds
 * reseed is the server's rule (reseededRounds in bracket-reseed.ts), read here from the file's
 * links; keep the two alike.
 */
async function enterBracketResultsFor(client: Client, eventId: string, event: SportDataEvent): Promise<void> {
  const matches = event.matches ?? [];
  const rounds = [...new Set(matches.map((match) => match.roundNumber))].sort((left, right) => left - right);
  const linked = new Set(matches.flatMap((match) => (match.advancesTo ? [`${match.advancesTo.matchNumber}/${match.advancesTo.side}`] : [])));
  for (const roundNumber of rounds) {
    const round = matches.filter((match) => match.roundNumber === roundNumber);
    const waitsOnReseed = round.some((match) => (match.home === null && !linked.has(`${match.matchNumber}/${MatchSide.HOME}`))
      || (match.away === null && !linked.has(`${match.matchNumber}/${MatchSide.AWAY}`)));
    const results = round.flatMap((match) => (match.result ? [{ matchNumber: match.matchNumber, result: match.result }] : []));
    if (results.length === 0) continue;
    if (waitsOnReseed) {
      const proposal = await must(proposeEventRoundMatchups({ client, path: { eventId, roundNumber } }), `Propose round ${roundNumber} of ${event.name}`);
      await must(setEventRoundMatchups({ client, path: { eventId, roundNumber }, body: { matches: proposal.matches } }), `Place round ${roundNumber} of ${event.name}`);
    }
    for (const { matchNumber, result } of results) {
      const body = { winnerSide: result.winner, homeScore: result.homeScore, awayScore: result.awayScore };
      await must(recordEventMatchResult({ client, path: { eventId, matchNumber }, body }), `Enter the result of match ${matchNumber} of ${event.name}`);
    }
  }
}

/** Loads the file, or in a dry run reports what loading it would do. Returns one row per subject. */
export async function loadSportData(file: SportDataFile, options: LoadSportDataOptions): Promise<LoadRow[]> {
  const { sports } = await must(listSports({ client: await options.getClient() }), 'List sports');
  const sportRow = findSportRow(sports, file.scope.sport);
  if (!sportRow) throw new Error(`No ${file.scope.sport} sport row; the reference-data migration has not run.`);
  const loader = new Loader(file, options, sportRow.id);
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
