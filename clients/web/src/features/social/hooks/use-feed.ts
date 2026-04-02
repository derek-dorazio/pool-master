import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { socialKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';

export type PostType = 'post' | 'poll' | 'announcement' | 'event';

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface FeedPost {
  id: string;
  type: PostType;
  authorId: string;
  authorName: string;
  authorInitials: string;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string;
  pinned: boolean;
  pinnedBy: string | null;
  reactions: Reaction[];
  replyCount: number;
  poll: {
    question: string;
    options: PollOption[];
    totalVotes: number;
    expiresAt: string;
    userVoted: string | null;
  } | null;
}

export interface FeedReply {
  id: string;
  authorName: string;
  authorInitials: string;
  content: string;
  createdAt: string;
  reactions: Reaction[];
}

interface FeedPage {
  items: FeedPost[];
  pinned: FeedPost[];
  nextCursor: string | null;
}

export function useFeed(leagueId: string) {
  return useInfiniteQuery({
    queryKey: socialKeys.feed(leagueId),
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      // TODO: Add /v1/social/feed to API_ROUTES once backend endpoint exists
      const cursor = pageParam ? `&cursor=${pageParam}` : '';
      return await api.get<FeedPage>(`/v1/social/leagues/${leagueId}/feed?limit=20${cursor}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
}

export function useCreatePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { content: string; poll?: { question: string; options: string[]; expiresIn: string } }) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.post(`/v1/social/leagues/${leagueId}/feed`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useToggleReaction(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; emoji: string }) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.post(`/v1/social/feed/${data.postId}/reactions`, { emoji: data.emoji });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function usePinPost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; pin: boolean }) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.patch(`/v1/social/feed/${data.postId}/pin`, { pinned: data.pin });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useDeletePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.delete(`/v1/social/feed/${postId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) });
      toast({ title: 'Post deleted' });
    },
  });
}

export function useReplies(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: socialKeys.replies(postId),
    queryFn: async (): Promise<FeedReply[]> => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.get<FeedReply[]>(`/v1/social/feed/${postId}/replies?limit=10`);
    },
    enabled,
  });
}

export function useCreateReply(postId: string, leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.post(`/v1/social/feed/${postId}/replies`, { content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: socialKeys.replies(postId) });
      qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) });
    },
  });
}

export function useVotePoll(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; optionId: string }) => {
      // TODO: Add to API_ROUTES once backend endpoint exists
      return await api.post(`/v1/social/feed/${data.postId}/vote`, { optionId: data.optionId });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}
