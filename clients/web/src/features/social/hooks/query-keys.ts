export const socialKeys = {
  feed: (leagueId: string) => ['leagues', leagueId, 'feed'] as const,
  replies: (postId: string) => ['feed', postId, 'replies'] as const,
  chat: (contestId: string) => ['contests', contestId, 'chat'] as const,
  conversations: () => ['messages', 'conversations'] as const,
  conversation: (id: string) => ['messages', 'conversations', id] as const,
  share: (shareId: string) => ['shares', shareId] as const,
  recap: (leagueId: string, weekId: string) => ['leagues', leagueId, 'recap', weekId] as const,
};
