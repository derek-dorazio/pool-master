import { PickEmMode, SelectionType, type SportNoun } from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';
import type {
  GamePickPreviewRequest,
  GamePickPreviewResponse,
  RosterPickPreviewRequest,
  RosterPickPreviewResponse,
  SportEventDto,
} from '@/lib/api';
import type { SelectionGroup } from './contest-entry-selection';
import { getNextBudgetSelectedParticipantIds, getNextSelectedParticipantIds } from './contest-entry-lineup';
import { confidencePicks, teamPick, tiePick, type PickEmGame, type PickEmTeam, type PickEmWeek } from './pick-em-week';

/**
 * "Preview picks page" (#1612): the member pick screen for a setup that is not saved yet, from the
 * form's rules and the picks the commissioner taps to try it. The server builds each screen with
 * the same rules an entry meets; these only shape the form's rules into its request, keep the
 * trial picks between taps, and hand its answer to the pick screens. Nothing is saved.
 */

type GamePickWrite = GamePickPreviewRequest['picks'][number];

/** The setup's rules as a preview reads them: a roster setup's, or a game setup's. */
export type PreviewRules =
  | { kind: 'roster'; rules: RosterPickPreviewRequest['rules'] }
  | { kind: 'games'; rules: GamePickPreviewRequest['rules'] };

/** The formats with a pick screen to preview: tiered and budget lineups, and game picks. */
export function previewRulesFor(configuration: ContestConfigurationRequest): PreviewRules | null {
  switch (configuration.selectionType) {
    case SelectionType.TIERED:
      return {
        kind: 'roster',
        rules: {
          selectionType: SelectionType.TIERED,
          picksPerTier: configuration.picksPerTier,
          countedScores: configuration.countedScores,
          ...(configuration.tiersUsed === undefined ? {} : { tiersUsed: configuration.tiersUsed }),
        },
      };
    case SelectionType.BUDGET_PICK:
      return {
        kind: 'roster',
        rules: { selectionType: SelectionType.BUDGET_PICK, rosterSize: configuration.rosterSize, countedScores: configuration.countedScores },
      };
    case SelectionType.PICK_EM:
      return {
        kind: 'games',
        rules: { selectionType: SelectionType.PICK_EM, mode: configuration.mode, againstTheSpread: configuration.againstTheSpread },
      };
    case SelectionType.BRACKET:
      return { kind: 'games', rules: { selectionType: SelectionType.BRACKET, startsAtRound: configuration.startsAtRound } };
    case SelectionType.SURVIVOR:
      return {
        kind: 'games',
        rules: {
          selectionType: SelectionType.SURVIVOR,
          ...(configuration.reuseTeamsOnceAllUsed === undefined ? {} : { reuseTeamsOnceAllUsed: configuration.reuseTeamsOnceAllUsed }),
        },
      };
    case SelectionType.RANDOM_DRAW:
    case SelectionType.SQUARES:
      return null;
  }
}

/** The event facts that decide whether its pick screen can be shown yet. */
export type PreviewEvent = Pick<SportEventDto, 'loadedParticipantCount' | 'pricing'>;

/**
 * Why the preview is off, in the words beside its button, or null when it can open: a format with
 * no pick screen, rules the form cannot read yet, or an event whose field, tiers or prices are not
 * there to pick from.
 */
export function pickPreviewUnavailableReason({
  event,
  participant,
  rulesError,
  selectionType,
  tierCount,
}: {
  event: PreviewEvent | null;
  participant: SportNoun;
  rulesError: string | null;
  selectionType: SelectionType;
  tierCount: number;
}): string | null {
  if (selectionType === SelectionType.RANDOM_DRAW) {
    return `Members pick nothing in a random draw: the draw deals each entry its ${participant.many}.`;
  }
  if (selectionType === SelectionType.SQUARES) {
    return 'Squares has no picks page: members claim boxes on the game\'s grid.';
  }
  if (event === null) {
    return 'Choose an event to preview its picks page.';
  }
  if (rulesError !== null) {
    return 'Finish the rules to preview the picks page.';
  }
  if (event.loadedParticipantCount === 0) {
    return `This event's ${participant.many} aren't loaded yet, so there is nothing to pick from.`;
  }
  if (selectionType === SelectionType.TIERED && tierCount === 0) {
    return `This event's tiers aren't set yet, so its ${participant.many} can't be shown by tier.`;
  }
  if (selectionType === SelectionType.BUDGET_PICK && event.pricing === null) {
    return `This event's ${participant.many} aren't priced yet.`;
  }
  return null;
}

/**
 * A setup's week as the pick screen draws it: the commissioner's own trial, with no pick time,
 * result or earlier weeks, and the tiebreaker as typed in the preview.
 */
export function toPreviewWeek(preview: GamePickPreviewResponse, tiebreakerValue: number | null): PickEmWeek {
  return {
    againstTheSpread: preview.againstTheSpread,
    gameCount: preview.gameCount,
    mode: preview.mode,
    ownEntry: true,
    selectionType: preview.selectionType,
    survivor: null,
    tiePicksOffered: preview.tiePicksOffered,
    tiebreakerMatchId: preview.tiebreakerMatchId,
    tiebreakerValue,
    games: preview.games.map((game): PickEmGame => ({
      ...game,
      revealed: false,
      pick: game.pick && { ...game.pick, outcome: null, points: null },
    })),
  };
}

/** The trial picks that still stand on the screen: what the next tap builds on. */
function standingPicks(week: PickEmWeek): GamePickWrite[] {
  return week.games.flatMap((game) => (game.pick ? [{
    sportEventMatchId: game.sportEventMatchId,
    predictedResult: game.pick.predictedResult,
    sportEventParticipantId: game.pick.sportEventParticipantId,
    ...(week.mode === PickEmMode.CONFIDENCE ? { confidence: game.pick.confidence } : {}),
  }] : []));
}

/**
 * The trial picks after a tap, as an entry's save would leave them: the tapped games' picks
 * replace theirs, and a survivor week keeps only its one pick.
 */
function withWrites(week: PickEmWeek, writes: GamePickWrite[]): GamePickWrite[] {
  if (week.selectionType === SelectionType.SURVIVOR) {
    return writes;
  }
  const written = new Set(writes.map((write) => write.sportEventMatchId));
  return [...standingPicks(week).filter((pick) => !written.has(pick.sportEventMatchId)), ...writes];
}

/** The trial picks after a tap on a team. */
export function previewTeamPick(week: PickEmWeek, game: PickEmGame, team: PickEmTeam): GamePickWrite[] {
  return withWrites(week, [teamPick(game, team, week.mode)]);
}

/** The trial picks after a tap on the tie. */
export function previewTiePick(week: PickEmWeek, game: PickEmGame): GamePickWrite[] {
  return withWrites(week, [tiePick(game, week.mode)]);
}

/** The trial picks after a confidence value is given, swapped with the game holding it. */
export function previewConfidence(week: PickEmWeek, game: PickEmGame, value: number | null): GamePickWrite[] {
  return withWrites(week, confidencePicks(week.games, game, value));
}

/**
 * When each trial pick was made, by field row: its place in tap order, so a full tier's swap
 * drops the newest as an entry's does.
 */
export function trialPickedAtById(trialIds: readonly string[]): Map<string, string> {
  return new Map(trialIds.map((participantId, index) => [participantId, String(index).padStart(4, '0')]));
}

/**
 * The trial lineup after a tap on a field row, in tap order: a held row is dropped; a tiered setup
 * swaps a full tier's newest pick, and a full budget roster takes no one new.
 */
export function nextTrialIds(
  preview: Pick<RosterPickPreviewResponse, 'selectionType'>,
  group: SelectionGroup,
  participantId: string,
  trialIds: readonly string[],
): string[] {
  const groupIds = new Set(group.participants.map((participant) => participant.sportEventParticipantId));
  const nextGroupIds = preview.selectionType === SelectionType.BUDGET_PICK
    ? getNextBudgetSelectedParticipantIds(group, participantId)
    : getNextSelectedParticipantIds(group, participantId, trialPickedAtById(trialIds));
  const kept = trialIds.filter((id) => !groupIds.has(id) || nextGroupIds.includes(id));
  return [...kept, ...nextGroupIds.filter((id) => !kept.includes(id))];
}
