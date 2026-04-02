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

export function useConversations() {
  return useQuery({
    queryKey: socialKeys.conversations(),
    queryFn: async (): Promise<Conversation[]> => {
      // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
      return await api.get<Conversation[]>('/v1/social/messages/conversations');
    },
  });
}

export function useConversationMessages(conversationId: string) {
  return useQuery({
    queryKey: socialKeys.conversation(conversationId),
    queryFn: async (): Promise<DirectMessage[]> => {
      // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
      return await api.get<DirectMessage[]>(`/v1/social/messages/conversations/${conversationId}?limit=30`);
    },
  });
}

export function useSendDirectMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
      return await api.post(`/v1/social/messages/conversations/${conversationId}`, { content });
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
      // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
      return await api.patch(`/v1/social/messages/conversations/${conversationId}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.conversations() });
    },
  });
}
