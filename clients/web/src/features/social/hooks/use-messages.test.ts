import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import {
  useConversations,
  useConversationMessages,
  useSendDirectMessage,
  useMarkConversationRead,
} from './use-messages';

describe('useConversations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns conversations list', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data!.length).toBeGreaterThan(0);
  });

  it('returns conversations with expected shape', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.data).toBeDefined());
    const conv = result.current.data![0];
    expect(conv).toHaveProperty('id');
    expect(conv).toHaveProperty('participantName');
    expect(conv).toHaveProperty('participantInitials');
    expect(conv).toHaveProperty('lastMessage');
    expect(conv).toHaveProperty('lastMessageAt');
    expect(conv).toHaveProperty('unreadCount');
  });

  it('includes unread counts', async () => {
    const { result } = renderHook(() => useConversations());

    await waitFor(() => expect(result.current.data).toBeDefined());
    const unreadConvs = result.current.data!.filter((c) => c.unreadCount > 0);
    expect(unreadConvs.length).toBeGreaterThan(0);
  });
});

describe('useConversationMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns messages for a conversation', async () => {
    const { result } = renderHook(() => useConversationMessages('conv-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data!.length).toBeGreaterThan(0);
  });

  it('returns messages with expected shape', async () => {
    const { result } = renderHook(() => useConversationMessages('conv-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const msg = result.current.data![0];
    expect(msg).toHaveProperty('id');
    expect(msg).toHaveProperty('senderId');
    expect(msg).toHaveProperty('senderName');
    expect(msg).toHaveProperty('content');
    expect(msg).toHaveProperty('isOwn');
    expect(msg).toHaveProperty('delivered');
    expect(msg).toHaveProperty('read');
  });

  it('includes both own and other messages', async () => {
    const { result } = renderHook(() => useConversationMessages('conv-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const own = result.current.data!.filter((m) => m.isOwn);
    const other = result.current.data!.filter((m) => !m.isOwn);
    expect(own.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
  });
});

describe('useSendDirectMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes send mutation successfully', async () => {
    const { result } = renderHook(() => useSendDirectMessage('conv-1'));

    result.current.mutate('Hey there!');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useMarkConversationRead', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes mark-read mutation successfully', async () => {
    const { result } = renderHook(() => useMarkConversationRead('conv-1'));

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
