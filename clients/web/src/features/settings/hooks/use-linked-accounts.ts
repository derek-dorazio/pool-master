import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/api';
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
      const { data, error } = await client.get<LinkedAccount[]>({
        url: '/api/v1/auth/linked-accounts',
      });
      if (error) throw error;
      return data as LinkedAccount[];
    },
  });
}

export function useConnectAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (provider: string) => {
      const { data, error } = await client.post({
        url: '/api/v1/auth/linked-accounts/{provider}/connect',
        path: { provider },
      });
      if (error) throw error;
      return data;
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
      const { data, error } = await client.delete({
        url: '/api/v1/auth/linked-accounts/{provider}',
        path: { provider },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.linkedAccounts() });
      toast({ title: 'Account disconnected' });
    },
  });
}
