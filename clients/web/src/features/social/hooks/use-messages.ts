import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { socialKeys } from './query-keys';

export interface Conversation {
  id: string;
  participantName: string;
  participantInitials: string;
  participantAvatarUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  isOwn: boolean;
  delivered: boolean;
  read: boolean;
}

const mockConversations: Conversation[] = [
  { id: 'conv-1', participantName: 'Mike Thompson', participantInitials: 'MT', participantAvatarUrl: null, lastMessage: 'Hey, want to trade picks?', lastMessageAt: new Date(Date.now() - 2 * 60_000).toISOString(), unreadCount: 1 },
  { id: 'conv-2', participantName: 'Sarah Kim', participantInitials: 'SK', participantAvatarUrl: null, lastMessage: 'Thanks for the tip!', lastMessageAt: new Date(Date.now() - 60 * 60_000).toISOString(), unreadCount: 0 },
  { id: 'conv-3', participantName: 'Jane D.', participantInitials: 'JD', participantAvatarUrl: null, lastMessage: 'Draft is confirmed for Sat', lastMessageAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), unreadCount: 2 },
];

const mockMessages: DirectMessage[] = [
  { id: 'dm-1', senderId: 'u-2', senderName: 'Mike Thompson', content: "Hey, want to trade picks? I've got #3 overall.", createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), isOwn: false, delivered: true, read: true },
  { id: 'dm-2', senderId: 'u-1', senderName: 'You', content: 'What are you looking for?', createdAt: new Date(Date.now() - 4 * 60_000).toISOString(), isOwn: true, delivered: true, read: true },
  { id: 'dm-3', senderId: 'u-2', senderName: 'Mike Thompson', content: 'Ideally a 2nd round pick + a bench player', createdAt: new Date(Date.now() - 3 * 60_000).toISOString(), isOwn: false, delivered: true, read: false },
];

export function useConversations() {
  return useQuery({
    queryKey: socialKeys.conversations(),
    queryFn: async (): Promise<Conversation[]> => {
      // TODO: return api.get('/api/messages/conversations');
      await new Promise((r) => setTimeout(r, 200));
      return mockConversations;
    },
  });
}

export function useConversationMessages(conversationId: string) {
  return useQuery({
    queryKey: socialKeys.conversation(conversationId),
    queryFn: async (): Promise<DirectMessage[]> => {
      // TODO: return api.get(`/api/messages/conversations/${conversationId}?limit=30`);
      await new Promise((r) => setTimeout(r, 200));
      return mockMessages;
    },
  });
}

export function useSendDirectMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_content: string) => {
      // TODO: return api.post(`/api/messages/conversations/${conversationId}`, { content });
      await new Promise((r) => setTimeout(r, 100));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.conversation(conversationId) });
      qc.invalidateQueries({ queryKey: socialKeys.conversations() });
    },
  });
}

export function useMarkConversationRead(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // TODO: return api.patch(`/api/messages/conversations/${conversationId}/read`);
      await new Promise((r) => setTimeout(r, 50));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.conversations() });
    },
  });
}
