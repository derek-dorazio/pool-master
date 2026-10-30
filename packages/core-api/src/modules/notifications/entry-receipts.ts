/**
 * Entry receipts (#867, catalog row D3) for the formats whose members pick games, a pick'em week,
 * a bracket and a survivor week, and for squares. When an entry's picks for an event are
 * submitted, every active owner of its squad gets a receipt listing them, from the contest's
 * league and no other. A squares entry has no submit: its receipt goes when the numbers are drawn,
 * listing its boxes with their numbers.
 *
 * A receipt is queued once per submission: its outbox idempotency key is the entry, the event and
 * the submit time, so submitting a week, changing it back to a draft and submitting it again
 * sends a second one. A squares draw is final, so its receipt is keyed by the entry alone.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestEntryWithSquad,
  LeagueRepository,
  SportLeagueRepository,
  SquadMembershipRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import {
  PickEmMode,
  SelectionType,
  eventRoundLabel,
  formatSpread,
  getSportDefinition,
  type Contest,
  type League,
  type SportEvent,
  type SportEventMatch,
  type SportLeague,
  type User,
} from '@poolmaster/shared/domain';
import {
  emailRecipientOf,
  EntryReceiptKind,
  buildEmailEventHeader,
  buildEntryUrl,
  formatUserName,
  type ContestEntryCompletedEmailData,
  type EmailSendInput,
  type EmailService,
  type EntryReceipt,
  type GamePickLine,
} from '../email';
import type { GamePickGame, GamePickTeam, GamePicksView } from '../selections/prediction-service';
import type { SquaresBoard } from '../selections/squares-service';

const TEMPLATE_KEY = 'CONTEST_ENTRY_COMPLETED';

/** How many of a bracket's rounds its receipt lists, the final first: the final, the semifinals and the quarterfinals. */
const BRACKET_RECEIPT_ROUNDS = 3;

/**
 * A receipt is sent from what its caller already loaded (#1201): the contest, its entries and its
 * event are never read again here. Only the league, the sport league and the owners are.
 */
export interface EntryReceiptDeps {
  leagues: Pick<LeagueRepository, 'findById'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  users: Pick<UserRepository, 'findByIds'>;
  /** The event's sport league, named on the receipt, and a bracket's round names ("Sweet 16"). */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  email: Pick<EmailService, 'sendMany'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** The submitted week as PredictionService already holds it: the contest, the entry and the event. */
export interface SubmittedWeek {
  contest: Contest;
  entry: ContestEntryWithSquad;
  sportEvent: SportEvent;
}

/** The seam PredictionService calls once an entry's picks for an event are submitted. */
export interface GamePicksReceiptNotice {
  /** Never throws: a receipt that cannot be queued is logged, and the submit stands. */
  gamePicksSubmitted(view: GamePicksView, week: SubmittedWeek): Promise<void>;
}

/** What a squares receipt reads of the drawn board. */
export type DrawnSquaresBoard = Pick<SquaresBoard, 'contest' | 'homeTeamName' | 'awayTeamName' | 'boxes' | 'digits'>;

/** The drawn board with the contest's entries and its event, as SquaresService already holds them. */
export interface DrawnSquares {
  board: DrawnSquaresBoard;
  entries: readonly ContestEntryWithSquad[];
  sportEvent: SportEvent;
}

/** The seam SquaresService calls once a squares contest's numbers are drawn. */
export interface SquaresDrawnNotice {
  /** Never throws: a receipt that cannot be queued is logged, and the draw stands. */
  squaresDrawn(drawn: DrawnSquares): Promise<void>;
}

/** What every receipt of one contest shares: its league, its event's sport league and the squads' active owners. */
interface ReceiptSetting {
  league: League;
  sportLeague: SportLeague | null;
  ownersBySquad: ReadonlyMap<string, User[]>;
}

export class EntryReceipts implements GamePicksReceiptNotice, SquaresDrawnNotice {
  constructor(private readonly deps: EntryReceiptDeps) {}

  /**
   * Queues the receipt for a submitted week to every active owner of the entry's squad, in one
   * batch. A failure is logged and never fails the submit: the picks are already saved.
   */
  async gamePicksSubmitted(view: GamePicksView, week: SubmittedWeek): Promise<void> {
    try {
      await this.sendGamePicksReceipt(view, week);
    } catch (error) {
      this.deps.logger?.error({
        action: 'email.entryReceipt.failed',
        data: { contestId: view.contestId, entryId: view.entryId, sportEventId: view.sportEventId, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue an entry receipt');
    }
  }

  private async sendGamePicksReceipt(view: GamePicksView, { contest, entry, sportEvent }: SubmittedWeek): Promise<void> {
    const setting = await this.loadSetting(contest, sportEvent, [entry]);
    if (!setting || view.submittedAt === null) {
      this.deps.logger?.warn({
        action: 'email.entryReceipt.skipped',
        data: { contestId: view.contestId, entryId: view.entryId, sportEventId: view.sportEventId },
      }, 'Skipped an entry receipt because its league is gone or the week is not submitted');
      return;
    }
    const submittedAt = view.submittedAt;
    const receipt = this.receiptOf(view, sportEvent, setting.sportLeague?.roundNames ?? []);
    const tiebreaker = describeTiebreaker(view, sportEvent);
    await this.deps.email.sendMany(TEMPLATE_KEY, this.ownerEmails(setting, {
      contest,
      entry,
      sportEvent,
      about: `${entry.id}:${sportEvent.id}:${submittedAt.toISOString()}`,
      data: { submittedAt, ...(tiebreaker !== null && { tiebreaker }), receipt },
    }));
  }

  /**
   * Queues each entry with a box a receipt of its boxes' numbers, once the squares draw is in.
   * Rows take the away team's score and columns the home team's, as the grid shows them. Every
   * receipt goes to the outbox in one batch (#1171), however many entries hold boxes.
   */
  async squaresDrawn({ board, entries, sportEvent }: DrawnSquares): Promise<void> {
    const { contest, digits } = board;
    try {
      const holding = new Set(board.boxes.map((box) => box.contestEntryId));
      const holders = entries.filter((entry) => holding.has(entry.id));
      const setting = await this.loadSetting(contest, sportEvent, holders);
      if (!setting || digits === null) {
        this.deps.logger?.warn({ action: 'email.entryReceipt.skipped', data: { contestId: contest.id } }, 'Skipped squares receipts because the league or the draw is gone');
        return;
      }
      await this.deps.email.sendMany(TEMPLATE_KEY, holders.flatMap((entry) => {
        const boxes = board.boxes
          .filter((box) => box.contestEntryId === entry.id)
          .map((box) => ({ rowNumber: digits.rowDigits[box.rowIndex], columnNumber: digits.columnDigits[box.columnIndex] }))
          .sort((left, right) => left.rowNumber - right.rowNumber || left.columnNumber - right.columnNumber);
        return this.ownerEmails(setting, {
          contest,
          entry,
          sportEvent,
          // The draw is final: one receipt per entry.
          about: `${entry.id}:squares-draw`,
          data: {
            receipt: {
              kind: EntryReceiptKind.SQUARES,
              rowTeam: board.awayTeamName,
              columnTeam: board.homeTeamName,
              boxes,
            },
          },
        });
      }));
    } catch (error) {
      this.deps.logger?.error({
        action: 'email.entryReceipt.failed',
        data: { contestId: contest.id, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue an entry receipt');
    }
  }

  /**
   * The league, the sport league and every given entry's squad's active owners, each read once
   * however many entries there are (#1201). Null when the league is gone.
   */
  private async loadSetting(contest: Contest, sportEvent: SportEvent, entries: readonly ContestEntryWithSquad[]): Promise<ReceiptSetting | null> {
    const squadIds = [...new Set(entries.map((entry) => entry.squadId))];
    const [league, sportLeague, memberships] = await Promise.all([
      this.deps.leagues.findById(contest.leagueId),
      this.deps.sportLeagues.findById(sportEvent.sportLeagueId),
      squadIds.length === 0 ? Promise.resolve([]) : this.deps.squadMemberships.findBySquads(squadIds),
    ]);
    if (!league) return null;
    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    const users = userIds.length === 0 ? [] : await this.deps.users.findByIds(userIds);
    const activeUserById = new Map(users.filter((user) => user.isActive).map((user) => [user.id, user]));
    const ownersBySquad = new Map<string, User[]>();
    for (const membership of memberships) {
      const user = activeUserById.get(membership.userId);
      if (user === undefined) continue;
      ownersBySquad.set(membership.squadId, [...(ownersBySquad.get(membership.squadId) ?? []), user]);
    }
    return { league, sportLeague, ownersBySquad };
  }

  /** The receipt for every active owner of the entry's squad, to queue in one batch with the others. */
  private ownerEmails(setting: ReceiptSetting, input: {
    contest: Contest;
    entry: ContestEntryWithSquad;
    sportEvent: SportEvent;
    about: string;
    data: Pick<ContestEntryCompletedEmailData, 'submittedAt' | 'tiebreaker' | 'receipt'>;
  }): Array<EmailSendInput<typeof TEMPLATE_KEY>> {
    const { contest, entry, sportEvent } = input;
    const { league } = setting;
    const entryUrl = buildEntryUrl(this.deps.appBaseUrl, league.leagueCode, contest.id, entry.id);
    const event = buildEmailEventHeader(this.deps.appBaseUrl, sportEvent, setting.sportLeague?.name ?? '');
    return (setting.ownersBySquad.get(entry.squadId) ?? []).map((user) => ({
      to: emailRecipientOf(user),
      about: input.about,
      league: { id: league.id, name: league.name, leagueCode: league.leagueCode, plan: league.plan },
      refs: { contestId: contest.id, entryId: entry.id },
      data: {
        userName: formatUserName(user),
        leagueName: league.name,
        event,
        contestName: contest.name,
        teamName: entry.squadName,
        entryName: entry.name,
        entryUrl,
        ...input.data,
      },
    }));
  }

  private receiptOf(view: GamePicksView, sportEvent: SportEvent, roundNames: readonly string[]): EntryReceipt {
    const tieWord = getSportDefinition(sportEvent.sport).vocabulary.tie ?? 'Tie';
    const picked = view.games.filter((game) => game.pick !== null);
    switch (view.selectionType) {
      case SelectionType.PICK_EM:
        return {
          kind: EntryReceiptKind.GAME_PICKS,
          eventName: sportEvent.name,
          games: picked.map((game): GamePickLine => {
            const confidence = view.mode === PickEmMode.CONFIDENCE ? game.pick?.confidence ?? undefined : undefined;
            return {
              matchup: describeMatchup(game),
              pick: describePick(game, view.againstTheSpread, tieWord),
              ...(confidence !== undefined && { confidence }),
            };
          }),
        };
      case SelectionType.BRACKET:
        return {
          kind: EntryReceiptKind.BRACKET,
          eventName: sportEvent.name,
          rounds: bracketRounds(picked, sportEvent, roundNames),
          // A bracket's picks lock together: at the event's start, or a second-chance bracket's
          // starting round.
          changeUntil: view.picksCloseAt,
        };
      case SelectionType.SURVIVOR:
        return {
          kind: EntryReceiptKind.SURVIVOR,
          eventName: sportEvent.name,
          picks: picked.map((game) => ({
            team: describePick(game, false, tieWord),
            matchup: describeMatchup(game),
            kickoff: game.kickoff,
          })),
        };
    }
  }
}

/** The bracket's picks for its last rounds, the final first, each round in its sport league's words. */
function bracketRounds(picked: GamePickGame[], sportEvent: SportEvent, roundNames: readonly string[]): Array<{ name: string; picks: string[] }> {
  const roundNumbers = [...new Set(picked.map((game) => game.match.roundNumber))].sort((left, right) => right - left);
  const roundCount = Math.max(sportEvent.rounds ?? 0, roundNumbers.at(0) ?? 0);
  return roundNumbers.slice(0, BRACKET_RECEIPT_ROUNDS).map((roundNumber) => ({
    name: eventRoundLabel(sportEvent, roundNames, roundNumber, roundCount),
    picks: picked
      .filter((game) => game.match.roundNumber === roundNumber)
      .sort((left, right) => left.match.matchNumber - right.match.matchNumber)
      .map((game) => describePick(game, false, '')),
  }));
}

/** The team a game's pick names: the teams the entry's own picks put there in a bracket, else the game's. */
function pickedTeam(game: GamePickGame): GamePickTeam | null {
  const id = game.pick?.sportEventParticipantId ?? null;
  if (id === null) return null;
  return [game.predictedHome, game.predictedAway, game.home, game.away]
    .find((team) => team?.sportEventParticipantId === id) ?? null;
}

/** "Bears", "Bears -3.5" against the spread, or the sport's word for a tie. */
function describePick(game: GamePickGame, againstTheSpread: boolean, tieWord: string): string {
  const team = pickedTeam(game);
  if (team === null) return tieWord;
  const spread = againstTheSpread ? teamSpread(game.match, team) : null;
  return spread === null ? team.name : `${team.name} ${formatSpread(spread)}`;
}

/** The spread the team plays the game at: the home spread for the home team, its opposite for the away team. */
function teamSpread(match: SportEventMatch, team: GamePickTeam): number | null {
  if (match.homeSpread === null) return null;
  return team.sportEventParticipantId === match.homeSportEventParticipantId ? match.homeSpread : -match.homeSpread;
}

/** "Bills at Chiefs", or "Bills vs Chiefs" at a neutral site, as the app lists a game. */
function describeMatchup(game: GamePickGame): string {
  const away = game.predictedAway ?? game.away;
  const home = game.predictedHome ?? game.home;
  return `${away?.name ?? 'To be decided'} ${game.match.isNeutralSite ? 'vs' : 'at'} ${home?.name ?? 'To be decided'}`;
}

/** "45 total points (Bills at Chiefs)": the guess of its game's total score, in the sport's unit. */
function describeTiebreaker(view: GamePicksView, sportEvent: SportEvent): string | null {
  if (view.tiebreakerValue === null) return null;
  const unit = getSportDefinition(sportEvent.sport).vocabulary.scoreUnit ?? 'points';
  const game = view.games.find((candidate) => candidate.match.id === view.tiebreakerMatchId);
  const total = `${String(view.tiebreakerValue)} total ${unit}`;
  return game === undefined ? total : `${total} (${describeMatchup(game)})`;
}
