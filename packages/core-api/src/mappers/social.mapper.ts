import type { FeedPost } from '../modules/social/feed-service';

function mapFeedPostSummary(post: FeedPost) {
  return {
    id: post.id,
    leagueId: post.leagueId,
    authorId: post.authorId,
    type: post.type,
    authorName: post.authorName,
    content: post.content,
    isPinned: post.isPinned,
    reactions: post.reactions,
    replyCount: post.replyCount,
    parentId: post.parentId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function mapFeedPageToDto(page: { posts: FeedPost[]; nextCursor?: string }) {
  return {
    posts: page.posts.map(mapFeedPostSummary),
    nextCursor: page.nextCursor,
  };
}

export function mapFeedPostToDto(post: FeedPost): Record<string, unknown> {
  return {
    ...mapFeedPostSummary(post),
    replies: post.replies?.map(mapFeedPostToDto),
  };
}
