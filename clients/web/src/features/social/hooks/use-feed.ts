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

const mockFeedItems: FeedPost[] = [
  {
    id: 'p-1', type: 'post', authorId: 'u-2', authorName: 'Mike T.', authorInitials: 'MT', authorAvatarUrl: null,
    content: '@Jane is Mahomes really available? No way he lasts to round 3.',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), pinned: false, pinnedBy: null,
    reactions: [{ emoji: '👍', count: 3, reacted: false }, { emoji: '😂', count: 1, reacted: true }],
    replyCount: 4, poll: null,
  },
  {
    id: 'p-2', type: 'event', authorId: 'system', authorName: 'System', authorInitials: 'PM', authorAvatarUrl: null,
    content: 'Draft Pick: John drafted Patrick Mahomes in NFL Survivor Pool',
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(), pinned: false, pinnedBy: null,
    reactions: [], replyCount: 0, poll: null,
  },
  {
    id: 'p-3', type: 'poll', authorId: 'u-3', authorName: 'Sarah K.', authorInitials: 'SK', authorAvatarUrl: null,
    content: 'Who else is nervous about their picks?',
    createdAt: new Date(Date.now() - 60 * 60_000).toISOString(), pinned: false, pinnedBy: null,
    reactions: [{ emoji: '👍', count: 2, reacted: false }],
    replyCount: 2,
    poll: {
      question: 'How confident are you?',
      options: [
        { id: 'o1', text: 'Very', votes: 9 },
        { id: 'o2', text: 'Kinda', votes: 6 },
        { id: 'o3', text: 'Nope', votes: 5 },
      ],
      totalVotes: 20, expiresAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString(), userVoted: null,
    },
  },
];

const mockPinnedPost: FeedPost = {
  id: 'p-0', type: 'announcement', authorId: 'u-1', authorName: 'Jane D.', authorInitials: 'JD', authorAvatarUrl: null,
  content: 'Reminder: Draft is this Saturday at 3pm ET. Don\'t forget to rank your players!',
  createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(), pinned: true, pinnedBy: 'Jane D.',
  reactions: [{ emoji: '👍', count: 5, reacted: false }, { emoji: '🔥', count: 2, reacted: false }],
  replyCount: 0, poll: null,
};

export function useFeed(leagueId: string) {
  return useInfiniteQuery({
    queryKey: socialKeys.feed(leagueId),
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      // TODO: return api.get(`/api/leagues/${leagueId}/feed?cursor=${pageParam}&limit=20`);
      await new Promise((r) => setTimeout(r, 300));
      return { items: mockFeedItems, pinned: [mockPinnedPost], nextCursor: null };
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
}

export function useCreatePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_data: { content: string; poll?: { question: string; options: string[]; expiresIn: string } }) => {
      // TODO: return api.post(`/api/leagues/${leagueId}/feed`, data);
      await new Promise((r) => setTimeout(r, 200));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useToggleReaction(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_data: { postId: string; emoji: string }) => {
      // TODO: return api.post(`/api/feed/${data.postId}/reactions`, { emoji: data.emoji });
      await new Promise((r) => setTimeout(r, 100));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function usePinPost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_data: { postId: string; pin: boolean }) => {
      // TODO: return api.patch(`/api/feed/${data.postId}/pin`, { pinned: data.pin });
      await new Promise((r) => setTimeout(r, 100));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}

export function useDeletePost(leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_postId: string) => {
      // TODO: return api.delete(`/api/feed/${postId}`);
      await new Promise((r) => setTimeout(r, 100));
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
      // TODO: return api.get(`/api/feed/${postId}/replies?limit=10`);
      await new Promise((r) => setTimeout(r, 200));
      return [
        { id: 'r1', authorName: 'John D.', authorInitials: 'JD', content: 'No chance!', createdAt: new Date(Date.now() - 3 * 60_000).toISOString(), reactions: [] },
        { id: 'r2', authorName: 'Sarah K.', authorInitials: 'SK', content: 'I think round 4 at best', createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), reactions: [] },
      ];
    },
    enabled,
  });
}

export function useCreateReply(postId: string, leagueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_content: string) => {
      // TODO: return api.post(`/api/feed/${postId}/replies`, { content });
      await new Promise((r) => setTimeout(r, 150));
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
    mutationFn: async (_data: { postId: string; optionId: string }) => {
      // TODO: return api.post(`/api/feed/${data.postId}/vote`, { optionId: data.optionId });
      await new Promise((r) => setTimeout(r, 150));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: socialKeys.feed(leagueId) }); },
  });
}
