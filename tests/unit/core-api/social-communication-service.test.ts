import { SocialCommunicationService } from '../../../packages/core-api/src/modules/social/communication-service';

describe('SocialCommunicationService', () => {
  it('lists conversations and marks read state through the service', () => {
    const service = new SocialCommunicationService();

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

    const chat = service.getContestChat('user-1', 'contest-1');
    expect(chat.some((message) => message.type === 'system')).toBe(true);
    expect(chat.some((message) => message.isOwn)).toBe(true);

    const sent = service.sendContestChatMessage('user-1', 'contest-1', 'Hello everyone!');
    expect(sent.content).toBe('Hello everyone!');

    const share = service.getShareCard('share-1');
    expect(share.id).toBe('share-1');
    expect(share.leaderboard.length).toBeGreaterThan(0);

    const recap = service.getRecap('league-1', 'current');
    expect(recap.weekLabel).toBe('Current Week');
    expect(recap.standings.length).toBeGreaterThan(0);
  });
});
