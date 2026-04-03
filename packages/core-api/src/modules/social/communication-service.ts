import crypto from 'node:crypto';
import type {
  ChatMessageDto,
  ConversationDto,
  DirectMessageDto,
  RecapDto,
  ShareCardDto,
} from '@poolmaster/shared/dto/social.dto';
import { SocialStore, type StoredChatMessage, type StoredDirectMessage } from './social-store';

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

export interface ConversationSeed {
  id: string;
  participantName: string;
  participantInitials: string;
  participantAvatarUrl: string | null;
  messages?: Array<Omit<StoredDirectMessage, 'createdAt'> & { createdAt: Date }>;
}

export interface ChatThreadSeed {
  contestId: string;
  messages?: Array<Omit<StoredChatMessage, 'createdAt'> & { createdAt: Date }>;
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

function createDefaultShareCard(shareId: string): ShareCardDto {
  return {
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
}

function createDefaultRecap(weekId: string): RecapDto {
  return {
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
}

export class SocialCommunicationService {
  constructor(private readonly store = new SocialStore()) {}

  listConversations(userId: string): ConversationDto[] {
    return this.store.listConversations(userId);
  }

  getConversationMessages(userId: string, conversationId: string): DirectMessageDto[] {
    const conversation = this.store.getConversation(userId, conversationId);
    if (!conversation) {
      throw new SocialCommunicationError('CONVERSATION_NOT_FOUND', `Conversation ${conversationId} not found`, 404);
    }

    return conversation.messages.map(toDirectMessageDto);
  }

  sendDirectMessage(userId: string, conversationId: string, content: string): DirectMessageDto {
    if (!content.trim()) {
      throw new SocialCommunicationError('INVALID_CONTENT', 'Message content is required', 400);
    }

    const conversation = this.store.getConversation(userId, conversationId);
    if (!conversation) {
      throw new SocialCommunicationError('CONVERSATION_NOT_FOUND', `Conversation ${conversationId} not found`, 404);
    }

    const message: StoredDirectMessage = {
      id: crypto.randomUUID(),
      senderId: userId,
      senderName: 'You',
      content: content.trim(),
      isOwn: true,
      delivered: true,
      read: true,
      createdAt: new Date().toISOString(),
    };

    this.store.appendConversationMessage(userId, conversationId, message);
    return toDirectMessageDto(message);
  }

  markConversationRead(userId: string, conversationId: string): { success: true } {
    const updated = this.store.markConversationRead(userId, conversationId);
    if (!updated) {
      throw new SocialCommunicationError('CONVERSATION_NOT_FOUND', `Conversation ${conversationId} not found`, 404);
    }

    return { success: true };
  }

  getContestChat(_userId: string, contestId: string): ChatMessageDto[] {
    const thread = this.store.getContestChat(contestId);
    if (!thread) {
      return [];
    }

    return thread.messages.map(toChatMessageDto);
  }

  sendContestChatMessage(userId: string, contestId: string, content: string): ChatMessageDto {
    if (!content.trim()) {
      throw new SocialCommunicationError('INVALID_CONTENT', 'Message content is required', 400);
    }

    const message: StoredChatMessage = {
      id: crypto.randomUUID(),
      type: 'user',
      authorName: 'You',
      authorInitials: initialsFor('You'),
      content: content.trim(),
      createdAt: new Date().toISOString(),
      isOwn: true,
    };

    this.store.appendContestChatMessage(contestId, message);
    return toChatMessageDto(message);
  }

  getShareCard(shareId: string): ShareCardDto {
    const share = this.store.getShareCard(shareId);
    if (!share) {
      throw new SocialCommunicationError('SHARE_NOT_FOUND', `Share ${shareId} not found`, 404);
    }

    return share;
  }

  getRecap(leagueId: string, weekId: string): RecapDto {
    const recap = this.store.getRecap(leagueId, weekId);
    if (!recap) {
      throw new SocialCommunicationError('RECAP_NOT_FOUND', `Recap ${leagueId}:${weekId} not found`, 404);
    }

    return recap;
  }

  seedConversation(userId: string, seed: ConversationSeed): ConversationDto {
    const messages = (seed.messages ?? []).map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    }));

    return this.store.upsertConversation(userId, {
      id: seed.id,
      participantName: seed.participantName,
      participantInitials: seed.participantInitials,
      participantAvatarUrl: seed.participantAvatarUrl,
      messages,
    });
  }

  seedContestChat(seed: ChatThreadSeed): ChatMessageDto[] {
    const messages = (seed.messages ?? []).map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    }));

    this.store.upsertContestChat(seed.contestId, messages);
    return messages.map(toChatMessageDto);
  }

  saveShareCard(shareCard: ShareCardDto): void {
    this.store.upsertShareCard(shareCard);
  }

  saveRecap(leagueId: string, weekId: string, recap: RecapDto): void {
    this.store.upsertRecap(leagueId, weekId, recap);
  }

  createDefaultConversation(userId: string, conversationId: string, participantName: string): ConversationDto {
    const seed: ConversationSeed = {
      id: conversationId,
      participantName,
      participantInitials: initialsFor(participantName),
      participantAvatarUrl: null,
      messages: [
        {
          id: crypto.randomUUID(),
          senderId: 'u-2',
          senderName: participantName,
          content: 'Hey, want to trade picks?',
          isOwn: false,
          delivered: true,
          read: false,
          createdAt: hoursAgo(2),
        },
      ],
    };

    return this.seedConversation(userId, seed);
  }

  createDefaultContestChat(contestId: string): ChatMessageDto[] {
    return this.seedContestChat({
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
    });
  }

  createDefaultShareCard(shareId: string): ShareCardDto {
    const share = createDefaultShareCard(shareId);
    this.saveShareCard(share);
    return share;
  }

  createDefaultRecap(leagueId: string, weekId: string): RecapDto {
    const recap = createDefaultRecap(weekId);
    this.saveRecap(leagueId, weekId, recap);
    return recap;
  }
}

