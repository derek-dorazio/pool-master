import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DMDrawer } from './dm-drawer';

const markReadMutate = vi.fn();
const sendMutate = vi.fn();

vi.mock('./hooks/use-messages', () => ({
  useConversations: () => ({
    data: [
      {
        id: 'conv-1',
        participantName: 'Mike Thompson',
        participantInitials: 'MT',
        participantAvatarUrl: null,
        lastMessage: 'Hey, want to trade picks?',
        lastMessageAt: new Date().toISOString(),
        unreadCount: 1,
      },
    ],
    isLoading: false,
  }),
  useConversationMessages: () => ({
    data: [
      {
        id: 'dm-1',
        senderId: 'u-2',
        senderName: 'Mike Thompson',
        content: 'Hey, want to trade picks?',
        createdAt: new Date().toISOString(),
        isOwn: false,
        delivered: true,
        read: false,
      },
      {
        id: 'dm-2',
        senderId: 'u-1',
        senderName: 'You',
        content: 'What are you looking for?',
        createdAt: new Date().toISOString(),
        isOwn: true,
        delivered: true,
        read: true,
      },
    ],
    isLoading: false,
  }),
  useSendDirectMessage: () => ({
    mutate: sendMutate,
    isPending: false,
  }),
  useMarkConversationRead: () => ({
    mutate: markReadMutate,
  }),
}));

describe('DMDrawer', () => {
  beforeEach(() => {
    markReadMutate.mockClear();
    sendMutate.mockClear();
  });

  it('marks the selected conversation as read when opened', async () => {
    render(<DMDrawer open onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Mike Thompson').closest('button')!);

    await waitFor(() => expect(markReadMutate).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Hey, want to trade picks?')).toBeInTheDocument();
  });
});
