/**
 * Squares contests (#711, plans/super-bowl-squares.md): the grid's read, and its three actions,
 * claiming a box, clearing one and drawing the digits. Squares has no lineup and no game picks,
 * so it has neither a selection engine nor a prediction engine; this service is the whole of it.
 *
 * Claiming and clearing are open while the contest is OPEN, its digits are not drawn and its game
 * has not kicked off. The draw is open from the contest's release until the first period's score
 * is entered (design Q3.5): claiming closes at kickoff either way, so nobody picks a box knowing
 * its digits.
 *
 * The digits are drawn automatically (#1760, Derek 2026-11-17) at the first of two moments: the
 * claim that fills the board, or five minutes before kickoff (`SquaresAutoDrawScheduler`, whose
 * sweep also draws a full board whose draw at the filling claim failed). The
 * commissioner may draw earlier by hand. Either way it is the one draw path below, so a draw is
 * recorded once, under the contest lock, and its receipts go out once.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ContestConfigurationRepository,
  ContestEntryRepository,
  ContestEntryStandingRepository,
  ContestEntryWithSquad,
  ContestRepository,
  ContestSquaresRepository,
  LeagueMembershipRepository,
  ParticipantRepository,
  SportEventRoundMatchRepository,
  SportEventParticipantRepository,
  SportEventRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  LeagueMembershipStatus,
  MatchStatus,
  SelectionType,
  SQUARES_GRID_SIZE,
  squaresScoringMoments,
  squaresWinners,
  type Contest,
  type ContestEntrySquare,
  type ContestSquaresDraw,
  type SlotPeriods,
  type SportEvent,
  type SportEventRoundMatch,
  type SquaresWinner,
  matchParticipantIds,
  sideParticipantId,
} from '@poolmaster/shared/domain';
import { errorMessage } from '../../core/error-message';
import { hasMatchStarted } from '../contests/entry-window';
import { seededShuffle } from './selection-engines/random-draw';
import { SelectionError, selectionErrors } from './selection-errors';
import { isCommissionerRole } from './selection-rules';
import type { SquaresDrawnNotice } from '../notifications/entry-receipts';

const SQUARES_BOX_COUNT = SQUARES_GRID_SIZE * SQUARES_GRID_SIZE;

/** How long before kickoff the numbers are drawn on a board nobody has drawn (#1760). */
export const SQUARES_AUTO_DRAW_LEAD_MS = 5 * 60 * 1000;

/** How a board's automatic draw went: drawn now, drawn already (by hand or a race), not yet due, or past drawing. */
export type SquaresAutoDrawOutcome = 'drawn' | 'alreadyDrawn' | 'notDue' | 'closed';

/** Who the board is read for: a signed-in user, or the automatic draw, which acts for no one. */
type SquaresReader = SquaresActor | typeof AUTOMATIC_DRAW;

/** The automatic draw: it reads a board as its commissioner would, and records the draw as nobody's. */
const AUTOMATIC_DRAW = Symbol('automatic squares draw');

export interface SquaresServiceDeps {
  contests: Pick<ContestRepository, 'findById'>;
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  entries: Pick<ContestEntryRepository, 'findByContestWithSquad'>;
  memberships: Pick<LeagueMembershipRepository, 'findByLeagueAndUser'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  sportEvents: Pick<SportEventRepository, 'findById'>;
  matches: Pick<SportEventRoundMatchRepository, 'findById'>;
  field: Pick<SportEventParticipantRepository, 'findByIds'>;
  participants: Pick<ParticipantRepository, 'findByIds'>;
  squares: ContestSquaresRepository;
  standings: Pick<ContestEntryStandingRepository, 'findByContest'>;
  /** Sends each entry with a box a receipt of its boxes' numbers once they are drawn (#867); none sends nothing. */
  receipts?: SquaresDrawnNotice;
  now?: () => Date;
  /** The seed the digits are shuffled by; a fresh random one per draw unless given. */
  drawSeed?: () => string;
  logger?: FastifyBaseLogger;
}

/** Who is acting: a signed-in user, and whether they are a root admin (who may act as commissioner). */
export interface SquaresActor {
  userId: string;
  isRootAdmin: boolean;
}

export interface SquaresBox {
  rowIndex: number;
  columnIndex: number;
  contestEntryId: string;
  entryName: string;
}

export interface SquaresBoardWinner extends SquaresWinner {
  entryName: string | null;
}

export interface SquaresBoardEntry {
  contestEntryId: string;
  entryName: string;
  /** The team the entry belongs to, which the entry's (i) peek reads on demand (#1564). */
  squadId: string;
  boxCount: number;
  periodsWon: number;
  displayPosition: string | null;
}

/** The grid as the board read answers it. */
export interface SquaresBoard {
  contest: Contest;
  maxSquaresPerEntry: number;
  /** The periods the game is played in, its slot's (#2047): its scoring moments are each period's end. */
  periods: SlotPeriods;
  game: SportEventRoundMatch;
  /** Side 1's team name, down the side. */
  rowTeamName: string | null;
  /** Side 2's team name, across the top. */
  columnTeamName: string | null;
  claimsOpen: boolean;
  drawOpen: boolean;
  boxes: SquaresBox[];
  digits: ContestSquaresDraw | null;
  winners: SquaresBoardWinner[];
  entries: SquaresBoardEntry[];
}

/** Everything one squares operation reads about its contest. */
interface SquaresContext {
  contest: Contest;
  maxSquaresPerEntry: number;
  sportEvent: SportEvent;
  game: SportEventRoundMatch;
  periods: SlotPeriods;
  entries: ContestEntryWithSquad[];
  squares: ContestEntrySquare[];
  draw: ContestSquaresDraw | null;
  isCommissioner: boolean;
}

const squaresErrors = {
  notSquares: (contestId: string) =>
    new SelectionError(`Contest ${contestId} is not a squares contest`, 'CONTEST_FORMAT_MISMATCH', 409),
  claimingClosed: () =>
    new SelectionError(
      'Boxes can be claimed and cleared only while the contest is open, before the numbers are drawn and before the game kicks off.',
      'SQUARES_CLAIMING_CLOSED',
      409,
    ),
  boxTaken: () => new SelectionError('Someone has already claimed that box.', 'SQUARES_BOX_TAKEN', 409),
  limitReached: (limit: number) =>
    new SelectionError(`An entry can hold ${limit} ${limit === 1 ? 'box' : 'boxes'} in this contest, and this one has them all.`, 'SQUARES_BOX_LIMIT_REACHED', 409),
  boxNotClaimed: () => new SelectionError('Nobody holds that box.', 'SQUARES_BOX_NOT_CLAIMED', 404),
  notYourBox: () => new SelectionError('Only the box\'s holder or the commissioner can do that.', 'ENTRY_ACCESS_DENIED', 403),
  alreadyDrawn: () => new SelectionError('The numbers have already been drawn.', 'SQUARES_ALREADY_DRAWN', 409),
  drawClosed: () =>
    new SelectionError(
      'The numbers can be drawn only while the contest is open or live, until the first quarter\'s score is in.',
      'SQUARES_DRAW_CLOSED',
      409,
    ),
};

export class SquaresService {
  constructor(private readonly deps: SquaresServiceDeps) {}

  /** The grid. A draft is its commissioners' alone: anyone else is told it does not exist (#117). */
  async getBoard(contestId: string, actor: SquaresActor): Promise<SquaresBoard> {
    const context = await this.loadContext(contestId, actor);
    return this.buildBoard(context);
  }

  /** Claims an empty box for an entry: the caller's own, or any entry for the commissioner. */
  async claim(contestId: string, rowIndex: number, columnIndex: number, contestEntryId: string, actor: SquaresActor): Promise<SquaresBoard> {
    const context = await this.loadContext(contestId, actor);
    const entry = context.entries.find((candidate) => candidate.id === contestEntryId);
    if (!entry) throw selectionErrors.entryNotFound(contestEntryId, contestId);
    if (!context.isCommissioner && !(await this.ownsEntry(entry, actor))) {
      this.deps.logger?.warn({ action: 'squares.claim.denied', data: { contestId, contestEntryId, userId: actor.userId } }, 'Refused a box claim for another squad\'s entry');
      throw selectionErrors.entryAccessDenied();
    }
    this.assertClaimsOpen(context);
    const result = await this.deps.squares.claim({
      contestId,
      contestEntryId,
      rowIndex,
      columnIndex,
      claimedByUserId: actor.userId,
      maxSquaresPerEntry: context.maxSquaresPerEntry,
    });
    switch (result) {
      case 'taken':
        throw squaresErrors.boxTaken();
      case 'limitReached':
        throw squaresErrors.limitReached(context.maxSquaresPerEntry);
      case 'drawn':
        throw squaresErrors.claimingClosed();
      case 'claimed':
        break;
    }
    this.deps.logger?.info(
      { action: 'squares.claim.claimed', data: { contestId, contestEntryId, rowIndex, columnIndex, userId: actor.userId, forOthers: context.isCommissioner } },
      'Claimed a squares box',
    );
    const claimed = await this.withBoxesReread(context);
    // The claim that fills the board draws the numbers (#1760).
    if (isBoardFull(claimed) && isDrawOpen(claimed)) return this.drawFilledBoard(claimed);
    return this.buildBoard(claimed);
  }

  /**
   * The draw the claim filling the board starts. The claim has landed, so a draw that fails here
   * does not fail it: the failure is logged and the board answered as it stands, drawn if the draw
   * was recorded before the failure; an undrawn full board is drawn by the next sweep.
   */
  private async drawFilledBoard(claimed: SquaresContext): Promise<SquaresBoard> {
    try {
      return (await this.recordDraw(claimed, null)).board;
    } catch (error) {
      this.deps.logger?.error(
        { action: 'squares.autoDraw.failed', data: { contestId: claimed.contest.id, trigger: 'boardFilled', error: errorMessage(error) } },
        'Drawing a squares board\'s numbers after the claim that filled it failed',
      );
      const draw = await this.deps.squares.findDraw(claimed.contest.id);
      return this.buildBoard({ ...claimed, draw });
    }
  }

  /** Clears a claimed box: its holder's own, or any box for the commissioner. */
  async clear(contestId: string, rowIndex: number, columnIndex: number, actor: SquaresActor): Promise<SquaresBoard> {
    const context = await this.loadContext(contestId, actor);
    const box = context.squares.find((square) => square.rowIndex === rowIndex && square.columnIndex === columnIndex);
    if (!box) throw squaresErrors.boxNotClaimed();
    const entry = context.entries.find((candidate) => candidate.id === box.contestEntryId);
    if (!context.isCommissioner && !(entry && await this.ownsEntry(entry, actor))) {
      this.deps.logger?.warn({ action: 'squares.clear.denied', data: { contestId, rowIndex, columnIndex, userId: actor.userId } }, 'Refused clearing another squad\'s box');
      throw squaresErrors.notYourBox();
    }
    this.assertClaimsOpen(context);
    const result = await this.deps.squares.clear(box);
    if (result === 'drawn') throw squaresErrors.claimingClosed();
    if (result === 'empty') throw squaresErrors.boxNotClaimed();
    this.deps.logger?.info(
      { action: 'squares.clear.cleared', data: { contestId, contestEntryId: box.contestEntryId, rowIndex, columnIndex, userId: actor.userId } },
      'Cleared a squares box',
    );
    return this.buildBoard(await this.withBoxesReread(context));
  }

  /**
   * Draws the digits: 0 to 9 shuffled once for the rows and once for the columns, by one seed kept
   * so the draw can be replayed. Every entry holding a box is submitted; empty boxes stay empty
   * (design Q3.6). The route lets only the commissioner draw by hand. Final: no redraw.
   */
  async draw(contestId: string, actor: SquaresActor): Promise<SquaresBoard> {
    const context = await this.loadContext(contestId, actor);
    if (context.draw) throw squaresErrors.alreadyDrawn();
    if (!isDrawOpen(context)) throw squaresErrors.drawClosed();
    const { outcome, board } = await this.recordDraw(context, actor.userId);
    if (outcome === 'alreadyDrawn') throw squaresErrors.alreadyDrawn();
    return board;
  }

  /**
   * The automatic draw (#1760): draws the board's numbers once its game kicks off within five
   * minutes or is under way, or once every box is claimed (a full board whose draw at the filling
   * claim failed), unless they are drawn already. The scheduler calls it for each board its read
   * finds; the board is read again here, so a kickoff moved since, a commissioner's draw or a
   * first quarter already scored draws nothing.
   */
  async drawWhenDue(contestId: string): Promise<SquaresAutoDrawOutcome> {
    const context = await this.loadContext(contestId, AUTOMATIC_DRAW);
    if (context.draw) return 'alreadyDrawn';
    if (!isDrawOpen(context)) return 'closed';
    const kickoffDue = hasMatchStarted(context.game, context.sportEvent, new Date(this.now().getTime() + SQUARES_AUTO_DRAW_LEAD_MS));
    if (!kickoffDue && !isBoardFull(context)) return 'notDue';
    return (await this.recordDraw(context, null)).outcome;
  }

  /**
   * Records the draw by whoever drew (null for the automatic draw) and sends the receipts. A draw
   * recorded first by another caller wins: this one answers alreadyDrawn with that draw's board and
   * sends nothing, so the receipts go out once per board however it was drawn.
   */
  private async recordDraw(context: SquaresContext, drawnByUserId: string | null): Promise<{ outcome: 'drawn' | 'alreadyDrawn'; board: SquaresBoard }> {
    const contestId = context.contest.id;
    const seed = this.deps.drawSeed?.() ?? randomBytes(16).toString('hex');
    const digits = Array.from({ length: SQUARES_GRID_SIZE }, (_, digit) => String(digit));
    const draw: ContestSquaresDraw = {
      contestId,
      seed,
      rowDigits: seededShuffle([...digits], `${seed}:rows`).map(Number),
      columnDigits: seededShuffle([...digits], `${seed}:columns`).map(Number),
      drawnByUserId,
      drawnAt: this.now(),
    };
    const result = await this.deps.squares.recordDraw({ ...draw, sportEventId: context.sportEvent.id });
    if (result === 'alreadyDrawn') {
      const [reread, stored] = await Promise.all([this.withBoxesReread(context), this.deps.squares.findDraw(contestId)]);
      return { outcome: 'alreadyDrawn', board: await this.buildBoard({ ...reread, draw: stored }) };
    }
    this.deps.logger?.info(
      { action: 'squares.draw.drawn', data: { contestId, boxCount: context.squares.length, userId: drawnByUserId, automatic: drawnByUserId === null } },
      'Drew a squares contest\'s numbers',
    );
    // The draw read the boxes under the contest lock, so a box claimed or cleared since the load
    // is in it: the boxes and entries are read again, the rest is as loaded (#1201).
    const drawn = { ...(await this.withBoxesReread(context)), draw };
    const board = await this.buildBoard(drawn);
    await this.deps.receipts?.squaresDrawn({ board, entries: drawn.entries, sportEvent: context.sportEvent });
    return { outcome: 'drawn', board };
  }

  private async loadContext(contestId: string, actor: SquaresReader): Promise<SquaresContext> {
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) throw selectionErrors.contestNotFound(contestId);
    if (contest.selectionType !== SelectionType.SQUARES) throw squaresErrors.notSquares(contestId);
    const isCommissioner = await this.isCommissioner(contest, actor);
    if (contest.status === ContestStatus.DRAFT && !isCommissioner) throw selectionErrors.contestNotFound(contestId);
    const sportEventId = contest.sportEventIds.at(0);
    const [configuration, sportEvent, matched, entries, squares, draw] = await Promise.all([
      this.deps.configurations.findByContest(contestId),
      sportEventId === undefined ? Promise.resolve(null) : this.deps.sportEvents.findById(sportEventId),
      // The grid's one game, not its event's every match (#1201).
      contest.squaresGame === undefined ? Promise.resolve(null) : this.deps.matches.findById(contest.squaresGame.sportEventRoundMatchId),
      this.deps.entries.findByContestWithSquad(contestId),
      this.deps.squares.findSquares(contestId),
      this.deps.squares.findDraw(contestId),
    ]);
    if (!sportEvent) throw selectionErrors.contestHasNoEvent(contestId);
    const game = matched?.sportEventId === sportEvent.id ? matched : undefined;
    const rules = configuration?.configJson;
    const periods = game?.slot.periods ?? null;
    if (!game || rules?.selectionType !== SelectionType.SQUARES || periods === null) {
      this.deps.logger?.error({ action: 'squares.context.invalid', data: { contestId, hasGame: game !== undefined, hasRules: rules?.selectionType === SelectionType.SQUARES } }, 'A squares contest is missing its game, its rules or its slot\'s periods');
      throw selectionErrors.selectionConfigInvalid(contestId);
    }
    return { contest, maxSquaresPerEntry: rules.maxSquaresPerEntry, sportEvent, game, periods, entries, squares, draw, isCommissioner };
  }

  private async buildBoard(context: SquaresContext): Promise<SquaresBoard> {
    const { contest, game, entries, squares, draw } = context;
    const nameOf = new Map(entries.map((entry) => [entry.id, entry.name]));
    const settled = contest.status === ContestStatus.COMPLETED;
    const [winners, standings, teams] = await Promise.all([
      settled
        ? this.deps.squares.findWinners(contest.id)
        : Promise.resolve(draw ? squaresWinners(draw, squaresScoringMoments(game, context.periods.count), squares) : []),
      settled ? this.deps.standings.findByContest(contest.id) : Promise.resolve([]),
      this.findTeamNames(game),
    ]);
    const positionOf = new Map(standings.map((standing) => [standing.contestEntryId, standing]));
    const boardEntries = entries.map((entry) => ({
      contestEntryId: entry.id,
      entryName: entry.name,
      squadId: entry.squadId,
      boxCount: squares.filter((square) => square.contestEntryId === entry.id).length,
      periodsWon: winners.filter((winner) => winner.contestEntryId === entry.id).length,
      displayPosition: positionOf.get(entry.id)?.displayPosition ?? null,
      position: positionOf.get(entry.id)?.position ?? Number.MAX_SAFE_INTEGER,
    }));
    boardEntries.sort((left, right) => left.position - right.position || left.entryName.localeCompare(right.entryName));
    return {
      contest,
      maxSquaresPerEntry: context.maxSquaresPerEntry,
      periods: context.periods,
      game,
      rowTeamName: teams.row,
      columnTeamName: teams.column,
      claimsOpen: this.areClaimsOpen(context),
      drawOpen: draw === null && isDrawOpen(context),
      boxes: squares.map((square) => ({
        rowIndex: square.rowIndex,
        columnIndex: square.columnIndex,
        contestEntryId: square.contestEntryId,
        entryName: nameOf.get(square.contestEntryId) ?? '',
      })),
      digits: draw,
      winners: winners.map((winner) => ({
        periodNumber: winner.periodNumber,
        homeScore: winner.homeScore,
        awayScore: winner.awayScore,
        rowIndex: winner.rowIndex,
        columnIndex: winner.columnIndex,
        contestEntryId: winner.contestEntryId,
        entryName: winner.contestEntryId === null ? null : nameOf.get(winner.contestEntryId) ?? null,
      })),
      entries: boardEntries.map(({ position: _position, ...entry }) => entry),
    };
  }

  /** The game's two teams' names, side 1's down the side and side 2's across the top, from their two field rows alone (#1201). */
  private async findTeamNames(game: SportEventRoundMatch): Promise<{ row: string | null; column: string | null }> {
    const field = await this.deps.field.findByIds(matchParticipantIds(game));
    const fieldRowOn = (sideNumber: number) => field.find((row) => row.id === sideParticipantId(game, sideNumber));
    const [row, column] = [fieldRowOn(1), fieldRowOn(2)];
    const participants = await this.deps.participants.findByIds([row, column].flatMap((each) => each ? [each.participantId] : []));
    const nameOf = (participantId?: string) => participants.find((participant) => participant.id === participantId)?.name ?? null;
    return { row: nameOf(row?.participantId), column: nameOf(column?.participantId) };
  }

  /**
   * The context after a write to the boxes: the boxes, and the entries that may hold them, read
   * again; the contest, its rules, event and game as loaded.
   */
  private async withBoxesReread(context: SquaresContext): Promise<SquaresContext> {
    const [squares, entries] = await Promise.all([
      this.deps.squares.findSquares(context.contest.id),
      this.deps.entries.findByContestWithSquad(context.contest.id),
    ]);
    return { ...context, squares, entries };
  }

  private areClaimsOpen(context: SquaresContext): boolean {
    return context.contest.status === ContestStatus.OPEN
      && context.draw === null
      && !hasMatchStarted(context.game, context.sportEvent, this.now());
  }

  private assertClaimsOpen(context: SquaresContext): void {
    if (!this.areClaimsOpen(context)) {
      this.deps.logger?.warn({ action: 'squares.claims.closed', data: { contestId: context.contest.id, status: context.contest.status, drawn: context.draw !== null } }, 'Refused a box change once claiming closed');
      throw squaresErrors.claimingClosed();
    }
  }

  /** Whether the actor is a member of the entry's squad. */
  private async ownsEntry(entry: ContestEntryWithSquad, actor: SquaresActor): Promise<boolean> {
    const memberships = await this.deps.squadMemberships.findBySquads([entry.squadId]);
    return memberships.some((membership) => membership.userId === actor.userId);
  }

  /** An active commissioner of the contest's league, or a root admin, who may act for anyone. */
  private async isCommissioner(contest: Contest, actor: SquaresReader): Promise<boolean> {
    if (actor === AUTOMATIC_DRAW || actor.isRootAdmin) return true;
    const membership = await this.deps.memberships.findByLeagueAndUser(contest.leagueId, actor.userId);
    return membership?.status === LeagueMembershipStatus.ACTIVE && isCommissionerRole(membership.role);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** Whether every box of the grid is claimed. */
function isBoardFull(context: Pick<SquaresContext, 'squares'>): boolean {
  return context.squares.length === SQUARES_BOX_COUNT;
}

/**
 * Whether the digits can still be drawn: the contest is OPEN or live, and the first period's score
 * is not in (nor the game over or cancelled). Claimed or not, the draw does not wait for kickoff.
 */
function isDrawOpen(context: Pick<SquaresContext, 'contest' | 'game'>): boolean {
  const { contest, game } = context;
  if (contest.status !== ContestStatus.OPEN && contest.status !== ContestStatus.ACTIVE) return false;
  if (game.status === MatchStatus.COMPLETED || game.status === MatchStatus.CANCELLED) return false;
  return !squaresScoringMoments(game, Number.MAX_SAFE_INTEGER).some((moment) => moment.periodNumber === 1);
}
