import { useQuery } from '@tanstack/react-query';
import { client, getLeagueFeed, listLeagues } from '@/lib/api';
import type { FeedResponse, LeagueListResponse, LeagueSummaryDto } from '@poolmaster/shared/dto';

export type ActivityType =
  | 'score_update'
  | 'draft_pick'
  | 'announcement'
  | 'contest_completed'
  | 'member_joined';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  description: string;
  relativeTime: string;
  linkTo?: string;
}

function formatRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function mapFeedTypeToActivityType(type: string): ActivityType {
  if (type === 'ANNOUNCEMENT' || type === 'SYSTEM') return 'announcement';
  return 'announcement';
}

function truncateContent(content: string, maxLength = 120): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength - 1).trimEnd()}…`;
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data: leaguesData, error: leaguesError } = await listLeagues({ client });
      if (leaguesError) throw leaguesError;

      const leagues = (leaguesData as LeagueListResponse | undefined)?.leagues ?? [];
      const feedResponses = await Promise.all(
        leagues.map(async (league: LeagueSummaryDto) => {
          const { data, error } = await getLeagueFeed({
            client,
            path: { leagueId: league.id },
            query: { limit: '5' },
          });
          if (error) throw error;

          return {
            league,
            posts: (((data as FeedResponse | undefined)?.posts) ?? []).map((post) => ({
              ...post,
              leagueName: league.name,
            })),
          };
        }),
      );

      return feedResponses
        .flatMap(({ league, posts }) =>
          posts.map((post) => ({
            id: post.id,
            type: mapFeedTypeToActivityType(post.type),
            description:
              post.type === 'SYSTEM'
                ? truncateContent(post.content)
                : `${post.authorName}: ${truncateContent(post.content)}`,
            relativeTime: formatRelativeTime(post.createdAt),
            linkTo: `/leagues/${league.id}/feed`,
            createdAt: post.createdAt,
          })),
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5)
        .map(({ createdAt: _createdAt, ...item }) => item);
    },
  });
}
