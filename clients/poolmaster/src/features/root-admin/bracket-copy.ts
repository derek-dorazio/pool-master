import { MatchSide, MatchStatus, type SportNoun, type SportVocabulary } from '@poolmaster/shared/domain';
import { tieWord } from '@/features/contests/contest-sport';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import type { ErrorCodeMessages } from '@/lib/errors';

/** What a bracket screen calls one match when the sport's vocabulary names none. */
const MATCH: SportNoun = { one: 'match', many: 'matches' };

/** One match of the sport's bracket as its screens say it: "game" for basketball. */
export function matchNoun(vocabulary: SportVocabulary): SportNoun {
  return vocabulary.match ?? MATCH;
}

/** A field row as the bracket names it: "(1) Duke", or just the name when it has no seed. */
export function describeEntry(entry: SportEventParticipantDto): string {
  return entry.seedNumber === null ? entry.participant.name : `(${entry.seedNumber}) ${entry.participant.name}`;
}

/** The field row on one side of a match, if a team is named there. */
export function sideEntry(
  match: SportEventMatchDto,
  side: MatchSide,
  fieldById: ReadonlyMap<string, SportEventParticipantDto>,
): SportEventParticipantDto | undefined {
  const sportEventParticipantId = side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
  return sportEventParticipantId === null ? undefined : fieldById.get(sportEventParticipantId);
}

/** The earlier match whose winner fills one side of this one, if any. */
export function feederOf(match: SportEventMatchDto, side: MatchSide, bracket: readonly SportEventMatchDto[]): SportEventMatchDto | undefined {
  return bracket.find((other) => other.advancesToMatchId === match.id && other.advancesToSide === side);
}

/**
 * The bracket's refusals in product copy, worded for the sport (#700). `match` is the match the
 * admin acted on, so a locked result can name the match to clear first.
 */
export function bracketErrorMessages(
  vocabulary: SportVocabulary,
  match?: SportEventMatchDto,
  bracket: readonly SportEventMatchDto[] = [],
): ErrorCodeMessages {
  const noun = matchNoun(vocabulary);
  const team = vocabulary.participant;
  const next = match ? bracket.find((candidate) => candidate.id === match.advancesToMatchId) : undefined;
  return {
    SPORT_EVENT_MATCH_RESULT_LOCKED: next
      ? `This ${noun.one}'s winner is already in ${noun.one} ${next.matchNumber}, which has a score. Clear ${noun.one} ${next.matchNumber}'s score first.`
      : `This ${noun.one}'s winner is already in its next ${noun.one}, which has a score. Clear that score first.`,
    MATCH_SIDES_NOT_SET: `Both ${team.many} in this ${noun.one} aren't known yet. Enter the results of the ${noun.many} before it first.`,
    MATCH_RESULT_INVALID: `That result could not be saved. The winner's score is the higher, a ${tieWord(vocabulary).toLowerCase()} has level scores, and a final score is never below an earlier one.`,
    MATCH_ALREADY_PLAYED: `This ${noun.one} has a result. Clear it before cancelling the ${noun.one}.`,
    MATCH_IN_BRACKET: `This ${noun.one} is part of a bracket, which can't lose a ${noun.one}. Change its time instead.`,
    SPORT_EVENT_NOT_RELEASED: `Release the ${vocabulary.event.one} before entering results.`,
    SPORT_EVENT_BRACKET_LOCKED: `The ${vocabulary.event.one} has been released, so its pairings are locked.`,
    BRACKET_INVALID: `That pairing could not be saved. Each ${team.one} plays one opening ${noun.one}, and two different ${team.many} meet in a ${noun.one}.`,
    BRACKET_MATCH_NOT_FOUND: `That ${noun.one} is no longer in the bracket. Refresh the page.`,
    EVENT_PARTICIPANT_NOT_PLAY_IN_PLACE: `That place is not a play-in place, so its ${team.one} can't be replaced.`,
    EVENT_PARTICIPANT_ALREADY_ON_FIELD: `That ${team.one} is already in the ${vocabulary.event.one}.`,
    PLAY_IN_SLOT_ALREADY_PLAYED: `That place has already played a ${noun.one}, so its ${team.one} can't change.`,
    PARTICIPANT_NOT_FOUND: `That ${team.one} is no longer active. Pick another.`,
    MATCH_SPREAD_LOCKED: `This ${noun.one} already has picks, so its spread can no longer change.`,
    MATCH_PERIOD_SCORE_INVALID: 'A score can only go up as the game goes on. Check it against the other scores of this game.',
    MATCH_PERIOD_INVALID: `This ${noun.one}'s score at that point can't be entered here.`,
    MATCH_CANCELLED: `This ${noun.one} was cancelled, so it has no score.`,
    MATCH_SPREAD_REQUIRED: `The ${vocabulary.event.one} has been released, so this ${noun.one}'s spread can be changed but not cleared.`,
    BRACKET_NOT_RESEEDED: `This round's ${team.many} come from the ${noun.many} before it, so it isn't reseeded.`,
    BRACKET_ROUND_NOT_FINISHED: `Every ${noun.one} of the round before needs a result before this round's ${noun.many} are set.`,
    BRACKET_ROUND_ALREADY_PLAYED: `A ${noun.one} of this round has started, so its ${noun.many} can no longer change.`,
  };
}

/**
 * A reseeded round's refusals (#722, #785): the bracket's, with BRACKET_INVALID worded for what
 * was asked. A suggestion is refused when the teams left don't fit the round; a save when the
 * admin's matchups break the round's rules.
 */
/** What the admin asked of a reseeded round: the server's suggestion, or saving its games. */
export const ReseedAction = {
  SUGGEST: 'SUGGEST',
  SAVE: 'SAVE',
} as const;
export type ReseedAction = (typeof ReseedAction)[keyof typeof ReseedAction];

export function reseedErrorMessages(vocabulary: SportVocabulary, action: ReseedAction): ErrorCodeMessages {
  const noun = matchNoun(vocabulary);
  const team = vocabulary.participant;
  return {
    ...bracketErrorMessages(vocabulary),
    BRACKET_INVALID: action === ReseedAction.SUGGEST
      ? `The ${team.many} left don't fit this round's ${noun.many}. Check the results of the round before.`
      : `These ${noun.many} could not be saved. Each ${team.one} left plays once, against a ${team.one} from its own side of the bracket, and a ${team.one} with a bye keeps its place.`,
  };
}

/**
 * The rounds whose teams are placed by seed rather than by the links of the round before, in
 * order: each after a round with a match that links nowhere, below the last round. The same rule
 * the server applies before it will propose or set a round's matchups.
 */
export function reseededRounds(bracket: readonly SportEventMatchDto[]): number[] {
  const lastRound = Math.max(0, ...bracket.map((match) => match.roundNumber));
  const rounds = new Set(bracket
    .filter((match) => match.advancesToMatchId === null && match.roundNumber < lastRound)
    .map((match) => match.roundNumber + 1));
  return [...rounds].sort((left, right) => left - right);
}

/** Whether a round has begun: a match is no longer scheduled, or has a period's score (#772). */
export function roundStarted(bracket: readonly SportEventMatchDto[], roundNumber: number): boolean {
  return bracket.some((match) => match.roundNumber === roundNumber
    && (match.status !== MatchStatus.SCHEDULED || match.periodScores.length > 0));
}

/** The matches of the round before this one that have no result yet, in match-number order. */
export function unfinishedBefore(bracket: readonly SportEventMatchDto[], roundNumber: number): SportEventMatchDto[] {
  return bracket
    .filter((match) => match.roundNumber === roundNumber - 1 && match.status !== MatchStatus.COMPLETED)
    .sort((left, right) => left.matchNumber - right.matchNumber);
}

/**
 * Whether the event's games form no bracket (a week of NFL games, #715): none links to another
 * and all are in one round. Only such a game can be cancelled, since a bracket can't lose one,
 * and only such games carry a spread column (#720).
 */
export function formsNoBracket(bracket: readonly SportEventMatchDto[]): boolean {
  return bracket.every((game) => game.advancesToMatchId === null && game.roundNumber === bracket[0]?.roundNumber);
}
