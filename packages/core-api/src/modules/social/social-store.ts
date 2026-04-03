import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatMessageDto, ConversationDto, DirectMessageDto, RecapDto, ShareCardDto } from '@poolmaster/shared/dto/social.dto';

export interface StoredDirectMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  isOwn: boolean;
  delivered: boolean;
  read: boolean;
}

export interface StoredChatMessage {
  id: string;
  type: 'user' | 'system';
  authorName: string;
  authorInitials: string;
  content: string;
  createdAt: string;
  isOwn: boolean;
}

export interface StoredFeedPost {
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
}

interface StoredConversation {
  id: string;
  participantName: string;
  participantInitials: string;
  participantAvatarUrl: string | null;
  messages: StoredDirectMessage[];
}

interface StoredChatThread {
  contestId: string;
  messages: StoredChatMessage[];
}

interface SocialStoreSnapshot {
  feedPosts: Record<string, StoredFeedPost>;
  feedLeagueIndex: Record<string, string[]>;
  feedReplyIndex: Record<string, string[]>;
  conversationsByUser: Record<string, Record<string, StoredConversation>>;
  chatThreads: Record<string, StoredChatThread>;
  shareCards: Record<string, ShareCardDto>;
  recaps: Record<string, RecapDto>;
}

function createEmptySnapshot(): SocialStoreSnapshot {
  return {
    feedPosts: {},
    feedLeagueIndex: {},
    feedReplyIndex: {},
    conversationsByUser: {},
    chatThreads: {},
    shareCards: {},
    recaps: {},
  };
}

function defaultStorePath(): string {
  return join(tmpdir(), `poolmaster-social-${process.pid}-${crypto.randomUUID()}.json`);
}

function toIsoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toConversationDto(conversation: StoredConversation): ConversationDto {
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    participantName: conversation.participantName,
    participantInitials: conversation.participantInitials,
    participantAvatarUrl: conversation.participantAvatarUrl,
    lastMessage: lastMessage.content,
    lastMessageAt: lastMessage.createdAt,
    unreadCount: conversation.messages.filter((message) => !message.isOwn && !message.read).length,
  };
}

function toDirectMessageDto(message: StoredDirectMessage): DirectMessageDto {
  return {
    ...message,
  };
}

function toChatMessageDto(message: StoredChatMessage): ChatMessageDto {
  return {
    ...message,
  };
}

function parseSnapshot(raw: string): SocialStoreSnapshot {
  const parsed = JSON.parse(raw) as Partial<SocialStoreSnapshot>;
  const snapshot = createEmptySnapshot();

  return {
    feedPosts: parsed.feedPosts ?? snapshot.feedPosts,
    feedLeagueIndex: parsed.feedLeagueIndex ?? snapshot.feedLeagueIndex,
    feedReplyIndex: parsed.feedReplyIndex ?? snapshot.feedReplyIndex,
    conversationsByUser: parsed.conversationsByUser ?? snapshot.conversationsByUser,
    chatThreads: parsed.chatThreads ?? snapshot.chatThreads,
    shareCards: parsed.shareCards ?? snapshot.shareCards,
    recaps: parsed.recaps ?? snapshot.recaps,
  };
}

export class SocialStore {
  private readonly filePath: string;

  private state: SocialStoreSnapshot;

  constructor(filePath: string = defaultStorePath()) {
    this.filePath = filePath;
    this.state = this.load();
  }

  listFeedPosts(leagueId: string): StoredFeedPost[] {
    const ids = this.state.feedLeagueIndex[leagueId] ?? [];
    const posts = ids
      .map((id) => this.state.feedPosts[id])
      .filter((post): post is StoredFeedPost => Boolean(post) && !post.parentId);

    return posts.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  getFeedPost(postId: string): StoredFeedPost | null {
    return this.state.feedPosts[postId] ?? null;
  }

  getFeedReplies(postId: string): StoredFeedPost[] {
    const ids = this.state.feedReplyIndex[postId] ?? [];
    return ids
      .map((id) => this.state.feedPosts[id])
      .filter((post): post is StoredFeedPost => Boolean(post))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  createFeedPost(post: Omit<StoredFeedPost, 'id' | 'createdAt' | 'updatedAt' | 'replyCount' | 'isPinned' | 'reactions'>): StoredFeedPost {
    const now = new Date().toISOString();
    const stored: StoredFeedPost = {
      ...post,
      id: crypto.randomUUID(),
      isPinned: false,
      reactions: {},
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.state.feedPosts[stored.id] = stored;
    this.appendToLeagueIndex(stored.leagueId, stored.id);
    this.persist();
    return stored;
  }

  createFeedReply(postId: string, reply: Omit<StoredFeedPost, 'id' | 'createdAt' | 'updatedAt' | 'replyCount' | 'isPinned' | 'reactions' | 'leagueId' | 'parentId'>): StoredFeedPost {
    const parent = this.state.feedPosts[postId];
    if (!parent) {
      throw new Error(`Post ${postId} not found`);
    }

    const now = new Date().toISOString();
    const stored: StoredFeedPost = {
      ...reply,
      leagueId: parent.leagueId,
      parentId: postId,
      id: crypto.randomUUID(),
      isPinned: false,
      reactions: {},
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.state.feedPosts[stored.id] = stored;
    this.state.feedReplyIndex[postId] = [...(this.state.feedReplyIndex[postId] ?? []), stored.id];
    this.appendToLeagueIndex(parent.leagueId, stored.id);

    parent.replyCount += 1;
    parent.updatedAt = now;
    this.state.feedPosts[postId] = parent;

    this.persist();
    return stored;
  }

  updateFeedPost(postId: string, updater: (post: StoredFeedPost) => StoredFeedPost): StoredFeedPost | null {
    const existing = this.state.feedPosts[postId];
    if (!existing) {
      return null;
    }

    const updated = updater({ ...existing });
    this.state.feedPosts[postId] = updated;
    this.persist();
    return updated;
  }

  deleteFeedPost(postId: string): boolean {
    const post = this.state.feedPosts[postId];
    if (!post) {
      return false;
    }

    this.removeFeedPostTree(postId);
    this.persist();
    return true;
  }

  listConversations(userId: string): ConversationDto[] {
    const conversations = Object.values(this.state.conversationsByUser[userId] ?? {});
    return conversations
      .filter((conversation) => conversation.messages.length > 0)
      .map(toConversationDto)
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }

  getConversation(userId: string, conversationId: string): StoredConversation | null {
    return this.state.conversationsByUser[userId]?.[conversationId] ?? null;
  }

  upsertConversation(
    userId: string,
    conversation: {
      id: string;
      participantName: string;
      participantInitials: string;
      participantAvatarUrl: string | null;
      messages: StoredDirectMessage[];
    },
  ): ConversationDto {
    const userConversations = { ...(this.state.conversationsByUser[userId] ?? {}) };
    userConversations[conversation.id] = {
      ...conversation,
      messages: conversation.messages.map((message) => ({ ...message, createdAt: toIsoDate(message.createdAt) })),
    };
    this.state.conversationsByUser[userId] = userConversations;
    this.persist();
    return toConversationDto(userConversations[conversation.id]);
  }

  appendConversationMessage(userId: string, conversationId: string, message: StoredDirectMessage): StoredDirectMessage {
    const conversation = this.state.conversationsByUser[userId]?.[conversationId];
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    conversation.messages = [...conversation.messages, { ...message, createdAt: toIsoDate(message.createdAt) }];
    this.state.conversationsByUser[userId][conversationId] = conversation;
    this.persist();
    return message;
  }

  markConversationRead(userId: string, conversationId: string): boolean {
    const conversation = this.state.conversationsByUser[userId]?.[conversationId];
    if (!conversation) {
      return false;
    }

    conversation.messages = conversation.messages.map((message) => {
      if (message.isOwn) {
        return message;
      }
      return { ...message, read: true };
    });

    this.state.conversationsByUser[userId][conversationId] = conversation;
    this.persist();
    return true;
  }

  getContestChat(contestId: string): StoredChatThread | null {
    return this.state.chatThreads[contestId] ?? null;
  }

  upsertContestChat(contestId: string, messages: StoredChatMessage[]): void {
    this.state.chatThreads[contestId] = {
      contestId,
      messages: messages.map((message) => ({ ...message, createdAt: toIsoDate(message.createdAt) })),
    };
    this.persist();
  }

  appendContestChatMessage(contestId: string, message: StoredChatMessage): StoredChatMessage {
    const thread = this.state.chatThreads[contestId] ?? { contestId, messages: [] };
    const storedMessage = { ...message, createdAt: toIsoDate(message.createdAt) };
    thread.messages = [...thread.messages, storedMessage];
    this.state.chatThreads[contestId] = thread;
    this.persist();
    return message;
  }

  getShareCard(shareId: string): ShareCardDto | null {
    return this.state.shareCards[shareId] ?? null;
  }

  upsertShareCard(shareCard: ShareCardDto): void {
    this.state.shareCards[shareCard.id] = shareCard;
    this.persist();
  }

  getRecap(leagueId: string, weekId: string): RecapDto | null {
    return this.state.recaps[this.recapKey(leagueId, weekId)] ?? null;
  }

  upsertRecap(leagueId: string, weekId: string, recap: RecapDto): void {
    this.state.recaps[this.recapKey(leagueId, weekId)] = recap;
    this.persist();
  }

  private recapKey(leagueId: string, weekId: string): string {
    return `${leagueId}:${weekId}`;
  }

  private appendToLeagueIndex(leagueId: string, postId: string): void {
    this.state.feedLeagueIndex[leagueId] = [...(this.state.feedLeagueIndex[leagueId] ?? []), postId];
  }

  private removeFeedPostTree(postId: string): void {
    const post = this.state.feedPosts[postId];
    if (!post) {
      return;
    }

    for (const replyId of this.state.feedReplyIndex[postId] ?? []) {
      this.removeFeedPostTree(replyId);
    }

    delete this.state.feedReplyIndex[postId];
    delete this.state.feedPosts[postId];

    const leagueIds = this.state.feedLeagueIndex[post.leagueId] ?? [];
    this.state.feedLeagueIndex[post.leagueId] = leagueIds.filter((id) => id !== postId);

    if (post.parentId) {
      const parent = this.state.feedPosts[post.parentId];
      if (parent) {
        parent.replyCount = Math.max(0, parent.replyCount - 1);
        parent.updatedAt = new Date().toISOString();
        this.state.feedPosts[parent.id] = parent;
      }

      const parentReplyIds = this.state.feedReplyIndex[post.parentId] ?? [];
      this.state.feedReplyIndex[post.parentId] = parentReplyIds.filter((id) => id !== postId);
    }
  }

  private load(): SocialStoreSnapshot {
    if (!existsSync(this.filePath)) {
      return createEmptySnapshot();
    }

    const raw = readFileSync(this.filePath, 'utf8');
    return parseSnapshot(raw);
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}

export function mapStoredDirectMessage(message: StoredDirectMessage): DirectMessageDto {
  return toDirectMessageDto(message);
}

export function mapStoredChatMessage(message: StoredChatMessage): ChatMessageDto {
  return toChatMessageDto(message);
}
