import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
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
      // TODO: Add /v1/social/chat to API_ROUTES once backend endpoint exists
      return await api.get<ChatMessage[]>(`/v1/social/contests/${contestId}/chat?limit=50`);
    },
  });
}

export function useSendChatMessage(contestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.post(`/v1/social/contests/${contestId}/chat`, { content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.chat(contestId) });
    },
  });
}
