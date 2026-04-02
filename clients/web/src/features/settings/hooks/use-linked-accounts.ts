import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface LinkedAccount {
  provider: 'google' | 'apple';
  connected: boolean;
  email: string | null;
}

export function useLinkedAccounts() {
  return useQuery({
    queryKey: settingsKeys.linkedAccounts(),
    queryFn: async (): Promise<LinkedAccount[]> => {
      return await api.get<LinkedAccount[]>(clientPath('/api/v1/auth/linked-accounts'));
    },
  });
}

export function useConnectAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (provider: string) => {
      return await api.post(clientPath(API_ROUTES.auth.linkedAccounts(provider)) + '/connect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.linkedAccounts() });
      toast({ title: 'Account connected' });
    },
  });
}

export function useDisconnectAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (provider: string) => {
      return await api.delete(clientPath(API_ROUTES.auth.linkedAccounts(provider)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.linkedAccounts() });
      toast({ title: 'Account disconnected' });
    },
  });
}
