import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/api';
import { socialKeys } from './query-keys';

export interface ChatMessage {
  id: string;
  type: 'user' | 'system';
  authorName: string;
  authorInitials: string;
  content: string;
  createdAt: string;
  isOwn: boolean;
}

export function useChatMessages(contestId: string) {
  return useQuery({
    queryKey: socialKeys.chat(contestId),
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await client.get<ChatMessage[]>({
        url: '/api/v1/social/contests/{contestId}/chat',
        path: { contestId },
        query: { limit: '50' },
      });
      if (error) throw error;
      return data as ChatMessage[];
    },
  });
}

export function useSendChatMessage(contestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await client.post({
        url: '/api/v1/social/contests/{contestId}/chat',
        path: { contestId },
        body: { content },
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.chat(contestId) });
    },
  });
}
