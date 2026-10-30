import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import {
  getGamePicks,
  saveGamePicks,
  submitGamePicks,
  type ContestDto,
  type GamePicksResponse,
  type SaveGamePicksRequest,
} from '@/lib/api';
import { ApiError, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { CONTEST_POLL_INTERVAL_MS, shouldPollContestEntries } from './contest-status';
import { entryWriteKeys } from './use-contest-entries';

/** What each page's picks are called in its log and error lines, by its log actions' prefix. */
const PICKS_NAMES = {
  bracket: 'Bracket',
  pickEm: 'Pick\'em',
} as const;

/**
 * One entry's game picks for one event, as a bracket or a pick'em week reads and writes them: the
 * picks, the save that takes a pick or the tiebreaker, the submit, and the tiebreaker being typed.
 *
 * A save or submit answers with the whole set of picks, which replaces the cache: a changed
 * bracket pick may have cleared later picks. A refused save reads the picks again, since the ones
 * on screen are then not the server's. The entry list carries each event's status, which a save
 * can send back to draft.
 */
export function useGamePicks({
  action,
  contest,
  entryId,
  feature,
  sportEventId,
  submitInvalidates = [],
}: {
  /** The log actions' prefix, such as `bracket` for `bracket.save.failed`. */
  action: keyof typeof PICKS_NAMES;
  contest: ContestDto;
  entryId: string;
  /** The logger's feature, the page's name. */
  feature: string;
  sportEventId: string;
  /** Reads a submit changes besides the entry's own, such as the leaderboards that show it. */
  submitInvalidates?: readonly QueryKey[];
}) {
  const logger = getLogger().child({ feature });
  const picksName = PICKS_NAMES[action];
  const queryClient = useQueryClient();
  const contestId = contest.id;
  const gamePicksKey = QueryKeys.gamePicks.detail(contestId, entryId, sportEventId);
  // Null until the member types: the field shows the saved tiebreaker until then, so a refetch
  // never overwrites what is being typed (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  const [tiebreakerDraft, setTiebreakerDraft] = useState<string | null>(null);

  const gamePicksQuery = useQuery({
    queryKey: gamePicksKey,
    queryFn: async (): Promise<GamePicksResponse> => {
      const response = await getGamePicks({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, `${picksName} picks response is missing data.`);
      }
      return response.data;
    },
    enabled: Boolean(entryId && sportEventId),
    retry: false,
    // Once the games are under way each pick's mark moves with the results.
    refetchInterval: shouldPollContestEntries(contest.status) ? CONTEST_POLL_INTERVAL_MS : false,
  });

  const logRefusal = (refusedAction: string, error: Error) => {
    const payload = { action: refusedAction, data: { contestId, entryId, sportEventId }, err: error };
    if (error instanceof ApiError) {
      logger.warn(payload, `${picksName} write was rejected`);
    } else {
      logger.error(payload, `${picksName} write failed unexpectedly`);
    }
  };

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (body: SaveGamePicksRequest) => {
      const response = await saveGamePicks({ path: { contestId, entryId, sportEventId }, body });
      if (!response.data) {
        throwApiError(response.error, `${picksName} save response is missing data.`);
      }
      return response.data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<GamePicksResponse>(gamePicksKey, saved);
      setTiebreakerDraft(null);
    },
    invalidates: [QueryKeys.contestEntries.byContest(contestId)],
    onError: (error) => {
      logRefusal(`${action}.save.failed`, error);
      void queryClient.invalidateQueries({ queryKey: gamePicksKey });
    },
  });

  const submitMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await submitGamePicks({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, `${picksName} submit response is missing data.`);
      }
      return response.data;
    },
    onSuccess: (submitted) => {
      logger.info({ action: `${action}.submit.succeeded`, data: { contestId, entryId, sportEventId } }, `Submitted ${picksName.toLowerCase()} picks`);
      queryClient.setQueryData<GamePicksResponse>(gamePicksKey, submitted);
    },
    invalidates: [...entryWriteKeys(contestId), ...submitInvalidates],
    onError: (error) => logRefusal(`${action}.submit.failed`, error),
  });

  return { gamePicksQuery, saveMutation, setTiebreakerDraft, submitMutation, tiebreakerDraft };
}
