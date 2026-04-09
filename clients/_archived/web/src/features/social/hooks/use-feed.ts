import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { client, getLeagueFeed, createFeedPost, deleteFeedPost, addFeedReaction, pinFeedPost, unpinFeedPost, addFeedReply, getFeedPost } from '@/lib/api';
import { socialKeys } from './query-keys';
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth-store';
import { FeedPostResponseSchema, type FeedItemDto, type FeedResponse } from '@poolmaster/shared/dto';
import { z } from 'zod';

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

type FeedPostResponse = z.infer<typeof FeedPostResponseSchema>;

interface FeedPage {
  items: FeedPost[];
  pinned: FeedPost[];
  nextCursor: string | null;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function mapPostType(type: string): PostType {
  if (type === 'SYSTEM') return 'event';
  if (type === 'ANNOUNCEMENT') return 'announcement';
  return 'post';
}

function mapReactions(
  reactions: Record<string, string[]>,
  currentUserId: string | null,
): Reaction[] {
  return Object.entries(reactions).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    reacted: currentUserId ? userIds.includes(currentUserId) : false,
  }));
}

function mapFeedItem(post: FeedItemDto, currentUserId: string | null): FeedPost {
  return {
    id: post.id,
    type: mapPostType(post.type),
    authorId: post.authorId,
    authorName: post.authorName,
    authorInitials: getInitials(post.authorName),
    authorAvatarUrl: null,
    content: post.content,
    createdAt: post.createdAt,
    pinned: post.isPinned,
    pinnedBy: null,
    reactions: mapReactions(post.reactions, currentUserId),
    replyCount: post.replyCount,
    poll: null,
  };
}

export function useFeed(leagueId: string) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  return useInfiniteQuery({
    queryKey: socialKeys.feed(leagueId),
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const query: Record<string, string> = { limit: '20' };
      if (pageParam) query.cursor = pageParam;
      const { data, error } = await getLeagueFeed({ client, path: { leagueId }, query });
      if (error) throw error;
      const payload = data as FeedResponse;
      const posts = (payload.posts ?? []).map((post) => mapFeedItem(post, currentUserId));
      return {
        items: posts.filter((post) => !post.pinned),
        pinned: posts.filter((post) => post.pinned),
        nextCursor: payload.nextCursor ?? null,
      };
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
}

export function useCreatePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { content: string }) => {
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

export function useReplies(postId: string, leagueId: string, enabled: boolean) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: [...socialKeys.replies(postId), leagueId],
    queryFn: async (): Promise<FeedReply[]> => {
      const { data, error } = await getFeedPost({
        client,
        path: { leagueId, postId },
      });
      if (error) throw error;
      const post = FeedPostResponseSchema.parse(data);
      return (post.replies ?? []).map((reply: FeedPostResponse) => ({
        id: reply.id,
        authorName: reply.authorName,
        authorInitials: getInitials(reply.authorName),
        content: reply.content,
        createdAt: reply.createdAt,
        reactions: mapReactions(reply.reactions, currentUserId),
      }));
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
