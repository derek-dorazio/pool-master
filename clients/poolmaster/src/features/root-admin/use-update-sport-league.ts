import { updateSportLeague, type UpdateSportLeagueData } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

const logger = getLogger().child({ feature: 'root-admin-sport-league' });

/**
 * A change to one sport league (its details, whether it is active, its current year): `toBody`
 * says what to change from what the save is given. The sport's league list is read again on success; a refusal is logged as
 * `failedAction` with `refusedMessage`.
 */
export function useUpdateSportLeague<Variables = void>({
  failedAction,
  onSuccess,
  refusedMessage,
  sportLeagueId,
  toBody,
}: {
  failedAction: string;
  onSuccess?: () => void;
  refusedMessage: string;
  sportLeagueId: string;
  toBody: (variables: Variables) => UpdateSportLeagueData['body'];
}) {
  return useInvalidatingMutation({
    mutationFn: async (variables: Variables) => {
      const response = await updateSportLeague({ path: { sportLeagueId }, body: toBody(variables) });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league update response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess,
    onError: (error) => {
      logger.warn({ action: failedAction, data: { sportLeagueId }, err: error }, refusedMessage);
    },
  });
}
