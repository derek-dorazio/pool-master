import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { client, getLeagueFeed, createFeedPost, deleteFeedPost, addFeedReaction, pinFeedPost, unpinFeedPost, addFeedReply } from '@/lib/api';
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
      const query: Record<string, string> = { limit: '20' };
      if (pageParam) query.cursor = pageParam;
      const { data, error } = await getLeagueFeed({ client, path: { leagueId }, query });
      if (error) throw error;
      return data as unknown as FeedPage;
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
      const { error } = await createFeedPost({ client, path: { leagueId }, body: { content: data.content } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useToggleReaction(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; emoji: string }) => {
      const { error } = await addFeedReaction({ client, path: { leagueId, postId: data.postId }, body: { emoji: data.emoji } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function usePinPost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; pin: boolean }) => {
      if (data.pin) {
        const { error } = await pinFeedPost({ client, path: { leagueId, postId: data.postId } });
        if (error) throw error;
      } else {
        const { error } = await unpinFeedPost({ client, path: { leagueId, postId: data.postId } });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useDeletePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await deleteFeedPost({ client, path: { leagueId, postId } });
      if (error) throw error;
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
      const { data, error } = await client.get<FeedReply[]>({
        url: '/api/v1/social/feed/{postId}/replies',
        path: { postId },
        query: { limit: '10' },
      });
      if (error) throw error;
      return data as FeedReply[];
    },
    enabled,
  });
}

export function useCreateReply(postId: string, leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { error } = await addFeedReply({ client, path: { leagueId, postId }, body: { content } });
      if (error) throw error;
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
      const { data: result, error } = await client.post({
        url: '/api/v1/social/feed/{postId}/vote',
        path: { postId: data.postId },
        body: { optionId: data.optionId },
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
      return result;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}
