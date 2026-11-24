import { updateSportLeague, type UpdateSportLeagueData } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

const logger = getLogger().child({ feature: 'root-admin-sport-league' });

/**
 * What a sport league write makes stale: the sport's league lists, the list of every sport
 * league the Profiles dialogs read, and each profile's "Used by" count, which a league naming
 * another profile changes (#1849).
 */
export const SPORT_LEAGUE_WRITE_INVALIDATES = [
  QueryKeys.rootAdmin.manageSport.leagues,
  QueryKeys.sportLeagues.list(),
  QueryKeys.rootAdmin.platformTierProfiles,
  QueryKeys.rootAdmin.platformPricingProfiles,
] as const;

/**
 * A change to one sport league (its details, whether it is active, its current year): `toBody`
 * says what to change from what the save is given. The league lists and profile counts are read again on success; a refusal is logged as
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
    invalidates: SPORT_LEAGUE_WRITE_INVALIDATES,
    onSuccess,
    onError: (error) => {
      logger.warn({ action: failedAction, data: { sportLeagueId }, err: error }, refusedMessage);
    },
  });
}
