/**
 * Squares contests (#711, plans/super-bowl-squares.md): the grid's read, and its three actions,
 * claiming a box, clearing one and drawing the digits. Squares has no lineup and no game picks,
 * so it has neither a selection engine nor a prediction engine; this service is the whole of it.
 *
 * Claiming and clearing are open while the contest is OPEN, its digits are not drawn and its game
 * has not kicked off. The draw is open from the contest's release until the first period's score
 * is entered (design Q3.5): claiming closes at kickoff either way, so nobody picks a box knowing
 * its digits.
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
  SportEventMatchRepository,
  SportEventParticipantRepository,
  SportEventRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  LeagueMembershipStatus,
  MatchSide,
  MatchStatus,
  SelectionType,
  SQUARES_GRID_SIZE,
  MATCH_PERIOD_LAYOUTS,
  matchPeriodLayoutOf,
  squaresScoringMoments,
  squaresWinners,
  type Contest,
  type ContestEntrySquare,
  type ContestSquaresDraw,
  type MatchPeriodLayout,
  type SportEvent,
  type SportEventMatch,
  type SquaresWinner,
} from '@poolmaster/shared/domain';
import { hasMatchStarted } from '../contests/entry-window';
import { seededShuffle } from './selection-engines/random-draw';
import { SelectionError, selectionErrors } from './selection-errors';
import { isCommissionerRole } from './selection-rules';
import type { SquaresDrawnNotice } from '../notifications/entry-receipts';

export interface SquaresServiceDeps {
  contests: Pick<ContestRepository, 'findById'>;
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  entries: Pick<ContestEntryRepository, 'findByContestWithSquad'>;
  memberships: Pick<LeagueMembershipRepository, 'findByLeagueAndUser'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  sportEvents: Pick<SportEventRepository, 'findById'>;
  matches: Pick<SportEventMatchRepository, 'findById'>;
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
  boxCount: number;
  periodsWon: number;
  displayPosition: string | null;
}

/** The grid as the board read answers it. */
export interface SquaresBoard {
  contest: Contest;
  maxSquaresPerEntry: number;
  /** The periods the game is played in (#786): its scoring moments are each period's end. */
  periodLayout: MatchPeriodLayout;
  game: SportEventMatch;
  homeTeamName: string | null;
  awayTeamName: string | null;
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
  game: SportEventMatch;
  periodLayout: MatchPeriodLayout;
  periodCount: number;
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
    return this.withSquaresReread(context);
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
    return this.withSquaresReread(context);
  }

  /**
   * Draws the digits: 0 to 9 shuffled once for the rows and once for the columns, by one seed kept
   * so the draw can be replayed. Every entry holding a box is submitted; empty boxes stay empty
   * (design Q3.6). The route lets only the commissioner draw. Final: no redraw.
   */
  async draw(contestId: string, actor: SquaresActor): Promise<SquaresBoard> {
    const context = await this.loadContext(contestId, actor);
    if (context.draw) throw squaresErrors.alreadyDrawn();
    if (!isDrawOpen(context)) throw squaresErrors.drawClosed();
    const seed = this.deps.drawSeed?.() ?? randomBytes(16).toString('hex');
    const digits = Array.from({ length: SQUARES_GRID_SIZE }, (_, digit) => String(digit));
    const draw: ContestSquaresDraw = {
      contestId,
      seed,
      rowDigits: seededShuffle([...digits], `${seed}:rows`).map(Number),
      columnDigits: seededShuffle([...digits], `${seed}:columns`).map(Number),
      drawnByUserId: actor.userId,
      drawnAt: this.now(),
    };
    const result = await this.deps.squares.recordDraw({ ...draw, sportEventId: context.sportEvent.id });
    if (result === 'alreadyDrawn') throw squaresErrors.alreadyDrawn();
    this.deps.logger?.info(
      { action: 'squares.draw.drawn', data: { contestId, boxCount: context.squares.length, userId: actor.userId } },
      'Drew a squares contest\'s numbers',
    );
    // The draw changes nothing else the board shows, so it is built from what was loaded (#1201).
    const board = await this.buildBoard({ ...context, draw });
    await this.deps.receipts?.squaresDrawn({ board, entries: context.entries, sportEvent: context.sportEvent });
    return board;
  }

  private async loadContext(contestId: string, actor: SquaresActor): Promise<SquaresContext> {
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
      contest.squaresGameMatchId === undefined ? Promise.resolve(null) : this.deps.matches.findById(contest.squaresGameMatchId),
      this.deps.entries.findByContestWithSquad(contestId),
      this.deps.squares.findSquares(contestId),
      this.deps.squares.findDraw(contestId),
    ]);
    if (!sportEvent) throw selectionErrors.contestHasNoEvent(contestId);
    const game = matched?.sportEventId === sportEvent.id ? matched : undefined;
    const rules = configuration?.configJson;
    const periodLayout = matchPeriodLayoutOf(sportEvent.sport, sportEvent.matchPeriodLayout ?? null);
    if (!game || rules?.selectionType !== SelectionType.SQUARES || periodLayout === undefined) {
      this.deps.logger?.error({ action: 'squares.context.invalid', data: { contestId, hasGame: game !== undefined, hasRules: rules?.selectionType === SelectionType.SQUARES } }, 'A squares contest is missing its game, its rules or its sport\'s periods');
      throw selectionErrors.selectionConfigInvalid(contestId);
    }
    return { contest, maxSquaresPerEntry: rules.maxSquaresPerEntry, sportEvent, game, periodLayout, periodCount: MATCH_PERIOD_LAYOUTS[periodLayout].count, entries, squares, draw, isCommissioner };
  }

  private async buildBoard(context: SquaresContext): Promise<SquaresBoard> {
    const { contest, game, entries, squares, draw } = context;
    const nameOf = new Map(entries.map((entry) => [entry.id, entry.name]));
    const settled = contest.status === ContestStatus.COMPLETED;
    const [winners, standings, teams] = await Promise.all([
      settled
        ? this.deps.squares.findWinners(contest.id)
        : Promise.resolve(draw ? squaresWinners(draw, squaresScoringMoments(game, context.periodCount), squares) : []),
      settled ? this.deps.standings.findByContest(contest.id) : Promise.resolve([]),
      this.findTeamNames(game),
    ]);
    const positionOf = new Map(standings.map((standing) => [standing.contestEntryId, standing]));
    const boardEntries = entries.map((entry) => ({
      contestEntryId: entry.id,
      entryName: entry.name,
      boxCount: squares.filter((square) => square.contestEntryId === entry.id).length,
      periodsWon: winners.filter((winner) => winner.contestEntryId === entry.id).length,
      displayPosition: positionOf.get(entry.id)?.displayPosition ?? null,
      position: positionOf.get(entry.id)?.position ?? Number.MAX_SAFE_INTEGER,
    }));
    boardEntries.sort((left, right) => left.position - right.position || left.entryName.localeCompare(right.entryName));
    return {
      contest,
      maxSquaresPerEntry: context.maxSquaresPerEntry,
      periodLayout: context.periodLayout,
      game,
      homeTeamName: teams.home,
      awayTeamName: teams.away,
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

  /** The game's two teams' names, from their two field rows alone (#1201). */
  private async findTeamNames(game: SportEventMatch): Promise<{ home: string | null; away: string | null }> {
    const field = await this.deps.field.findByIds(
      [game.homeSportEventParticipantId, game.awaySportEventParticipantId].filter((id): id is string => id !== null),
    );
    const rowOf = (side: MatchSide) => field.find((row) => row.id === (side === MatchSide.HOME ? game.homeSportEventParticipantId : game.awaySportEventParticipantId));
    const home = rowOf(MatchSide.HOME);
    const away = rowOf(MatchSide.AWAY);
    const participants = await this.deps.participants.findByIds([home, away].flatMap((row) => row ? [row.participantId] : []));
    const nameOf = (participantId?: string) => participants.find((participant) => participant.id === participantId)?.name ?? null;
    return { home: nameOf(home?.participantId), away: nameOf(away?.participantId) };
  }

  /** The board after a box is claimed or cleared: only the boxes are read again. */
  private async withSquaresReread(context: SquaresContext): Promise<SquaresBoard> {
    return this.buildBoard({ ...context, squares: await this.deps.squares.findSquares(context.contest.id) });
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
  private async isCommissioner(contest: Contest, actor: SquaresActor): Promise<boolean> {
    if (actor.isRootAdmin) return true;
    const membership = await this.deps.memberships.findByLeagueAndUser(contest.leagueId, actor.userId);
    return membership?.status === LeagueMembershipStatus.ACTIVE && isCommissionerRole(membership.role);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/**
 * Whether the digits can still be drawn: the contest is OPEN or live, and the first period's score
 * is not in (nor the game over or cancelled). Claimed or not, the draw does not wait for kickoff.
 */
function isDrawOpen(context: Pick<SquaresContext, 'contest' | 'game'>): boolean {
  const { contest, game } = context;
  if (contest.status !== ContestStatus.OPEN && contest.status !== ContestStatus.ACTIVE) return false;
  if (game.status === MatchStatus.COMPLETED || game.status === MatchStatus.CANCELLED) return false;
  return !game.periodScores.some((score) => score.periodNumber === 1);
}
