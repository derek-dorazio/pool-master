import { SocialCommunicationService } from '../../../packages/core-api/src/modules/social/communication-service';

describe('SocialCommunicationService', () => {
  it('lists conversations and marks read state through the service', () => {
    const service = new SocialCommunicationService();

    service.seedConversation('user-1', {
      id: 'conv-1',
      participantName: 'Mike Thompson',
      participantInitials: 'MT',
      participantAvatarUrl: null,
      messages: [
        {
          id: 'msg-1',
          senderId: 'u-2',
          senderName: 'Mike Thompson',
          content: 'Hey, want to trade picks?',
          isOwn: false,
          delivered: true,
          read: false,
          createdAt: new Date(Date.now() - 2 * 60 * 60_000),
        },
        {
          id: 'msg-2',
          senderId: 'user-1',
          senderName: 'You',
          content: 'What are you looking for?',
          isOwn: true,
          delivered: true,
          read: true,
          createdAt: new Date(Date.now() - 60 * 60_000),
        },
      ],
    });

    const conversations = service.listConversations('user-1');
    expect(conversations.length).toBeGreaterThan(0);

    const conversationId = conversations[0].id;
    const messages = service.getConversationMessages('user-1', conversationId);
    expect(messages.length).toBeGreaterThan(0);

    const sent = service.sendDirectMessage('user-1', conversationId, 'Hello from unit test');
    expect(sent.content).toBe('Hello from unit test');

    const readResult = service.markConversationRead('user-1', conversationId);
    expect(readResult).toEqual({ success: true });

    const refreshed = service.listConversations('user-1').find((conv) => conv.id === conversationId);
    expect(refreshed?.unreadCount).toBe(0);
  });

  it('serves contest chat, share cards, and recaps', () => {
    const service = new SocialCommunicationService();

    service.seedContestChat({
      contestId: 'contest-1',
      messages: [
        {
          id: 'chat-1',
          type: 'system',
          authorName: 'System',
          authorInitials: '',
          content: 'Draft started',
          createdAt: new Date(Date.now() - 3 * 60 * 60_000),
          isOwn: false,
        },
        {
          id: 'chat-2',
          type: 'user',
          authorName: 'Mike',
          authorInitials: 'MT',
          content: 'Good luck all!',
          createdAt: new Date(Date.now() - 2 * 60 * 60_000),
          isOwn: false,
        },
      ],
    });

    const chat = service.getContestChat('user-1', 'contest-1');
    expect(chat.some((message) => message.type === 'system')).toBe(true);

    const sent = service.sendContestChatMessage('user-1', 'contest-1', 'Hello everyone!');
    expect(sent.content).toBe('Hello everyone!');

    const shareSeed = service.createDefaultShareCard('share-1');
    const share = service.getShareCard('share-1');
    expect(share.id).toBe('share-1');
    expect(share.leaderboard.length).toBeGreaterThan(0);
    expect(shareSeed.title).toBe(share.title);

    const recapSeed = service.createDefaultRecap('league-1', 'current');
    const recap = service.getRecap('league-1', 'current');
    expect(recap.weekLabel).toBe('Current Week');
    expect(recap.standings.length).toBeGreaterThan(0);
    expect(recapSeed.weekLabel).toBe(recap.weekLabel);
  });

  it('does not invent social records when none exist', () => {
    const service = new SocialCommunicationService();

    expect(() => service.getShareCard('missing-share')).toThrow('Share missing-share not found');
    expect(() => service.getRecap('league-1', 'missing-week')).toThrow('Recap league-1:missing-week not found');
  });
});
