/**
 * PredictionService — a prediction contest entry's picks on one event's games (#716): reading
 * the week, saving picks, clearing one, and submitting the week.
 *
 * How one week runs (`plans/knockout-and-pickem-design.md` §5.2, Q5.4):
 * - The entry's week is a DRAFT while it picks, and every pick saves. It is SUBMITTED once every
 *   game is picked (with confidence values 1 to the game count, each once, in a confidence pool).
 *   Picks stay changeable after submitting.
 * - Each pick locks at its game's kickoff and is revealed to the league then (the engine's pick
 *   window: game by game for pick'em).
 * - Before the first kickoff, a change that leaves a submitted week incomplete or its confidence
 *   values invalid sends it back to DRAFT. A week still in draft at the first kickoff doesn't
 *   count, and can no longer be picked or submitted.
 * - After the first kickoff a submitted week stays submitted: a pick on a game not yet started
 *   can be swapped to the other team, but not cleared, and confidence values must stay valid.
 *
 * The shared parts are here; what varies by prediction type (its pick window, the values a pick
 * carries, what stops a week being submitted) is a `PredictionEngine`.
 */

import type { FastifyBaseLogger } from 'fastify';
import {
  ContestEntryStatus,
  ContestStatus,
  MatchStatus,
  PickEmMode,
  SelectionType,
  contestEntryEventStatus,
  isPredictionSelectionType,
  type Contest,
  type ContestConfiguration,
  type ContestEntry,
  type ContestEntryMatchPrediction,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import type {
  ContestConfigurationRepository,
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionWrite,
  ContestEntryRepository,
  ContestRepository,
  ParticipantRepository,
  SportEventMatchRepository,
  SportEventParticipantRepository,
  SportEventRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import { areMatchPicksOpen, areMatchPicksRevealed } from '../contests/entry-window';
import { hasSportEventStarted } from '../events/operational-timing';
import { getPredictionEngine } from './prediction-engines/registry';
import {
  PredictionIssueKind,
  type PredictionEngine,
  type PredictionIssue,
  type WeekPrediction,
} from './prediction-engines/prediction-engine';
import { selectionErrors, type SelectionError } from './selection-errors';

export interface PredictionServiceDeps {
  contests: Pick<ContestRepository, 'findById'>;
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  entries: Pick<ContestEntryRepository, 'findByIdWithSquad'>;
  squadMemberships: Pick<SquadMembershipRepository, 'findBySquads'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
  field: Pick<SportEventParticipantRepository, 'findBySportEvent'>;
  participants: Pick<ParticipantRepository, 'findByIds'>;
  predictions: ContestEntryMatchPredictionRepository;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export interface GamePicksInput {
  contestId: string;
  entryId: string;
  sportEventId: string;
  actorUserId?: string;
}

export interface SaveGamePicksInput extends GamePicksInput {
  picks: readonly ContestEntryMatchPredictionWrite[];
}

export interface ClearGamePickInput extends GamePicksInput {
  sportEventMatchId: string;
}

export interface GamePickTeam {
  sportEventParticipantId: string;
  participantId: string;
  name: string;
}

export interface GamePickGame {
  match: SportEventMatch;
  /** The game's scheduled time, else its event's start. */
  kickoff: Date;
  home: GamePickTeam | null;
  away: GamePickTeam | null;
  locked: boolean;
  revealed: boolean;
  /** Null when the entry has none, or the viewer may not see it yet. */
  pick: ContestEntryMatchPrediction | null;
}

export interface GamePicksView {
  contestId: string;
  entryId: string;
  entryName: string;
  sportEventId: string;
  mode: PickEmMode;
  status: ContestEntryStatus;
  submittedAt: Date | null;
  ownEntry: boolean;
  canSubmit: boolean;
  pickedCount: number;
  gameCount: number;
  games: GamePickGame[];
}

interface WeekContext {
  contest: Contest;
  configuration: ContestConfiguration | null;
  engine: PredictionEngine;
  mode: PickEmMode;
  sportEvent: SportEvent;
  entry: ContestEntry & { squadName: string };
  /** The event's games that are played, in game-number order: cancelled games are not picked. */
  games: SportEventMatch[];
  predictions: ContestEntryMatchPrediction[];
  ownEntry: boolean;
  now: Date;
}

export class PredictionService {
  constructor(private readonly deps: PredictionServiceDeps) {}

  /**
   * The event's games with the entry's picks on them. Anyone the route lets in (members of the
   * contest's league) may read any entry; another team's pick shows only once its game is revealed.
   */
  async getGamePicks(input: GamePicksInput): Promise<GamePicksView> {
    const context = await this.loadWeek(input);
    return this.buildView(context);
  }

  /**
   * Saves picks on the event's games, all or none. Refused for another team's entry, outside the
   * pick window, for a game not in the event or already started, for a team not in its game, and
   * for a confidence value the pool does not allow. See the class comment for the week's status.
   */
  async saveGamePicks(input: SaveGamePicksInput): Promise<GamePicksView> {
    const context = await this.loadWeek(input);
    this.assertCanChange(context, input.actorUserId);

    const gamesById = new Map(context.games.map((game) => [game.id, game]));
    for (const pick of input.picks) {
      const game = gamesById.get(pick.sportEventMatchId);
      if (!game) throw selectionErrors.gameNotFound(pick.sportEventMatchId, context.sportEvent.id);
      this.assertGameOpen(context, game);
      if (
        pick.sportEventParticipantId !== game.homeSportEventParticipantId
        && pick.sportEventParticipantId !== game.awaySportEventParticipantId
      ) {
        throw selectionErrors.teamNotInGame(pick.sportEventParticipantId, game.id);
      }
      if (!context.engine.acceptsConfidence({
        configuration: context.configuration?.configJson,
        confidence: pick.confidence,
        gameCount: context.games.length,
      })) {
        throw selectionErrors.confidenceInvalid(context.mode === PickEmMode.CONFIDENCE
          ? `A confidence value is a whole number from 1 to ${context.games.length}, the week's number of games`
          : 'A straight-up pool\'s picks carry no confidence value');
      }
    }

    const saved = new Map(input.picks.map((pick) => [pick.sportEventMatchId, pick]));
    const after: WeekPrediction[] = [
      ...context.predictions.filter((prediction) => !saved.has(prediction.sportEventMatchId)),
      ...input.picks,
    ];
    await this.writeWeek(context, after, { saves: input.picks, clearedMatchIds: [] });
    this.deps.logger?.info(
      { action: 'prediction.save', data: { contestId: context.contest.id, entryId: context.entry.id, sportEventId: context.sportEvent.id, pickCount: input.picks.length } },
      'Saved game picks for one event of a contest entry',
    );
    return this.buildView(await this.reload(context));
  }

  /** Removes the entry's pick on one game. Refused once the game has started, and in a submitted week after its first kickoff. */
  async clearGamePick(input: ClearGamePickInput): Promise<GamePicksView> {
    const context = await this.loadWeek(input);
    this.assertCanChange(context, input.actorUserId);

    const game = context.games.find((candidate) => candidate.id === input.sportEventMatchId);
    if (!game) throw selectionErrors.gameNotFound(input.sportEventMatchId, context.sportEvent.id);
    this.assertGameOpen(context, game);
    if (!context.predictions.some((prediction) => prediction.sportEventMatchId === game.id)) {
      return this.buildView(context);
    }
    if (hasSportEventStarted(context.sportEvent, context.now)) {
      throw selectionErrors.clearAfterFirstKickoff(game.id);
    }

    const after = context.predictions.filter((prediction) => prediction.sportEventMatchId !== game.id);
    await this.writeWeek(context, after, { saves: [], clearedMatchIds: [game.id] });
    this.deps.logger?.info(
      { action: 'prediction.clear', data: { contestId: context.contest.id, entryId: context.entry.id, sportEventMatchId: game.id } },
      'Cleared a game pick of a contest entry',
    );
    return this.buildView(await this.reload(context));
  }

  /**
   * Submits the entry's picks for the event once every game is picked and the pool's confidence
   * values are valid, before the event's first kickoff. Submitting a submitted week changes nothing.
   */
  async submitGamePicks(input: GamePicksInput): Promise<GamePicksView> {
    const context = await this.loadWeek(input);
    this.assertOwner(context, input.actorUserId);
    if (contestEntryEventStatus(context.entry, context.sportEvent.id) === ContestEntryStatus.SUBMITTED) {
      return this.buildView(context);
    }
    this.assertContestTakesPicks(context);
    if (hasSportEventStarted(context.sportEvent, context.now)) {
      throw selectionErrors.weekNotSubmittedInTime(context.entry.id, context.sportEvent.id);
    }

    const issue = this.findWeekIssues(context, context.predictions).at(0);
    if (issue) {
      this.deps.logger?.warn(
        { action: 'prediction.submit.refused', data: { entryId: context.entry.id, issue: issue.kind } },
        'Refused to submit a week its picks do not pass',
      );
      throw this.weekIssueError(context, issue);
    }

    await this.deps.predictions.save({
      contestEntryId: context.entry.id,
      sportEventId: context.sportEvent.id,
      saves: [],
      clearedMatchIds: [],
      eventStatus: ContestEntryStatus.SUBMITTED,
      at: context.now,
    });
    this.deps.logger?.info(
      { action: 'prediction.submit.submitted', data: { contestId: context.contest.id, entryId: context.entry.id, sportEventId: context.sportEvent.id } },
      'Submitted a contest entry\'s game picks for one event',
    );
    return this.buildView(await this.reload(context));
  }

  /**
   * Writes the change and the week's status after it. Before the first kickoff a submitted week
   * whose picks no longer pass goes back to DRAFT; after it, the change must keep the week valid.
   */
  private async writeWeek(
    context: WeekContext,
    after: readonly WeekPrediction[],
    change: { saves: readonly ContestEntryMatchPredictionWrite[]; clearedMatchIds: readonly string[] },
  ): Promise<void> {
    const submitted = contestEntryEventStatus(context.entry, context.sportEvent.id) === ContestEntryStatus.SUBMITTED;
    const issue = this.findWeekIssues(context, after).at(0);
    let eventStatus: ContestEntryStatus | null = null;
    if (submitted && issue) {
      if (hasSportEventStarted(context.sportEvent, context.now)) {
        throw this.weekIssueError(context, issue);
      }
      eventStatus = ContestEntryStatus.DRAFT;
      this.deps.logger?.info(
        { action: 'prediction.returnedToDraft', data: { entryId: context.entry.id, sportEventId: context.sportEvent.id } },
        'Sent a submitted week back to draft after a change it no longer passes',
      );
    }
    await this.deps.predictions.save({
      contestEntryId: context.entry.id,
      sportEventId: context.sportEvent.id,
      saves: change.saves,
      clearedMatchIds: change.clearedMatchIds,
      eventStatus,
      at: context.now,
    });
  }

  /** The refusal for the first thing stopping a week's picks from passing. */
  private weekIssueError(context: WeekContext, issue: PredictionIssue): SelectionError {
    switch (issue.kind) {
      case PredictionIssueKind.WEEK_INCOMPLETE:
        return selectionErrors.weekIncomplete(context.entry.id, issue.pickedCount, issue.gameCount);
      case PredictionIssueKind.CONFIDENCE_INVALID:
        return selectionErrors.confidenceInvalid(
          `Entry ${context.entry.id}'s confidence values must be 1 to ${context.games.length}, each used once`,
        );
    }
  }

  private findWeekIssues(context: WeekContext, predictions: readonly WeekPrediction[]) {
    return context.engine.findWeekIssues({
      configuration: context.configuration?.configJson,
      gameMatchIds: context.games.map((game) => game.id),
      predictions,
    });
  }

  private assertOwner(context: WeekContext, actorUserId: string | undefined): void {
    if (!actorUserId) throw selectionErrors.authSessionRequired();
    if (!context.ownEntry) throw selectionErrors.entryAccessDenied();
  }

  private assertContestTakesPicks(context: WeekContext): void {
    const { contest } = context;
    if (contest.status !== ContestStatus.OPEN && contest.status !== ContestStatus.ACTIVE) {
      throw selectionErrors.weekLocked(contest.id, contest.status);
    }
  }

  /** The owner may change picks while the contest takes them, and after the first kickoff only in a submitted week. */
  private assertCanChange(context: WeekContext, actorUserId: string | undefined): void {
    this.assertOwner(context, actorUserId);
    this.assertContestTakesPicks(context);
    if (
      hasSportEventStarted(context.sportEvent, context.now)
      && contestEntryEventStatus(context.entry, context.sportEvent.id) !== ContestEntryStatus.SUBMITTED
    ) {
      throw selectionErrors.weekNotSubmittedInTime(context.entry.id, context.sportEvent.id);
    }
  }

  private assertGameOpen(context: WeekContext, game: SportEventMatch): void {
    if (!areMatchPicksOpen(context.engine.pickWindow, context.contest, context.sportEvent, game, context.now)) {
      this.deps.logger?.warn(
        { action: 'prediction.gameStarted', data: { entryId: context.entry.id, sportEventMatchId: game.id } },
        'Refused a pick change on a game that has started',
      );
      throw selectionErrors.gameStarted(game.id);
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async loadWeek(input: GamePicksInput): Promise<WeekContext> {
    const { contestId, entryId, sportEventId, actorUserId } = input;
    const contest = await this.deps.contests.findById(contestId);
    if (!contest) throw selectionErrors.contestNotFound(contestId);
    const { selectionType } = contest;
    if (!isPredictionSelectionType(selectionType)) {
      throw selectionErrors.contestTakesRosterPicks(contestId);
    }
    if (!contest.sportEventIds.includes(sportEventId)) {
      throw selectionErrors.eventNotInContest(sportEventId, contestId);
    }
    const entry = await this.deps.entries.findByIdWithSquad(entryId);
    if (!entry || entry.contestId !== contestId) throw selectionErrors.entryNotFound(entryId, contestId);

    const [sportEvents, configuration, matches, predictions, memberships] = await Promise.all([
      this.deps.sportEvents.findByIds([sportEventId]),
      this.deps.configurations.findByContest(contestId),
      this.deps.matches.findBySportEvent(sportEventId),
      this.deps.predictions.findByEntryAndEvent(entryId, sportEventId),
      this.deps.squadMemberships.findBySquads([entry.squadId]),
    ]);
    const sportEvent = sportEvents.at(0);
    if (!sportEvent) throw selectionErrors.eventNotInContest(sportEventId, contestId);
    const mode = configuration?.configJson?.selectionType === SelectionType.PICK_EM
      ? configuration.configJson.mode
      : undefined;
    if (mode === undefined) throw selectionErrors.selectionConfigInvalid(contestId);

    return {
      contest,
      configuration,
      engine: getPredictionEngine(selectionType),
      mode,
      sportEvent,
      entry,
      games: matches.filter((match) => match.status !== MatchStatus.CANCELLED),
      predictions,
      ownEntry: actorUserId !== undefined && memberships.some((membership) => membership.userId === actorUserId),
      now: this.now(),
    };
  }

  /** The context after a write: the entry's status and picks read again. */
  private async reload(context: WeekContext): Promise<WeekContext> {
    const [entry, predictions] = await Promise.all([
      this.deps.entries.findByIdWithSquad(context.entry.id),
      this.deps.predictions.findByEntryAndEvent(context.entry.id, context.sportEvent.id),
    ]);
    return { ...context, entry: entry ?? context.entry, predictions };
  }

  private async buildView(context: WeekContext): Promise<GamePicksView> {
    const { contest, engine, sportEvent, entry, games, now, ownEntry } = context;
    const field = await this.deps.field.findBySportEvent(sportEvent.id);
    const participants = await this.deps.participants.findByIds(field.map((row) => row.participantId));
    const nameByParticipantId = new Map(participants.map((participant) => [participant.id, participant.name]));
    const teamByFieldId = new Map(field.map((row) => [row.id, {
      sportEventParticipantId: row.id,
      participantId: row.participantId,
      name: nameByParticipantId.get(row.participantId) ?? '',
    }]));
    const predictionByMatchId = new Map(context.predictions.map((prediction) => [prediction.sportEventMatchId, prediction]));

    const status = contestEntryEventStatus(entry, sportEvent.id);
    const viewGames = games.map((match): GamePickGame => {
      const revealed = areMatchPicksRevealed(engine.pickWindow, contest, sportEvent, match, now);
      const prediction = predictionByMatchId.get(match.id) ?? null;
      return {
        match,
        kickoff: match.scheduledDate ?? sportEvent.startDate,
        home: match.homeSportEventParticipantId === null ? null : teamByFieldId.get(match.homeSportEventParticipantId) ?? null,
        away: match.awaySportEventParticipantId === null ? null : teamByFieldId.get(match.awaySportEventParticipantId) ?? null,
        locked: !areMatchPicksOpen(engine.pickWindow, contest, sportEvent, match, now),
        revealed,
        pick: ownEntry || revealed ? prediction : null,
      };
    });
    const canSubmit = ownEntry
      && status === ContestEntryStatus.DRAFT
      && (contest.status === ContestStatus.OPEN || contest.status === ContestStatus.ACTIVE)
      && !hasSportEventStarted(sportEvent, now)
      && this.findWeekIssues(context, context.predictions).length === 0;

    return {
      contestId: contest.id,
      entryId: entry.id,
      entryName: entry.name,
      sportEventId: sportEvent.id,
      mode: context.mode,
      status,
      submittedAt: entry.events.find((event) => event.sportEventId === sportEvent.id)?.submittedAt ?? null,
      ownEntry,
      canSubmit,
      pickedCount: viewGames.filter((game) => game.pick !== null).length,
      gameCount: games.length,
      games: viewGames,
    };
  }
}
