import { useQueryClient } from '@tanstack/react-query';
import { extendLeaguePlanRenewal, type LeagueDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { syncLeagueCaches } from '@/features/leagues/league-cache';
import { formatDateDisplay } from '@/features/shared/ui';
import { ExtendGiftForm } from './extend-gift-form';

/** A root admin extends one league's gifted plan, on its settings page (#986). */
export function ExtendLeagueGift({ league }: { league: LeagueDto }) {
  const queryClient = useQueryClient();
  const extendMutation = useInvalidatingMutation({
    mutationFn: async (months: number) => {
      const response = await extendLeaguePlanRenewal({ path: { id: league.id }, body: { months } });
      if (!response.data?.league) {
        throwApiError(response.error, 'Plan extension response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => syncLeagueCaches(queryClient, updated),
    // Root admin's league list shows each league's gift.
    invalidates: [QueryKeys.rootAdmin.manageLeagues],
  });

  return (
    <ExtendGiftForm
      errorMessage={extendMutation.isError
        ? extractErrorMessage(extendMutation.error, { fallback: 'We could not extend the preview period.' })
        : null}
      isPending={extendMutation.isPending}
      label="Extend the Premium preview period to"
      onExtend={(months) => extendMutation.mutate(months)}
      result={extendMutation.data ? `The Premium preview period now ends on ${formatDateDisplay(extendMutation.data.planRenewsAt)}.` : undefined}
      testId="league-settings-plan-extend"
    />
  );
}
