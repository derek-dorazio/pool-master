import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const mockChatMessages: ChatMessage[] = [
  { id: 'c1', type: 'system', authorName: 'System', authorInitials: '', content: 'Draft started', createdAt: new Date(Date.now() - 30 * 60_000).toISOString(), isOwn: false },
  { id: 'c2', type: 'user', authorName: 'Mike', authorInitials: 'MT', content: 'Good luck all!', createdAt: new Date(Date.now() - 28 * 60_000).toISOString(), isOwn: false },
  { id: 'c3', type: 'system', authorName: 'System', authorInitials: '', content: 'Round 1 — Pick 1', createdAt: new Date(Date.now() - 25 * 60_000).toISOString(), isOwn: false },
  { id: 'c4', type: 'user', authorName: 'Jane', authorInitials: 'JD', content: 'Here we go', createdAt: new Date(Date.now() - 24 * 60_000).toISOString(), isOwn: false },
  { id: 'c5', type: 'user', authorName: 'You', authorInitials: 'DO', content: "Let's do it!", createdAt: new Date(Date.now() - 23 * 60_000).toISOString(), isOwn: true },
  { id: 'c6', type: 'system', authorName: 'System', authorInitials: '', content: 'John picked Mahomes', createdAt: new Date(Date.now() - 20 * 60_000).toISOString(), isOwn: false },
];

export function useChatMessages(contestId: string) {
  return useQuery({
    queryKey: socialKeys.chat(contestId),
    queryFn: async (): Promise<ChatMessage[]> => {
      // TODO: return api.get(`/api/contests/${contestId}/chat?limit=50`);
      await new Promise((r) => setTimeout(r, 200));
      return mockChatMessages;
    },
  });
}

export function useSendChatMessage(contestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_content: string) => {
      // TODO: return api.post(`/api/contests/${contestId}/chat`, { content });
      await new Promise((r) => setTimeout(r, 100));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.chat(contestId) });
    },
  });
}
