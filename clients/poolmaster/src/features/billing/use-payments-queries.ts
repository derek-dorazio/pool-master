import { skipToken, useQuery } from '@tanstack/react-query';
import { listLeaguePayments, listUserPayments, type LeaguePayment, type UserPayment } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** A league's payment history, newest first (#987). Commissioners and root admins only. */
export function useLeaguePaymentsQuery(leagueId: string | undefined) {
  return useQuery({
    queryKey: QueryKeys.payments.league(leagueId),
    queryFn: leagueId ? async (): Promise<LeaguePayment[]> => {
      const response = await listLeaguePayments({ path: { id: leagueId } });
      if (!response.data) {
        throwApiError(response.error, 'League payments response is missing data.');
      }
      return response.data.payments;
    } : skipToken,
  });
}

/** The signed-in user's payments in any of their leagues, newest first (#987). */
export function useMyPaymentsQuery() {
  return useQuery({
    queryKey: QueryKeys.payments.mine,
    queryFn: async (): Promise<UserPayment[]> => {
      const response = await listUserPayments({ path: { userId: 'me' } });
      if (!response.data) {
        throwApiError(response.error, 'Payments response is missing data.');
      }
      return response.data.payments;
    },
  });
}
