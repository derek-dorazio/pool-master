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
  ContestEntryRepository,
  ContestEntryWithSquad,
  ContestRepository,
  LeagueRepository,
  SportEventRepository,
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
  type User,
} from '@poolmaster/shared/domain';
import {
  EntryReceiptKind,
  buildEntryUrl,
  formatUserName,
  type ContestEntryCompletedEmailData,
  type EmailService,
  type EntryReceipt,
  type GamePickLine,
} from '../email';
import type { GamePickGame, GamePickTeam, GamePicksView } from '../selections/prediction-service';
import type { SquaresBoard } from '../selections/squares-service';

/** How many of a bracket's rounds its receipt lists, the final first: the final, the semifinals and the quarterfinals. */
const BRACKET_RECEIPT_ROUNDS = 3;

export interface EntryReceiptDeps {
  contests: Pick<ContestRepository, 'findById'>;
  leagues: Pick<LeagueRepository, 'findById'>;
  entries: Pick<ContestEntryRepository, 'findByIdWithSquad'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquad'>;
  users: Pick<UserRepository, 'findById'>;
  sportEvents: Pick<SportEventRepository, 'findById'>;
  /** A bracket's round names ("Sweet 16"). */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  email: Pick<EmailService, 'send'>;
  appBaseUrl: string;
  logger?: FastifyBaseLogger;
}

/** The seam PredictionService calls once an entry's picks for an event are submitted. */
export interface GamePicksReceiptNotice {
  /** Never throws: a receipt that cannot be queued is logged, and the submit stands. */
  gamePicksSubmitted(view: GamePicksView): Promise<void>;
}

/** What a squares receipt reads of the drawn board. */
export type DrawnSquaresBoard = Pick<SquaresBoard, 'contest' | 'homeTeamName' | 'awayTeamName' | 'boxes' | 'digits'>;

/** The seam SquaresService calls once a squares contest's numbers are drawn. */
export interface SquaresDrawnNotice {
  /** Never throws: a receipt that cannot be queued is logged, and the draw stands. */
  squaresDrawn(board: DrawnSquaresBoard): Promise<void>;
}

export class EntryReceipts implements GamePicksReceiptNotice, SquaresDrawnNotice {
  constructor(private readonly deps: EntryReceiptDeps) {}

  /**
   * Queues the receipt for a submitted week to every active owner of the entry's squad. A failure
   * is logged and never fails the submit: the picks are already saved.
   */
  async gamePicksSubmitted(view: GamePicksView): Promise<void> {
    try {
      await this.sendGamePicksReceipt(view);
    } catch (error) {
      this.deps.logger?.error({
        action: 'email.entryReceipt.failed',
        data: { contestId: view.contestId, entryId: view.entryId, sportEventId: view.sportEventId, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue an entry receipt');
    }
  }

  private async sendGamePicksReceipt(view: GamePicksView): Promise<void> {
    const [contest, entry, sportEvent] = await Promise.all([
      this.deps.contests.findById(view.contestId),
      this.deps.entries.findByIdWithSquad(view.entryId),
      this.deps.sportEvents.findById(view.sportEventId),
    ]);
    const league = contest ? await this.deps.leagues.findById(contest.leagueId) : null;
    if (!contest || !entry || !sportEvent || !league || view.submittedAt === null) {
      this.deps.logger?.warn({
        action: 'email.entryReceipt.skipped',
        data: { contestId: view.contestId, entryId: view.entryId, sportEventId: view.sportEventId },
      }, 'Skipped an entry receipt because its contest, entry or event is gone');
      return;
    }
    const submittedAt = view.submittedAt;
    const receipt = await this.receiptOf(view, sportEvent);
    const tiebreaker = describeTiebreaker(view, sportEvent);
    await this.sendToOwners({
      contest,
      league,
      entry,
      about: `${entry.id}:${sportEvent.id}:${submittedAt.toISOString()}`,
      data: { submittedAt, ...(tiebreaker !== null && { tiebreaker }), receipt },
    });
  }

  /**
   * Queues each entry with a box a receipt of its boxes' numbers, once the squares draw is in.
   * Rows take the away team's score and columns the home team's, as the grid shows them.
   */
  async squaresDrawn(board: DrawnSquaresBoard): Promise<void> {
    const { contest, digits } = board;
    try {
      const league = await this.deps.leagues.findById(contest.leagueId);
      if (!league || digits === null) {
        this.deps.logger?.warn({ action: 'email.entryReceipt.skipped', data: { contestId: contest.id } }, 'Skipped squares receipts because the league or the draw is gone');
        return;
      }
      const entryIds = [...new Set(board.boxes.map((box) => box.contestEntryId))];
      for (const entryId of entryIds) {
        const entry = await this.deps.entries.findByIdWithSquad(entryId);
        if (!entry) continue;
        const boxes = board.boxes
          .filter((box) => box.contestEntryId === entryId)
          .map((box) => ({ rowNumber: digits.rowDigits[box.rowIndex], columnNumber: digits.columnDigits[box.columnIndex] }))
          .sort((left, right) => left.rowNumber - right.rowNumber || left.columnNumber - right.columnNumber);
        await this.sendToOwners({
          contest,
          league,
          entry,
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
      }
    } catch (error) {
      this.deps.logger?.error({
        action: 'email.entryReceipt.failed',
        data: { contestId: contest.id, error: error instanceof Error ? error.message : String(error) },
      }, 'Failed to queue an entry receipt');
    }
  }

  /** Queues the receipt to every active owner of the entry's squad; one owner's failure never costs the others theirs. */
  private async sendToOwners(input: {
    contest: Contest;
    league: League;
    entry: ContestEntryWithSquad;
    about: string;
    data: Pick<ContestEntryCompletedEmailData, 'submittedAt' | 'tiebreaker' | 'receipt'>;
  }): Promise<void> {
    const { contest, league, entry } = input;
    const entryUrl = buildEntryUrl(this.deps.appBaseUrl, league.leagueCode, contest.id, entry.id);
    for (const user of await this.activeOwners(entry.squadId)) {
      try {
        await this.deps.email.send('CONTEST_ENTRY_COMPLETED', {
          to: { email: user.email, userId: user.id, timeZone: user.timezone },
          about: input.about,
          league: { id: league.id, name: league.name, leagueCode: league.leagueCode },
          refs: { contestId: contest.id, entryId: entry.id },
          data: {
            userName: formatUserName(user),
            leagueName: league.name,
            contestName: contest.name,
            teamName: entry.squadName,
            entryName: entry.name,
            entryUrl,
            ...input.data,
          },
        });
      } catch (error) {
        this.deps.logger?.error({
          action: 'email.entryReceipt.failed',
          data: { contestId: contest.id, entryId: entry.id, userId: user.id, error: error instanceof Error ? error.message : String(error) },
        }, 'Failed to queue an entry receipt');
      }
    }
  }

  private async activeOwners(squadId: string): Promise<User[]> {
    const owners = await Promise.all((await this.deps.squadMemberships.findBySquad(squadId))
      .map((membership) => this.deps.users.findById(membership.userId)));
    return owners.filter((user): user is User => user !== null && user.isActive);
  }

  private async receiptOf(view: GamePicksView, sportEvent: SportEvent): Promise<EntryReceipt> {
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
          rounds: await this.bracketRounds(picked, sportEvent),
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

  /** The bracket's picks for its last rounds, the final first, each round in its sport league's words. */
  private async bracketRounds(picked: GamePickGame[], sportEvent: SportEvent): Promise<Array<{ name: string; picks: string[] }>> {
    const roundNames = (await this.deps.sportLeagues.findById(sportEvent.sportLeagueId))?.roundNames ?? [];
    const roundNumbers = [...new Set(picked.map((game) => game.match.roundNumber))].sort((left, right) => right - left);
    const roundCount = Math.max(sportEvent.rounds ?? 0, roundNumbers.at(0) ?? 0);
    return roundNumbers.slice(0, BRACKET_RECEIPT_ROUNDS).map((roundNumber) => ({
      name: eventRoundLabel(sportEvent.sport, roundNames, roundNumber, roundCount),
      picks: picked
        .filter((game) => game.match.roundNumber === roundNumber)
        .sort((left, right) => left.match.matchNumber - right.match.matchNumber)
        .map((game) => describePick(game, false, '')),
    }));
  }
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
