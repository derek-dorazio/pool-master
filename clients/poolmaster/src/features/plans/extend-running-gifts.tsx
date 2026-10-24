import { extendRunningPlanRenewals } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { formatDateDisplay } from '@/features/shared/ui';
import { ExtendGiftForm } from './extend-gift-form';

/** A root admin extends every league's gifted plan that still runs, from the leagues list (#986). */
export function ExtendRunningGifts() {
  const extendMutation = useInvalidatingMutation({
    mutationFn: async (months: number) => {
      const response = await extendRunningPlanRenewals({ body: { months } });
      if (!response.data) {
        throwApiError(response.error, 'Plan extension response is missing data.');
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.manageLeagues, QueryKeys.leagues.all],
  });

  const result = extendMutation.data;
  return (
    <ExtendGiftForm
      errorMessage={extendMutation.isError
        ? extractErrorMessage(extendMutation.error, { fallback: 'We could not extend the preview periods.' })
        : null}
      isPending={extendMutation.isPending}
      label="Extend every running Premium preview period to"
      onExtend={(months) => extendMutation.mutate(months)}
      result={result
        ? `${result.extendedCount === 1 ? '1 league' : `${result.extendedCount} leagues`} now have a Premium preview period ending on ${formatDateDisplay(result.renewsAt)}.`
        : undefined}
      testId="root-admin-manage-leagues-extend"
    />
  );
}
