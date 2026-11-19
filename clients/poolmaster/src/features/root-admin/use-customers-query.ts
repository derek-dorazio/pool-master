import { useQuery } from '@tanstack/react-query';
import { listCustomerLeagues, listCustomerUsers, type CustomerLeagueDto, type CustomerUserDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** Every league on the platform (#1883), for Customers › Leagues; the grid filters it. */
export function useCustomerLeaguesQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageLeagues,
    queryFn: async (): Promise<CustomerLeagueDto[]> => {
      const response = await listCustomerLeagues();
      if (!response.data) {
        throwApiError(response.error, 'Customer league list response is missing data.');
      }
      return response.data.leagues;
    },
    retry: false,
  });
}

/** Every user on the platform (#1883), for Customers › Users; the grid filters it. */
export function useCustomerUsersQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.users,
    queryFn: async (): Promise<CustomerUserDto[]> => {
      const response = await listCustomerUsers();
      if (!response.data) {
        throwApiError(response.error, 'Customer user list response is missing data.');
      }
      return response.data.users;
    },
    retry: false,
  });
}
