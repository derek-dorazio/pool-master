import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { client, typedData } from '@/lib/api-client-generated';
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
      const result = await client.GET('/api/v1/leagues/{leagueId}/feed', {
        params: { path: { leagueId }, query },
      });
      return typedData<FeedPage>(result);
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
      const result: any = await client.POST('/api/v1/leagues/{leagueId}/feed', {
        params: { path: { leagueId } },
        body: { content: data.content } as never,
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useToggleReaction(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; emoji: string }) => {
      const result: any = await client.POST('/api/v1/leagues/{leagueId}/feed/{postId}/reactions', {
        params: { path: { leagueId, postId: data.postId } },
        body: { emoji: data.emoji },
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function usePinPost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { postId: string; pin: boolean }) => {
      if (data.pin) {
        const result: any = await client.POST('/api/v1/leagues/{leagueId}/feed/{postId}/pin', {
          params: { path: { leagueId, postId: data.postId } },
        });
        if (result.error) throw result.error;
        if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
      } else {
        const result: any = await client.DELETE('/api/v1/leagues/{leagueId}/feed/{postId}/pin', {
          params: { path: { leagueId, postId: data.postId } },
        });
        if (result.error) throw result.error;
        if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useDeletePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const result: any = await client.DELETE('/api/v1/leagues/{leagueId}/feed/{postId}', {
        params: { path: { leagueId, postId } },
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
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
      // TODO: migrate to generated client when backend adds GET replies to OpenAPI spec
      return await api.get<FeedReply[]>(`/v1/social/feed/${postId}/replies?limit=10`);
    },
    enabled,
  });
}

export function useCreateReply(postId: string, leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const result: any = await client.POST('/api/v1/leagues/{leagueId}/feed/{postId}/replies', {
        params: { path: { leagueId, postId } },
        body: { content },
      });
      if (result.error) throw result.error;
      if (!result.response.ok) throw new Error(`Request failed: ${result.response.status}`);
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
    // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
    mutationFn: async (data: { postId: string; optionId: string }) => {
      return await api.post(`/v1/social/feed/${data.postId}/vote`, { optionId: data.optionId });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}
