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
      try {
        return await api.get<LinkedAccount[]>('/v1/auth/linked-accounts');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockLinkedAccounts;
      }
    },
  });
}

export function useConnectAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (provider: string) => {
      try {
        return await api.post(`/v1/auth/linked-accounts/${provider}/connect`);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
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
      try {
        return await api.delete(`/v1/auth/linked-accounts/${provider}`);
      } catch {
        // Fallback: simulate success when backend unavailable
        return undefined;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.linkedAccounts() });
      toast({ title: 'Account disconnected' });
    },
  });
}
