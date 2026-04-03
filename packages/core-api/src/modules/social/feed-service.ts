import { SocialStore } from './social-store';

/**
 * FeedService — repository-backed league activity feed backend.
 *
 * Posts, replies, reactions, and pinning are persisted through the
 * social store rather than hidden in-memory module globals.
 */

export interface FeedPost {
  id: string;
  leagueId: string;
  authorId: string;
  authorName: string;
  content: string;
  type: 'POST' | 'ANNOUNCEMENT' | 'SYSTEM';
  isPinned: boolean;
  reactions: Record<string, string[]>;
  replyCount: number;
  replies?: FeedPost[];
  parentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class FeedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'FeedError';
  }
}

function toFeedPost(stored: {
  id: string;
  leagueId: string;
  authorId: string;
  authorName: string;
  content: string;
  type: 'POST' | 'ANNOUNCEMENT' | 'SYSTEM';
  isPinned: boolean;
  reactions: Record<string, string[]>;
  replyCount: number;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}): FeedPost {
  return {
    ...stored,
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  };
}

export class FeedService {
  constructor(private readonly store = new SocialStore()) {}

  /** Create a post in a league feed. */
  async createPost(
    leagueId: string,
    authorId: string,
    content: string,
    type: 'POST' | 'ANNOUNCEMENT' | 'SYSTEM' = 'POST',
  ): Promise<FeedPost> {
    if (!content.trim()) {
      throw new FeedError('INVALID_CONTENT', 'Content is required', 400);
    }

    const stored = this.store.createFeedPost({
      leagueId,
      authorId,
      authorName: `User_${authorId.slice(0, 6)}`,
      content: content.trim(),
      type,
    });

    return toFeedPost(stored);
  }

  /** Get feed for a league with cursor-based pagination (newest first). */
  async getFeed(
    leagueId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ posts: FeedPost[]; nextCursor?: string }> {
    const posts = this.store.listFeedPosts(leagueId).map(toFeedPost);

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = posts.findIndex((post) => post.id === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = posts.slice(startIndex, startIndex + limit);
    const nextCursor = page.length === limit && startIndex + limit < posts.length
      ? page[page.length - 1].id
      : undefined;

    return { posts: page, nextCursor };
  }

  /** Get a single post with its replies. */
  async getPost(postId: string): Promise<FeedPost> {
    const stored = this.store.getFeedPost(postId);
    if (!stored) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    const replies = this.store.getFeedReplies(postId).map(toFeedPost);
    return { ...toFeedPost(stored), replies };
  }

  /** Create a reply to a post. */
  async createReply(
    postId: string,
    authorId: string,
    content: string,
  ): Promise<FeedPost> {
    if (!content.trim()) {
      throw new FeedError('INVALID_CONTENT', 'Content is required', 400);
    }

    const parent = this.store.getFeedPost(postId);
    if (!parent) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    const stored = this.store.createFeedReply(postId, {
      authorId,
      authorName: `User_${authorId.slice(0, 6)}`,
      content: content.trim(),
      type: 'POST',
    });
    return toFeedPost(stored);
  }

  /** Toggle a reaction on a post. Returns whether the reaction was added or removed. */
  async toggleReaction(
    postId: string,
    userId: string,
    emoji: string,
  ): Promise<{ added: boolean }> {
    const normalizedEmoji = emoji.trim();
    if (!normalizedEmoji) {
      throw new FeedError('INVALID_EMOJI', 'Emoji is required', 400);
    }

    const updated = this.store.updateFeedPost(postId, (post) => {
      const userIds = post.reactions[normalizedEmoji] ?? [];
      const existingIndex = userIds.indexOf(userId);

      if (existingIndex !== -1) {
        const nextUserIds = userIds.filter((id) => id !== userId);
        if (nextUserIds.length === 0) {
          delete post.reactions[normalizedEmoji];
        } else {
          post.reactions[normalizedEmoji] = nextUserIds;
        }
        post.updatedAt = new Date().toISOString();
        return post;
      }

      post.reactions[normalizedEmoji] = [...userIds, userId];
      post.updatedAt = new Date().toISOString();
      return post;
    });

    if (!updated) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    const wasAdded = (updated.reactions[normalizedEmoji] ?? []).includes(userId);
    return { added: wasAdded };
  }

  /** Pin a post (commissioner only). */
  async pinPost(postId: string): Promise<void> {
    const updated = this.store.updateFeedPost(postId, (post) => {
      post.isPinned = true;
      post.updatedAt = new Date().toISOString();
      return post;
    });

    if (!updated) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }
  }

  /** Unpin a post. */
  async unpinPost(postId: string): Promise<void> {
    const updated = this.store.updateFeedPost(postId, (post) => {
      post.isPinned = false;
      post.updatedAt = new Date().toISOString();
      return post;
    });

    if (!updated) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }
  }

  /** Delete a post. */
  async deletePost(postId: string): Promise<void> {
    const deleted = this.store.deleteFeedPost(postId);
    if (!deleted) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }
  }
}
