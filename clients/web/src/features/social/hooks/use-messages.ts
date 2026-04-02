import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/api';
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

export function useConversations() {
  return useQuery({
    queryKey: socialKeys.conversations(),
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await client.get<Conversation[]>({
        url: '/api/v1/social/messages/conversations',
      });
      if (error) throw error;
      return data as Conversation[];
    },
  });
}

export function useConversationMessages(conversationId: string) {
  return useQuery({
    queryKey: socialKeys.conversation(conversationId),
    queryFn: async (): Promise<DirectMessage[]> => {
      const { data, error } = await client.get<DirectMessage[]>({
        url: '/api/v1/social/messages/conversations/{conversationId}',
        path: { conversationId },
        query: { limit: '30' },
      });
      if (error) throw error;
      return data as DirectMessage[];
    },
  });
}

export function useSendDirectMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { data, error } = await client.post({
        url: '/api/v1/social/messages/conversations/{conversationId}',
        path: { conversationId },
        body: { content },
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
      return data;
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
      const { data, error } = await client.patch({
        url: '/api/v1/social/messages/conversations/{conversationId}/read',
        path: { conversationId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.conversations() });
    },
  });
}
