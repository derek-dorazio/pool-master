/**
 * The pool side of a QA test seed: test players, a league for each sport league in the file,
 * contests on its first upcoming events and a submitted entry from every player's squad, so a
 * tester opens QA to leagues with members, contests, picks and leaderboards to look at.
 *
 * It is test data and nothing like production use, so it runs only on a test target
 * (refuseUnlessTestTarget) and only after the file itself has loaded, since contests need the
 * file's released events.
 *
 * Everything goes in through the public API the screens use. The root admin creates each
 * league and so is its commissioner; each player signs up, joins through a league invite link
 * (which gives them their squad), enters each contest and makes picks as themselves.
 *
 * Re-entrant: each step looks first and does only what is missing, so a second run reports
 * every row as a skip and a run after a part-way failure fills in the rest. A player whose
 * entry is still a draft gets the picks it lacks and is submitted; a submitted entry is left
 * alone. A contest whose event has started is never touched.
 */

import { ContestEntryStatus, ContestFormat, ContestStatus, LeagueMembershipStatus, SelectionType } from '@poolmaster/shared/domain';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import type { ContestConfigTemplateListResponse, ContestListResponse, SportEventListResponse } from '@poolmaster/shared/generated/hey-api';
import {
  acceptInvitation,
  createContest,
  createLeague,
  enterContest,
  generateInviteLink,
  getLeagueByCode,
  getSelectionState,
  listContestConfigTemplates,
  listContestEntries,
  listContests,
  listEvents,
  listLeagueMembers,
  listLeagueSquads,
  listSportLeagues,
  listUsers,
  openContest,
  registerUser,
  submitContestEntry,
  submitContestSelection,
} from '@poolmaster/shared/generated/hey-api';
import { LoadAction, LoadMode, LoadSubject, type LoadRow } from './load-report';
import type { SportDataFile } from './sport-data-file';
import { choosePicks, testLeagueCode, testLeagueName } from './test-participants-data';

export { refuseUnlessTestTarget } from './test-participants-data';

/** One test player: a sign-up the run creates once and signs in as from then on. */
export interface TestPlayer {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * QA's test players. example.com never takes mail, so nothing the site sends them leaves it.
 * They are ordinary members, never admins.
 */
export const QA_TEST_PLAYERS: readonly TestPlayer[] = [
  { username: 'qa-avery-adams', email: 'qa.avery.adams@example.com', firstName: 'Avery', lastName: 'Adams' },
  { username: 'qa-blake-brooks', email: 'qa.blake.brooks@example.com', firstName: 'Blake', lastName: 'Brooks' },
  { username: 'qa-casey-carter', email: 'qa.casey.carter@example.com', firstName: 'Casey', lastName: 'Carter' },
  { username: 'qa-devon-diaz', email: 'qa.devon.diaz@example.com', firstName: 'Devon', lastName: 'Diaz' },
  { username: 'qa-emery-evans', email: 'qa.emery.evans@example.com', firstName: 'Emery', lastName: 'Evans' },
  { username: 'qa-finley-fox', email: 'qa.finley.fox@example.com', firstName: 'Finley', lastName: 'Fox' },
];

/** Every QA test player's password; a tester signs in as any of them with it. */
export const QA_TEST_PLAYER_PASSWORD = 'QaTestPlayer2026';

/** Access tokens last 15 minutes; a player signs in again well before that. */
const SIGN_IN_AGAIN_AFTER_MS = 10 * 60 * 1000;

/** How many of each sport league's upcoming events get a contest. */
export const CONTESTS_PER_SPORT_LEAGUE = 3;

export interface LoadTestParticipantsOptions {
  /** A root-admin client; it creates each league and so is its commissioner. */
  getClient: () => Promise<Client>;
  /** Signs in as a player and returns their client. */
  signIn: (identifier: string, password: string) => Promise<Client>;
  mode: LoadMode;
  log?: (line: string) => void;
  /** Defaults to QA's test players. */
  players?: readonly TestPlayer[];
  password?: string;
}

type StoredEvent = SportEventListResponse['events'][number];
type StoredContest = ContestListResponse['contests'][number];
type Template = ContestConfigTemplateListResponse['templates'][number];

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

function playerName(player: TestPlayer): string {
  return `${player.firstName} ${player.lastName}`;
}

class ParticipantLoader {
  readonly rows: LoadRow[] = [];
  private readonly apply: boolean;
  private readonly players: readonly TestPlayer[];
  private readonly password: string;
  private readonly log: (line: string) => void;
  private readonly userIds = new Map<string, string>();
  private readonly playerClients = new Map<string, { client: Client; at: number }>();

  constructor(private readonly file: SportDataFile, private readonly options: LoadTestParticipantsOptions) {
    this.apply = options.mode === LoadMode.APPLY;
    this.players = options.players ?? QA_TEST_PLAYERS;
    this.password = options.password ?? QA_TEST_PLAYER_PASSWORD;
    this.log = options.log ?? (() => {});
  }

  private report(row: LoadRow): void {
    this.rows.push(row);
    if (row.action !== LoadAction.SKIP) this.log(`${row.sportLeague}: ${row.action} ${row.subject} ${row.name}${row.detail ? ` (${row.detail})` : ''}`);
  }

  async run(): Promise<void> {
    await this.ensurePlayers();
    for (const league of this.file.sportLeagues) await this.loadLeague(league.name, new Set(league.events.map((event) => event.name)));
  }

  /** Each test player signed up once; their user id by username. */
  private async ensurePlayers(): Promise<void> {
    const client = await this.options.getClient();
    for (const player of this.players) {
      const { users } = await must(listUsers({ client, query: { search: player.username } }), `Look up ${player.username}`);
      const existing = users.find((user) => user.username === player.username);
      if (existing) {
        this.userIds.set(player.username, existing.id);
        this.report({ sportLeague: '', subject: LoadSubject.TEST_PLAYER, action: LoadAction.SKIP, name: playerName(player), detail: null });
        continue;
      }
      this.report({ sportLeague: '', subject: LoadSubject.TEST_PLAYER, action: LoadAction.ADD, name: playerName(player), detail: player.username });
      if (!this.apply) continue;
      const body = { username: player.username, email: player.email, password: this.password, firstName: player.firstName, lastName: player.lastName };
      const registered = await must(registerUser({ client, body }), `Sign up ${player.username}`);
      this.userIds.set(player.username, registered.user.id);
    }
  }

  /** A player's client, signed in again well before their access token runs out, as the admin's is. */
  private async playerClient(player: TestPlayer): Promise<Client> {
    const cached = this.playerClients.get(player.username);
    if (cached && Date.now() - cached.at < SIGN_IN_AGAIN_AFTER_MS) return cached.client;
    const client = await this.options.signIn(player.username, this.password);
    this.playerClients.set(player.username, { client, at: Date.now() });
    return client;
  }


  private async loadLeague(sportLeagueName: string, fileEvents: ReadonlySet<string>): Promise<void> {
    const client = await this.options.getClient();
    const code = testLeagueCode(sportLeagueName);
    const name = testLeagueName(sportLeagueName);
    const row = (subject: LoadSubject, action: LoadAction, rowName: string, detail: string | null = null): void => {
      this.report({ sportLeague: sportLeagueName, subject, action, name: rowName, detail });
    };

    const found = await getLeagueByCode({ client, path: { leagueCode: code } });
    let leagueId = found.data?.league.id ?? null;
    // Typed as always present, but hey-api leaves it undefined when the fetch itself throws.
    const status = (found.response as Response | undefined)?.status;
    if (leagueId === null && status !== 404) {
      throw new Error(`Look up league ${code} failed (HTTP ${status ?? 'none'}): ${JSON.stringify(found.error)}`);
    }
    row(LoadSubject.TEST_LEAGUE, leagueId === null ? LoadAction.ADD : LoadAction.SKIP, name, leagueId === null ? code : null);
    if (leagueId === null && this.apply) {
      const description = 'Test players and their entries, loaded with the test data.';
      leagueId = (await must(createLeague({ client, body: { name, leagueCode: code, description } }), `Create league ${name}`)).league.id;
    }

    // Members: every player joins through one invite link, made only when someone needs it.
    const members = leagueId === null ? [] : (await must(listLeagueMembers({ client, path: { id: leagueId } }), `List members of ${name}`)).members;
    const active = new Set(members.filter((member) => member.status === LeagueMembershipStatus.ACTIVE).map((member) => member.userId));
    let inviteCode: string | null = null;
    for (const player of this.players) {
      const userId = this.userIds.get(player.username);
      if (userId !== undefined && active.has(userId)) {
        row(LoadSubject.TEST_MEMBER, LoadAction.SKIP, playerName(player));
        continue;
      }
      row(LoadSubject.TEST_MEMBER, LoadAction.ADD, playerName(player), 'joins with an invite link');
      if (!this.apply || leagueId === null) continue;
      inviteCode ??= (await must(generateInviteLink({ client, path: { id: leagueId }, body: { expiresInDays: 1, maxUses: 0 } }), `Make an invite link for ${name}`)).invitation.inviteCode;
      await must(acceptInvitation({ client: await this.playerClient(player), body: { inviteCode } }), `${playerName(player)} joins ${name}`);
    }

    const events = await this.upcomingEvents(client, sportLeagueName, fileEvents);
    if (events.length === 0) this.log(`${sportLeagueName}: no upcoming released event to run a contest on.`);
    const contests = leagueId === null ? [] : (await must(listContests({ client, path: { id: leagueId } }), `List contests of ${name}`)).contests;
    for (const event of events) {
      const contest: StoredContest | undefined = contests.find((candidate) => candidate.sportEvents.some((contestEvent) => contestEvent.sportEventId === event.id));
      let contestId = contest?.id ?? null;
      const contestName = `${event.name} picks`;
      if (contest && contest.status !== ContestStatus.DRAFT) {
        row(LoadSubject.CONTEST, LoadAction.SKIP, contestName);
      } else {
        row(LoadSubject.CONTEST, contest ? LoadAction.UPDATE : LoadAction.ADD, contestName, contest ? 'opened' : 'created from the default template and opened');
        if (this.apply && leagueId !== null) contestId = await this.createAndOpen(client, leagueId, event, contestId, contestName);
      }
      await this.loadEntries(sportLeagueName, leagueId, contestId, event.id, contestName);
    }
  }

  /** The file's first released events still open for entries, soonest first. */
  private async upcomingEvents(client: Client, sportLeagueName: string, fileEvents: ReadonlySet<string>): Promise<StoredEvent[]> {
    const sport = this.file.scope.sport;
    const { sportLeagues } = await must(listSportLeagues({ client, query: { sport } }), `List ${sport} sport leagues`);
    const sportLeague = sportLeagues.find((league) => league.name === sportLeagueName);
    if (!sportLeague) return [];
    const { events } = await must(listEvents({ client, query: { sportLeagueId: sportLeague.id } }), `List the events of ${sportLeagueName}`);
    return events
      .filter((event) => event.contestEligible && fileEvents.has(event.name))
      .sort((left, right) => left.startDate.localeCompare(right.startDate))
      .slice(0, CONTESTS_PER_SPORT_LEAGUE);
  }

  private async template(client: Client, event: StoredEvent): Promise<Template> {
    const { templates } = await must(listContestConfigTemplates({
      client,
      query: { sport: event.sport, sportLeagueId: event.sportLeagueId, contestFormat: ContestFormat.ROSTER, active: true },
    }), `List contest templates for ${event.name}`);
    // A draw deals its picks to every entry at once and closes them, so the run picks for itself instead.
    const pickable = templates.filter((template) => template.selectionType !== SelectionType.RANDOM_DRAW);
    const ranked = [...pickable].sort((left, right) => Number(right.sportLeagueId !== null) - Number(left.sportLeagueId !== null)
      || Number(right.isDefault) - Number(left.isDefault) || left.sortOrder - right.sortOrder);
    const chosen = ranked.at(0);
    if (!chosen) throw new Error(`No tiered or budget contest template for ${event.sport}.`);
    return chosen;
  }

  /** Creates the contest unless it is already there as a draft, then opens it; returns its id. */
  private async createAndOpen(client: Client, leagueId: string, event: StoredEvent, draftId: string | null, contestName: string): Promise<string> {
    let contestId = draftId;
    if (contestId === null) {
      const template = await this.template(client, event);
      contestId = (await must(createContest({
        client,
        path: { id: leagueId },
        body: { name: contestName, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: template.selectionType, templateId: template.id },
      }), `Create ${contestName}`)).contest.id;
    }
    await must(openContest({ client, path: { id: leagueId, contestId } }), `Open ${contestName}`);
    return contestId;
  }

  /** One entry from each player's squad, submitted for the contest's event. */
  private async loadEntries(sportLeagueName: string, leagueId: string | null, contestId: string | null, sportEventId: string, contestName: string): Promise<void> {
    const client = await this.options.getClient();
    const squads = leagueId === null ? [] : (await must(listLeagueSquads({ client, path: { id: leagueId } }), `List squads of ${sportLeagueName}`)).squads;
    const entries = contestId === null ? [] : (await must(listContestEntries({ client, path: { contestId } }), `List entries of ${contestName}`)).entries;
    for (const [index, player] of this.players.entries()) {
      const userId = this.userIds.get(player.username);
      const squad = squads.find((candidate) => candidate.isActive && candidate.members?.some((member) => member.userId === userId));
      const entry = squad ? entries.find((candidate) => candidate.squadId === squad.id) : undefined;
      const rowName = `${contestName}: ${playerName(player)}`;
      if (entry?.events.find((entryEvent) => entryEvent.sportEventId === sportEventId)?.status === ContestEntryStatus.SUBMITTED) {
        this.report({ sportLeague: sportLeagueName, subject: LoadSubject.ENTRY, action: LoadAction.SKIP, name: rowName, detail: null });
        continue;
      }
      this.report({ sportLeague: sportLeagueName, subject: LoadSubject.ENTRY, action: entry ? LoadAction.UPDATE : LoadAction.ADD, name: rowName, detail: entry ? 'picks finished and submitted' : 'entered, picked and submitted' });
      if (!this.apply || contestId === null) continue;
      const playerClient = await this.playerClient(player);
      const entryId = entry?.id ?? (await must(enterContest({ client: playerClient, path: { contestId } }), `${playerName(player)} enters ${contestName}`)).entry.id;
      const state = await must(getSelectionState({ client: playerClient, path: { contestId }, query: { entryId, sportEventId } }), `Read ${playerName(player)}'s picks in ${contestName}`);
      for (const participantId of choosePicks(state, index)) {
        await must(submitContestSelection({ client: playerClient, path: { contestId }, body: { entryId, participantId } }), `${playerName(player)} picks in ${contestName}`);
      }
      await must(submitContestEntry({ client: playerClient, path: { contestId, entryId, sportEventId } }), `${playerName(player)} submits in ${contestName}`);
    }
  }
}

/**
 * Loads the test players, leagues, contests and entries for a test seed already on the site,
 * or in a dry run reports what loading them would do.
 */
export async function loadTestParticipants(file: SportDataFile, options: LoadTestParticipantsOptions): Promise<LoadRow[]> {
  if (!file.testData) throw new Error('Test players go with a test data file only.');
  const loader = new ParticipantLoader(file, options);
  await loader.run();
  return loader.rows;
}
