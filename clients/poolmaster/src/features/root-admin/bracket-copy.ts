import { isMatchUnplayed, MatchEnding, MatchSide, MatchStatus, type SportNoun, type SportVocabulary } from '@poolmaster/shared/domain';
import { tieWord } from '@/features/contests/contest-sport';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import type { DisplayStringValues } from '@poolmaster/shared/display-strings';
import type { ExtractErrorMessageOptions } from '@/lib/errors';

/** What a bracket screen calls one match when the sport's vocabulary names none. */
const MATCH: SportNoun = { one: 'match', many: 'matches' };

/**
 * How a match that stopped early is marked beside its result (#704): "ret.", "w/o", "def.", as
 * tennis writes them. The marks belong to the ending, not the sport. A played match has none.
 */
export const MATCH_ENDING_MARK: Readonly<Record<MatchEnding, string | null>> = {
  [MatchEnding.PLAYED]: null,
  [MatchEnding.RETIREMENT]: 'ret.',
  [MatchEnding.WALKOVER]: 'w/o',
  [MatchEnding.DEFAULT]: 'def.',
};

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

/**
 * The field rows a withdrawal can still replace (#704), as the server allows: named by exactly one
 * match, a first-round match not yet started, and not a play-in place, which takes its winner instead.
 */
export function replaceableEntries(
  bracket: readonly SportEventMatchDto[],
  fieldById: ReadonlyMap<string, SportEventParticipantDto>,
): SportEventParticipantDto[] {
  const firstRound = Math.min(...bracket.map((match) => match.roundNumber));
  const placesOf = new Map<string, number>();
  for (const match of bracket) {
    for (const id of [match.homeSportEventParticipantId, match.awaySportEventParticipantId]) {
      if (id !== null) placesOf.set(id, (placesOf.get(id) ?? 0) + 1);
    }
  }
  return bracket
    .filter((match) => isMatchUnplayed(match.status) && match.roundNumber === firstRound)
    .flatMap((match) => [MatchSide.HOME, MatchSide.AWAY].map((side) => sideEntry(match, side, fieldById)))
    .filter((entry): entry is SportEventParticipantDto => entry !== undefined
      && placesOf.get(entry.id) === 1 && entry.isActive && !entry.isPlayInPlace);
}

/** The earlier match whose winner fills one side of this one, if any. */
export function feederOf(match: SportEventMatchDto, side: MatchSide, bracket: readonly SportEventMatchDto[]): SportEventMatchDto | undefined {
  return bracket.find((other) => other.advancesToMatchId === match.id && other.advancesToSide === side);
}

/** A bracket screen's error wording: its contexts and the sport's words for their placeholders. */
export type BracketErrorOptions = Required<Pick<ExtractErrorMessageOptions, 'context' | 'values'>>;

/** The sport's words a bracket screen's error wording takes (#700). */
function bracketErrorValues(vocabulary: SportVocabulary): DisplayStringValues {
  const noun = matchNoun(vocabulary);
  return {
    match: noun.one,
    matches: noun.many,
    participant: vocabulary.participant.one,
    participants: vocabulary.participant.many,
    event: vocabulary.event.one,
    tie: tieWord(vocabulary).toLowerCase(),
    playIn: vocabulary.playInPlace ?? 'play-in',
  };
}

/**
 * The bracket's refusals in the sport's words (#700). `match` is the match the admin acted on,
 * so a locked result can name the match to clear first.
 */
export function bracketErrors(
  vocabulary: SportVocabulary,
  match?: SportEventMatchDto,
  bracket: readonly SportEventMatchDto[] = [],
): BracketErrorOptions {
  const next = match ? bracket.find((candidate) => candidate.id === match.advancesToMatchId) : undefined;
  return next
    ? { context: ['bracketAdminNextMatch', 'bracketAdmin'], values: { ...bracketErrorValues(vocabulary), nextMatchNumber: next.matchNumber } }
    : { context: 'bracketAdmin', values: bracketErrorValues(vocabulary) };
}

/**
 * A replacement or play-in winner's refusals: the bracket's, and the refusal of one off the
 * event's league roster (#830) in the league's own word, a tour for the ATP, a league for the NCAA.
 */
export function replacementErrors(vocabulary: SportVocabulary, sportLeague: SportNoun): BracketErrorOptions {
  return {
    context: ['replaceParticipant', 'bracketAdmin'],
    values: { ...bracketErrorValues(vocabulary), sportLeague: sportLeague.one },
  };
}

/** What the admin asked of a reseeded round: the server's suggestion, or saving its games. */
export const ReseedAction = {
  SUGGEST: 'SUGGEST',
  SAVE: 'SAVE',
} as const;
export type ReseedAction = (typeof ReseedAction)[keyof typeof ReseedAction];

/**
 * A reseeded round's refusals (#722, #785): the bracket's, with BRACKET_INVALID worded for what
 * was asked. A suggestion is refused when the teams left don't fit the round; a save when the
 * admin's matchups break the round's rules.
 */
export function reseedErrors(vocabulary: SportVocabulary, action: ReseedAction): BracketErrorOptions {
  return {
    context: [action === ReseedAction.SUGGEST ? 'reseedSuggest' : 'reseedSave', 'bracketAdmin'],
    values: bracketErrorValues(vocabulary),
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

/** Whether a round has begun: a match is no longer still to play (scheduled or postponed), or has a period's score (#772). */
export function roundStarted(bracket: readonly SportEventMatchDto[], roundNumber: number): boolean {
  return bracket.some((match) => match.roundNumber === roundNumber
    && (!isMatchUnplayed(match.status) || match.periodScores.length > 0));
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
