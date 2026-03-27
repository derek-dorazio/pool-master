import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { settingsKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export interface LinkedAccount {
  provider: 'google' | 'apple';
  connected: boolean;
  email: string | null;
}

const mockLinkedAccounts: LinkedAccount[] = [
  { provider: 'google', connected: true, email: 'dave@gmail.com' },
  { provider: 'apple', connected: false, email: null },
];

export function useLinkedAccounts() {
  return useQuery({
    queryKey: settingsKeys.linkedAccounts(),
    queryFn: async (): Promise<LinkedAccount[]> => {
      // TODO: return api.get<LinkedAccount[]>('/users/me/linked-accounts');
      await new Promise((resolve) => setTimeout(resolve, 200));
      return mockLinkedAccounts;
    },
  });
}

export function useConnectAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_provider: string) => {
      // TODO: Initiate OAuth flow
      // return api.post(`/users/me/linked-accounts/${provider}/connect`);
      await new Promise((resolve) => setTimeout(resolve, 500));
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
    mutationFn: async (_provider: string) => {
      // TODO: return api.delete(`/users/me/linked-accounts/${provider}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.linkedAccounts() });
      toast({ title: 'Account disconnected' });
    },
  });
}
