/**
 * FeedService — in-memory league activity feed backend.
 *
 * Manages feed posts, replies, reactions, and pinning for the
 * social communication layer (Plan 10 Phase 1).
 */

import crypto from 'node:crypto';

// --- Types ---

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

// --- Storage ---

const posts: Map<string, FeedPost> = new Map();
const leagueIndex: Map<string, string[]> = new Map();
const replyIndex: Map<string, string[]> = new Map();

// --- Seed Data ---

function ensureSeeded(leagueId: string): void {
  const existing = leagueIndex.get(leagueId);
  if (existing && existing.length > 0) return;

  const seedPosts: Omit<FeedPost, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      leagueId,
      authorId: 'SYSTEM',
      authorName: 'PoolMaster',
      content: 'Welcome to the league! This is your activity feed where you can post updates, share reactions, and stay connected with your league members.',
      type: 'SYSTEM',
      isPinned: true,
      reactions: { '👍': [] },
      replyCount: 0,
    },
    {
      leagueId,
      authorId: 'SYSTEM',
      authorName: 'PoolMaster',
      content: 'The season is about to begin. Good luck to all participants!',
      type: 'ANNOUNCEMENT',
      isPinned: false,
      reactions: { '🔥': [] },
      replyCount: 0,
    },
  ];

  const ids: string[] = [];
  const now = new Date();

  for (let i = 0; i < seedPosts.length; i++) {
    const id = crypto.randomUUID();
    const post: FeedPost = {
      ...seedPosts[i],
      id,
      createdAt: new Date(now.getTime() - (seedPosts.length - i) * 60_000),
      updatedAt: new Date(now.getTime() - (seedPosts.length - i) * 60_000),
    };
    posts.set(id, post);
    ids.push(id);
  }

  leagueIndex.set(leagueId, ids);
}

// --- Service ---

export class FeedService {
  /** Create a post in a league feed. */
  async createPost(
    leagueId: string,
    authorId: string,
    content: string,
    type: 'POST' | 'ANNOUNCEMENT' | 'SYSTEM' = 'POST',
  ): Promise<FeedPost> {
    ensureSeeded(leagueId);

    const id = crypto.randomUUID();
    const now = new Date();

    const post: FeedPost = {
      id,
      leagueId,
      authorId,
      authorName: `User_${authorId.slice(0, 6)}`,
      content,
      type,
      isPinned: false,
      reactions: {},
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    posts.set(id, post);
    const ids = leagueIndex.get(leagueId) ?? [];
    ids.push(id);
    leagueIndex.set(leagueId, ids);

    return post;
  }

  /** Get feed for a league with cursor-based pagination (newest first). */
  async getFeed(
    leagueId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ posts: FeedPost[]; nextCursor?: string }> {
    ensureSeeded(leagueId);

    const ids = leagueIndex.get(leagueId) ?? [];

    // Collect top-level posts (no parentId), newest first
    const topLevel = ids
      .map((id) => posts.get(id)!)
      .filter((p) => !p.parentId)
      .sort((a, b) => {
        // Pinned posts first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    // Apply cursor
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = topLevel.findIndex((p) => p.id === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = topLevel.slice(startIndex, startIndex + limit);
    const nextCursor = page.length === limit && startIndex + limit < topLevel.length
      ? page[page.length - 1].id
      : undefined;

    return { posts: page, nextCursor };
  }

  /** Get a single post with its replies. */
  async getPost(postId: string): Promise<FeedPost> {
    const post = posts.get(postId);
    if (!post) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    const replyIds = replyIndex.get(postId) ?? [];
    const replies = replyIds
      .map((id) => posts.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return { ...post, replies };
  }

  /** Create a reply to a post. */
  async createReply(
    postId: string,
    authorId: string,
    content: string,
  ): Promise<FeedPost> {
    const parent = posts.get(postId);
    if (!parent) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    const reply: FeedPost = {
      id,
      leagueId: parent.leagueId,
      authorId,
      authorName: `User_${authorId.slice(0, 6)}`,
      content,
      type: 'POST',
      isPinned: false,
      reactions: {},
      replyCount: 0,
      parentId: postId,
      createdAt: now,
      updatedAt: now,
    };

    posts.set(id, reply);

    // Update parent reply count
    parent.replyCount += 1;
    parent.updatedAt = now;
    posts.set(postId, parent);

    // Update reply index
    const replyIds = replyIndex.get(postId) ?? [];
    replyIds.push(id);
    replyIndex.set(postId, replyIds);

    // Add to league index
    const leagueIds = leagueIndex.get(parent.leagueId) ?? [];
    leagueIds.push(id);
    leagueIndex.set(parent.leagueId, leagueIds);

    return reply;
  }

  /** Toggle a reaction on a post. Returns whether the reaction was added or removed. */
  async toggleReaction(
    postId: string,
    userId: string,
    emoji: string,
  ): Promise<{ added: boolean }> {
    const post = posts.get(postId);
    if (!post) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    const userIds = post.reactions[emoji] ?? [];
    const existingIndex = userIds.indexOf(userId);

    if (existingIndex !== -1) {
      userIds.splice(existingIndex, 1);
      if (userIds.length === 0) {
        delete post.reactions[emoji];
      } else {
        post.reactions[emoji] = userIds;
      }
      post.updatedAt = new Date();
      posts.set(postId, post);
      return { added: false };
    }

    post.reactions[emoji] = [...userIds, userId];
    post.updatedAt = new Date();
    posts.set(postId, post);
    return { added: true };
  }

  /** Pin a post (commissioner only). */
  async pinPost(postId: string): Promise<void> {
    const post = posts.get(postId);
    if (!post) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    post.isPinned = true;
    post.updatedAt = new Date();
    posts.set(postId, post);
  }

  /** Unpin a post. */
  async unpinPost(postId: string): Promise<void> {
    const post = posts.get(postId);
    if (!post) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    post.isPinned = false;
    post.updatedAt = new Date();
    posts.set(postId, post);
  }

  /** Delete a post. */
  async deletePost(postId: string): Promise<void> {
    const post = posts.get(postId);
    if (!post) {
      throw new FeedError('POST_NOT_FOUND', `Post ${postId} not found`, 404);
    }

    // Remove from league index
    const leagueIds = leagueIndex.get(post.leagueId);
    if (leagueIds) {
      const filtered = leagueIds.filter((id) => id !== postId);
      leagueIndex.set(post.leagueId, filtered);
    }

    // Remove replies
    const replyIds = replyIndex.get(postId) ?? [];
    for (const replyId of replyIds) {
      posts.delete(replyId);
      const leaguePostIds = leagueIndex.get(post.leagueId);
      if (leaguePostIds) {
        leagueIndex.set(post.leagueId, leaguePostIds.filter((id) => id !== replyId));
      }
    }
    replyIndex.delete(postId);

    // If this is a reply, decrement parent reply count
    if (post.parentId) {
      const parent = posts.get(post.parentId);
      if (parent) {
        parent.replyCount = Math.max(0, parent.replyCount - 1);
        parent.updatedAt = new Date();
        posts.set(post.parentId, parent);
      }
      const parentReplyIds = replyIndex.get(post.parentId);
      if (parentReplyIds) {
        replyIndex.set(post.parentId, parentReplyIds.filter((id) => id !== postId));
      }
    }

    posts.delete(postId);
  }
}

// --- Error ---

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
