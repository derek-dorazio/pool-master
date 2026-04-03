import crypto from 'node:crypto';
import type {
  ChatMessageDto,
  ConversationDto,
  DirectMessageDto,
  RecapDto,
  ShareCardDto,
} from '@poolmaster/shared/dto/social.dto';

export class SocialCommunicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'SocialCommunicationError';
  }
}

type DirectMessageRecord = Omit<DirectMessageDto, 'createdAt'> & { createdAt: Date };
type ChatMessageRecord = Omit<ChatMessageDto, 'createdAt'> & { createdAt: Date };

interface ConversationState {
  id: string;
  participantName: string;
  participantInitials: string;
  participantAvatarUrl: string | null;
  messages: DirectMessageRecord[];
}

interface ChatThreadState {
  contestId: string;
  messages: ChatMessageRecord[];
}

function toConversationDto(state: ConversationState): ConversationDto {
  const lastMessage = state.messages[state.messages.length - 1];
  return {
    id: state.id,
    participantName: state.participantName,
    participantInitials: state.participantInitials,
    participantAvatarUrl: state.participantAvatarUrl,
    lastMessage: lastMessage.content,
    lastMessageAt: lastMessage.createdAt.toISOString(),
    unreadCount: state.messages.filter((message) => !message.isOwn && !message.read).length,
  };
}

function toDirectMessageDto(message: DirectMessageRecord): DirectMessageDto {
  return {
    ...message,
    createdAt: message.createdAt.toISOString(),
  };
}

function toChatMessageDto(message: ChatMessageRecord): ChatMessageDto {
  return {
    ...message,
    createdAt: message.createdAt.toISOString(),
  };
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60_000);
}

export class SocialCommunicationService {
  private conversationsByUser = new Map<string, Map<string, ConversationState>>();

  private chatThreads = new Map<string, ChatThreadState>();

  private shareCards = new Map<string, ShareCardDto>();

  private recaps = new Map<string, RecapDto>();

  listConversations(userId: string): ConversationDto[] {
    const conversations = this.ensureConversations(userId);
    return Array.from(conversations.values())
      .map((conversation) => toConversationDto(conversation))
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }

  getConversationMessages(userId: string, conversationId: string): DirectMessageDto[] {
    const conversation = this.getConversationState(userId, conversationId);
    return conversation.messages.map(toDirectMessageDto);
  }

  sendDirectMessage(userId: string, conversationId: string, content: string): DirectMessageDto {
    if (!content.trim()) {
      throw new SocialCommunicationError('INVALID_CONTENT', 'Message content is required', 400);
    }

    const conversation = this.getConversationState(userId, conversationId);
    const now = new Date();
    const message: DirectMessageRecord = {
      id: crypto.randomUUID(),
      senderId: userId,
      senderName: 'You',
      content: content.trim(),
      isOwn: true,
      delivered: true,
      read: true,
      createdAt: now,
    };

    conversation.messages.push(message);
    return toDirectMessageDto(message);
  }

  markConversationRead(userId: string, conversationId: string): { success: true } {
    const conversation = this.getConversationState(userId, conversationId);
    for (const message of conversation.messages) {
      if (!message.isOwn) {
        message.read = true;
      }
    }

    return { success: true };
  }

  getContestChat(_userId: string, contestId: string): ChatMessageDto[] {
    const thread = this.ensureChatThread(contestId);
    return thread.messages.map(toChatMessageDto);
  }

  sendContestChatMessage(userId: string, contestId: string, content: string): ChatMessageDto {
    if (!content.trim()) {
      throw new SocialCommunicationError('INVALID_CONTENT', 'Message content is required', 400);
    }

    const thread = this.ensureChatThread(contestId);
    const message: ChatMessageRecord = {
      id: crypto.randomUUID(),
      type: 'user',
      authorName: 'You',
      authorInitials: initialsFor('You'),
      content: content.trim(),
      createdAt: new Date(),
      isOwn: true,
    };
    thread.messages.push(message);
    return toChatMessageDto(message);
  }

  getShareCard(shareId: string): ShareCardDto {
    const existing = this.shareCards.get(shareId);
    if (existing) return existing;

    if (shareId !== 'share-1') {
      throw new SocialCommunicationError('SHARE_NOT_FOUND', `Share ${shareId} not found`, 404);
    }

    const share: ShareCardDto = {
      id: shareId,
      type: 'contest_result',
      title: 'NFL Survivor Pool 2026',
      sport: 'NFL',
      sportIcon: 'football',
      winnerName: 'Mike Thompson',
      winnerAvatarUrl: null,
      winnerScore: '145 points',
      leaderboard: [
        { rank: 1, name: 'Mike Thompson', score: '145 pts' },
        { rank: 2, name: 'Sarah Kim', score: '132 pts' },
        { rank: 3, name: 'John Doe', score: '128 pts' },
      ],
      dateRange: 'Sep 7 - Jan 12, 2026',
      imageUrl: null,
      ogTitle: 'Mike won the NFL Survivor Pool!',
      ogDescription: 'Score: 145 pts - Can you beat it?',
    };

    this.shareCards.set(shareId, share);
    return share;
  }

  getRecap(leagueId: string, weekId: string): RecapDto {
    const key = `${leagueId}:${weekId}`;
    const existing = this.recaps.get(key);
    if (existing) return existing;

    const recap: RecapDto = {
      weekLabel: weekId === 'current' ? 'Current Week' : `Week ${weekId}`,
      standings: [
        { rank: 1, name: 'Mike T.', initials: 'MT', points: 145, change: 2 },
        { rank: 2, name: 'Sarah K.', initials: 'SK', points: 132, change: 0 },
        { rank: 3, name: 'John D.', initials: 'JD', points: 128, change: -1 },
      ],
      highlights: [
        { icon: '🔥', title: 'Highest Score', detail: 'Mike T. - 45 pts this week' },
        { icon: '📈', title: 'Biggest Mover', detail: 'Mike T. - up 2 spots' },
      ],
      upcoming: [
        { name: 'NBA Playoff Draft', dateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(), daysUntil: 2 },
      ],
    };

    this.recaps.set(key, recap);
    return recap;
  }

  private ensureConversations(userId: string): Map<string, ConversationState> {
    const existing = this.conversationsByUser.get(userId);
    if (existing) return existing;

    const conversations = new Map<string, ConversationState>();
    const now = new Date();

    const conversationSeeds: ConversationState[] = [
      {
        id: 'conv-1',
        participantName: 'Mike Thompson',
        participantInitials: 'MT',
        participantAvatarUrl: null,
        messages: [
          {
            id: crypto.randomUUID(),
            senderId: 'u-2',
            senderName: 'Mike Thompson',
            content: 'Hey, want to trade picks?',
            createdAt: hoursAgo(2),
            isOwn: false,
            delivered: true,
            read: false,
          },
          {
            id: crypto.randomUUID(),
            senderId: userId,
            senderName: 'You',
            content: 'What are you looking for?',
            createdAt: hoursAgo(1),
            isOwn: true,
            delivered: true,
            read: true,
          },
        ],
      },
      {
        id: 'conv-2',
        participantName: 'Sarah Kim',
        participantInitials: 'SK',
        participantAvatarUrl: null,
        messages: [
          {
            id: crypto.randomUUID(),
            senderId: 'u-3',
            senderName: 'Sarah Kim',
            content: 'Thanks for the tip!',
            createdAt: new Date(now.getTime() - 90 * 60_000),
            isOwn: false,
            delivered: true,
            read: true,
          },
        ],
      },
    ];

    for (const conversation of conversationSeeds) {
      conversations.set(conversation.id, conversation);
    }

    this.conversationsByUser.set(userId, conversations);
    return conversations;
  }

  private getConversationState(userId: string, conversationId: string): ConversationState {
    const conversations = this.ensureConversations(userId);
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      throw new SocialCommunicationError('CONVERSATION_NOT_FOUND', `Conversation ${conversationId} not found`, 404);
    }
    return conversation;
  }

  private ensureChatThread(contestId: string): ChatThreadState {
    const existing = this.chatThreads.get(contestId);
    if (existing) return existing;

    const thread: ChatThreadState = {
      contestId,
      messages: [
        {
          id: crypto.randomUUID(),
          type: 'system',
          authorName: 'System',
          authorInitials: '',
          content: 'Draft started',
          createdAt: hoursAgo(3),
          isOwn: false,
        },
        {
          id: crypto.randomUUID(),
          type: 'user',
          authorName: 'Mike',
          authorInitials: 'MT',
          content: 'Good luck all!',
          createdAt: hoursAgo(2),
          isOwn: false,
        },
        {
          id: crypto.randomUUID(),
          type: 'user',
          authorName: 'You',
          authorInitials: 'YO',
          content: "Let's do it!",
          createdAt: hoursAgo(1),
          isOwn: true,
        },
      ],
    };

    this.chatThreads.set(contestId, thread);
    return thread;
  }
}
