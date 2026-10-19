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
 * - In a bracket (#721) the whole event is one "week" picked before it starts, a later game offers
 *   the teams the entry's earlier picks put there, and changing a pick clears the later picks that
 *   followed from it.
 * - Every week is submitted with its tiebreaker (#717), a guess of its tiebreaker game's total
 *   points: a bracket's final, a pick'em week's last game. It is kept per event, and locks and is
 *   revealed with that game's pick.
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
  contestEntryEventTiebreaker,
  isPredictionSelectionType,
  type Contest,
  type ContestConfiguration,
  type ContestEntry,
  type ContestEntryMatchPrediction,
  type PredictionSelectionType,
  type SportEvent,
  type SportEventMatch,
  type SportEventParticipant,
} from '@poolmaster/shared/domain';
import type {
  ContestConfigurationRepository,
  ContestEntryMatchPredictionRepository,
  ContestEntryMatchPredictionWrite,
  ContestEntryRepository,
  ContestRepository,
  ParticipantContestScoringRuleRepository,
  ParticipantRepository,
  SportEventMatchRepository,
  SportEventParticipantRepository,
  SportEventRepository,
  SquadMembershipRepository,
} from '@poolmaster/shared/db';
import { resolveContestScoringDefinition } from '../contests/contest-leaderboard-calculator';
import { areMatchPicksOpen, areMatchPicksRevealed, contestCutoff, cutoffTiming, type EventTiming } from '../contests/entry-window';
import { knockoutSeeds } from '../scoring-families/head-to-head/score-team';
import { contestBracketGames, type PredictedSides, type ScoredBracketPick } from '../scoring-families/head-to-head/bracket-picks';
import { hasSportEventStarted } from '../events/operational-timing';
import { getPredictionEngine } from './prediction-engines/registry';
import {
  PredictionIssueKind,
  type PredictionEngine,
  type PicksScore,
  type PredictionIssue,
  type WeekPrediction,
} from './prediction-engines/prediction-engine';
import { selectionErrors, type SelectionError } from './selection-errors';

export interface PredictionServiceDeps {
  contests: Pick<ContestRepository, 'findById'>;
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  scoringRules: Pick<ParticipantContestScoringRuleRepository, 'findByContestConfiguration'>;
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
  /** The week's tiebreaker, its tiebreaker game's total points; undefined leaves it as it is. */
  tiebreakerValue?: number | null;
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
  /** The teams the entry's own picks put in the game: in a bracket, its picks of the games before; else the game's teams. */
  predictedHome: GamePickTeam | null;
  predictedAway: GamePickTeam | null;
  locked: boolean;
  revealed: boolean;
  /** Null when the entry has none, or the viewer may not see it yet. */
  pick: ContestEntryMatchPrediction | null;
  /** How the pick stands against the results; null with no pick shown, or where the type is not scored yet. */
  pickScore: ScoredBracketPick | null;
}

export interface GamePicksView {
  contestId: string;
  entryId: string;
  entryName: string;
  sportEventId: string;
  selectionType: PredictionSelectionType;
  /** A pick'em pool's mode; null in a bracket. */
  mode: PickEmMode | null;
  status: ContestEntryStatus;
  submittedAt: Date | null;
  ownEntry: boolean;
  canSubmit: boolean;
  pickedCount: number;
  gameCount: number;
  /** The game the tiebreaker guesses the total points of: a bracket's final, a week's last game; null while there is none. */
  tiebreakerMatchId: string | null;
  /** The entry's tiebreaker for the event; null when not given, or hidden until its game is revealed. */
  tiebreakerValue: number | null;
  /** Points so far and the most still possible; null while hidden or where the type is not scored yet. */
  points: number | null;
  maxPossiblePoints: number | null;
  games: GamePickGame[];
}

interface WeekContext {
  contest: Contest;
  configuration: ContestConfiguration | null;
  engine: PredictionEngine;
  selectionType: PredictionSelectionType;
  mode: PickEmMode | null;
  sportEvent: SportEvent;
  /** The timing the contest's window runs on: the event's, or its starting round's for a second-chance bracket (#721). */
  window: EventTiming;
  /** The event's field, and each row's seed as a reseeded bracket and the upset bonus read it. */
  field: SportEventParticipant[];
  seedOf: Map<string, number | null>;
  entry: ContestEntry & { squadName: string };
  /** The games the entry picks, in game-number order: cancelled games are not picked, and a bracket's start at its starting round. */
  games: SportEventMatch[];
  /** The game whose total points the tiebreaker guesses, among `games`. */
  tiebreakerGame: SportEventMatch | null;
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
    if (input.tiebreakerValue !== undefined && !this.isTiebreakerOpen(context)) {
      throw selectionErrors.tiebreakerLocked(context.entry.id);
    }

    const gamesById = new Map(context.games.map((game) => [game.id, game]));
    for (const pick of input.picks) {
      const game = gamesById.get(pick.sportEventMatchId);
      if (!game) throw selectionErrors.gameNotFound(pick.sportEventMatchId, context.sportEvent.id);
      this.assertGameOpen(context, game);
    }

    // A saved pick must name a team its game offers the entry, its earlier picks included; a pick
    // already saved that no longer does (a bracket pick that followed from a changed one) is cleared.
    // The team is checked before the pick's confidence value, as it always was (#716).
    const saved = new Map(input.picks.map((pick) => [pick.sportEventMatchId, pick]));
    const resolved = this.resolvePicks(context, [
      ...context.predictions.filter((prediction) => !saved.has(prediction.sportEventMatchId)),
      ...input.picks,
    ]);
    const refused = resolved.stranded.find((pick) => saved.has(pick.sportEventMatchId));
    if (refused) throw selectionErrors.teamNotInGame(refused.sportEventParticipantId, refused.sportEventMatchId);
    for (const pick of input.picks) {
      if (!context.engine.acceptsConfidence({
        configuration: context.configuration?.configJson,
        confidence: pick.confidence,
        gameCount: context.games.length,
      })) {
        throw selectionErrors.confidenceInvalid(context.mode === PickEmMode.CONFIDENCE
          ? `A confidence value is a whole number from 1 to ${context.games.length}, the week's number of games`
          : 'This pool\'s picks carry no confidence value');
      }
    }
    await this.writeWeek(context, resolved.kept, {
      saves: input.picks,
      clearedMatchIds: resolved.stranded.map((pick) => pick.sportEventMatchId),
      tiebreakerValue: input.tiebreakerValue,
    });
    this.deps.logger?.info(
      { action: 'prediction.save', data: { contestId: context.contest.id, entryId: context.entry.id, sportEventId: context.sportEvent.id, pickCount: input.picks.length, clearedCount: resolved.stranded.length } },
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
    if (hasSportEventStarted(context.window, context.now)) {
      throw selectionErrors.clearAfterFirstKickoff(game.id);
    }

    const resolved = this.resolvePicks(context, context.predictions.filter((prediction) => prediction.sportEventMatchId !== game.id));
    await this.writeWeek(context, resolved.kept, {
      saves: [],
      clearedMatchIds: [game.id, ...resolved.stranded.map((pick) => pick.sportEventMatchId)],
    });
    this.deps.logger?.info(
      { action: 'prediction.clear', data: { contestId: context.contest.id, entryId: context.entry.id, sportEventMatchId: game.id, clearedCount: resolved.stranded.length + 1 } },
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
    if (hasSportEventStarted(context.window, context.now)) {
      throw selectionErrors.weekNotSubmittedInTime(context.entry.id, context.sportEvent.id);
    }

    const issue = this.findWeekIssues(context, context.predictions, contestEntryEventTiebreaker(context.entry, context.sportEvent.id)).at(0);
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
    change: { saves: readonly ContestEntryMatchPredictionWrite[]; clearedMatchIds: readonly string[]; tiebreakerValue?: number | null },
  ): Promise<void> {
    const submitted = contestEntryEventStatus(context.entry, context.sportEvent.id) === ContestEntryStatus.SUBMITTED;
    const issue = this.findWeekIssues(context, after, change.tiebreakerValue === undefined ? contestEntryEventTiebreaker(context.entry, context.sportEvent.id) : change.tiebreakerValue).at(0);
    let eventStatus: ContestEntryStatus | null = null;
    if (submitted && issue) {
      if (hasSportEventStarted(context.window, context.now)) {
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
      tiebreakerValue: change.tiebreakerValue,
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
      case PredictionIssueKind.TIEBREAKER_MISSING:
        return selectionErrors.tiebreakerMissing(context.entry.id);
    }
  }

  private findWeekIssues(context: WeekContext, predictions: readonly WeekPrediction[], tiebreakerValue: number | null) {
    return context.engine.findWeekIssues({
      configuration: context.configuration?.configJson,
      gameMatchIds: context.games.map((game) => game.id),
      predictions,
      tiebreakerValue,
    });
  }

  /** The tiebreaker can change while its game's pick can: until a week's last game kicks off, until a bracket starts. */
  private isTiebreakerOpen(context: WeekContext): boolean {
    const game = context.tiebreakerGame;
    return game !== null && areMatchPicksOpen(context.engine.pickWindow, context.contest, context.window, game, context.now);
  }

  /** Another team's tiebreaker shows once its game's picks are revealed. */
  private isTiebreakerRevealed(context: WeekContext): boolean {
    const game = context.tiebreakerGame;
    return game !== null && areMatchPicksRevealed(context.engine.pickWindow, context.contest, context.window, game, context.now);
  }

  private resolvePicks<Pick extends WeekPrediction>(context: WeekContext, predictions: readonly Pick[]) {
    return context.engine.resolvePicks({ games: context.games, predictions, seedOf: context.seedOf });
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
      hasSportEventStarted(context.window, context.now)
      && contestEntryEventStatus(context.entry, context.sportEvent.id) !== ContestEntryStatus.SUBMITTED
    ) {
      throw selectionErrors.weekNotSubmittedInTime(context.entry.id, context.sportEvent.id);
    }
  }

  private assertGameOpen(context: WeekContext, game: SportEventMatch): void {
    if (!areMatchPicksOpen(context.engine.pickWindow, context.contest, context.window, game, context.now)) {
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

    const [sportEvents, configuration, matches, predictions, memberships, field] = await Promise.all([
      this.deps.sportEvents.findByIds([sportEventId]),
      this.deps.configurations.findByContest(contestId),
      this.deps.matches.findBySportEvent(sportEventId),
      this.deps.predictions.findByEntryAndEvent(entryId, sportEventId),
      this.deps.squadMemberships.findBySquads([entry.squadId]),
      this.deps.field.findBySportEvent(sportEventId),
    ]);
    const sportEvent = sportEvents.at(0);
    if (!sportEvent) throw selectionErrors.eventNotInContest(sportEventId, contestId);
    const rules = configuration?.configJson;
    if (rules?.selectionType !== selectionType) throw selectionErrors.selectionConfigInvalid(contestId);
    const games = rules.selectionType === SelectionType.BRACKET
      ? contestBracketGames(matches, rules.startsAtRound)
      : matches.filter((match) => match.status !== MatchStatus.CANCELLED);
    const engine = getPredictionEngine(selectionType);

    return {
      contest,
      configuration,
      engine,
      selectionType,
      mode: rules.selectionType === SelectionType.PICK_EM ? rules.mode : null,
      sportEvent,
      window: cutoffTiming(contestCutoff(rules), sportEvent, matches),
      field,
      seedOf: knockoutSeeds(field),
      entry,
      games,
      tiebreakerGame: engine.tiebreakerGame({ games, eventStart: sportEvent.startDate }),
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
    const { contest, engine, sportEvent, window, entry, games, now, ownEntry, field } = context;
    const participants = await this.deps.participants.findByIds(field.map((row) => row.participantId));
    const nameByParticipantId = new Map(participants.map((participant) => [participant.id, participant.name]));
    const teamByFieldId = new Map(field.map((row) => [row.id, {
      sportEventParticipantId: row.id,
      participantId: row.participantId,
      name: nameByParticipantId.get(row.participantId) ?? '',
    }]));
    const team = (fieldId: string | null) => (fieldId === null ? null : teamByFieldId.get(fieldId) ?? null);
    const predictionByMatchId = new Map(context.predictions.map((prediction) => [prediction.sportEventMatchId, prediction]));
    const resolved = this.resolvePicks(context, context.predictions);
    const score = await this.scorePicks(context, resolved.kept);

    const status = contestEntryEventStatus(entry, sportEvent.id);
    const viewGames = games.map((match): GamePickGame => {
      const revealed = areMatchPicksRevealed(engine.pickWindow, contest, window, match, now);
      const shown = ownEntry || revealed;
      const prediction = predictionByMatchId.get(match.id) ?? null;
      // Another team's predicted sides would show its picks, so until they are revealed it sees the game's own.
      const sides: PredictedSides = (shown ? resolved.sides.get(match.id) : undefined)
        ?? { home: match.homeSportEventParticipantId, away: match.awaySportEventParticipantId };
      return {
        match,
        kickoff: match.scheduledDate ?? sportEvent.startDate,
        home: team(match.homeSportEventParticipantId),
        away: team(match.awaySportEventParticipantId),
        predictedHome: team(sides.home),
        predictedAway: team(sides.away),
        locked: !areMatchPicksOpen(engine.pickWindow, contest, window, match, now),
        revealed,
        pick: shown ? prediction : null,
        pickScore: shown && prediction !== null ? score?.picks.get(match.id) ?? null : null,
      };
    });
    const everyPickShown = viewGames.every((game) => ownEntry || game.revealed);
    const canSubmit = ownEntry
      && status === ContestEntryStatus.DRAFT
      && (contest.status === ContestStatus.OPEN || contest.status === ContestStatus.ACTIVE)
      && !hasSportEventStarted(window, now)
      && this.findWeekIssues(context, context.predictions, contestEntryEventTiebreaker(entry, sportEvent.id)).length === 0;

    return {
      contestId: contest.id,
      entryId: entry.id,
      entryName: entry.name,
      sportEventId: sportEvent.id,
      selectionType: context.selectionType,
      mode: context.mode,
      status,
      submittedAt: entry.events.find((event) => event.sportEventId === sportEvent.id)?.submittedAt ?? null,
      ownEntry,
      canSubmit,
      pickedCount: viewGames.filter((game) => game.pick !== null).length,
      gameCount: games.length,
      tiebreakerMatchId: context.tiebreakerGame?.id ?? null,
      tiebreakerValue: ownEntry || this.isTiebreakerRevealed(context) ? contestEntryEventTiebreaker(entry, sportEvent.id) : null,
      points: everyPickShown ? score?.points ?? null : null,
      maxPossiblePoints: everyPickShown ? score?.maxPossiblePoints ?? null : null,
      games: viewGames,
    };
  }

  /** The entry's standing picks scored against the results so far, under the contest's scoring. */
  private async scorePicks(context: WeekContext, predictions: readonly WeekPrediction[]): Promise<PicksScore | null> {
    const rules = context.configuration
      ? await this.deps.scoringRules.findByContestConfiguration(context.configuration.id)
      : [];
    const scoring = resolveContestScoringDefinition({
      configJson: context.configuration?.configJson ?? null,
      participantScoringRules: rules,
    });
    return context.engine.scorePicks({
      configuration: context.configuration?.configJson,
      games: context.games,
      predictions,
      seedOf: context.seedOf,
      scoring: scoring.ok ? scoring.scoring : null,
    });
  }
}
