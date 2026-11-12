import { MatchSide, type SportMatchPeriods, type SportShootout, type SportVocabulary } from '@poolmaster/shared/domain';
import type { SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { describeEntry, feederOf, matchNoun, sideEntry } from './bracket-copy';

// What every bracket match editor shares: the bracket's context, how a side and a pairing read,
// and one write to a match that refreshes the bracket and logs a refusal.

const logger = getLogger().child({ feature: 'root-admin-bracket' });

export type BracketContext = {
  eventId: string;
  vocabulary: SportVocabulary;
  bracket: readonly SportEventMatchDto[];
  field: readonly SportEventParticipantDto[];
  fieldById: ReadonlyMap<string, SportEventParticipantDto>;
  /** Whether the rows carry a spread column: a week of games that forms no bracket (#720). */
  spreads: boolean;
  /** The periods a game is scored by, for a sport that keeps a score at each period's end (#772). */
  periods?: SportMatchPeriods;
  /** How a level bracket match is settled, for a sport that holds shoot-outs (#791); null otherwise. */
  shootout: SportShootout | null;
  /** The provider an event's synced results come from ("BALLDONTLIE"), named beside each of its results. */
  feedName: string;
};

/** A side's team, with its seed, or who fills it while that is still to be decided. */
export function describeSide(match: SportEventMatchDto, side: MatchSide, context: BracketContext): string {
  const entry = sideEntry(match, side, context.fieldById);
  if (entry) {
    return describeEntry(entry);
  }
  const feeder = feederOf(match, side, context.bracket);
  return feeder ? `Winner of ${matchNoun(context.vocabulary).one} ${feeder.matchNumber}` : 'To be decided';
}

/** "Duke vs Vermont" on a neutral site, "Bills @ Chiefs" otherwise. */
export function describePairing(match: SportEventMatchDto, context: BracketContext): string {
  const home = describeSide(match, MatchSide.HOME, context);
  const away = describeSide(match, MatchSide.AWAY, context);
  return match.isNeutralSite ? `${home} vs ${away}` : `${away} @ ${home}`;
}

/**
 * The bracket and its field change together: a result moves its winner on and rewrites
 * standings. The event's key prefixes its bracket and field keys, so it refreshes all three.
 */
export function bracketInvalidates(eventId: string) {
  return [QueryKeys.rootAdmin.manageSport.event(eventId)];
}

export type MatchPath = { eventId: string; matchNumber: number };

/**
 * One write to a match: `write` sends it, and a refusal is thrown so the editor can say why and
 * is logged as `failedAction` with `refusedMessage`. The bracket is read again on success.
 */
export function useMatchWrite<Variables = void>({
  context,
  failedAction,
  logData,
  match,
  onSuccess,
  refusedMessage,
  write,
}: {
  context: BracketContext;
  failedAction: string;
  /** What the log adds about the variables, beside the match number. */
  logData?: (variables: Variables) => Record<string, unknown>;
  match: SportEventMatchDto;
  onSuccess?: () => void;
  refusedMessage: string;
  write: (path: MatchPath, variables: Variables) => Promise<{ error?: unknown }>;
}) {
  return useInvalidatingMutation({
    mutationFn: async (variables: Variables) => {
      const response = await write({ eventId: context.eventId, matchNumber: match.matchNumber }, variables);
      if (response.error) {
        throwApiError(response.error);
      }
    },
    invalidates: bracketInvalidates(context.eventId),
    onSuccess,
    onError: (error, variables) => {
      logger.warn({ action: failedAction, data: { matchNumber: match.matchNumber, ...logData?.(variables) }, err: error }, refusedMessage);
    },
  });
}
