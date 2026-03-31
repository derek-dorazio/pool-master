import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useChatMessages, useSendChatMessage } from './use-chat';

describe('useChatMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns chat messages array', async () => {
    const { result } = renderHook(() => useChatMessages('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data!.length).toBeGreaterThan(0);
  });

  it('returns messages with expected shape', async () => {
    const { result } = renderHook(() => useChatMessages('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const msg = result.current.data![0];
    expect(msg).toHaveProperty('id');
    expect(msg).toHaveProperty('type');
    expect(msg).toHaveProperty('authorName');
    expect(msg).toHaveProperty('content');
    expect(msg).toHaveProperty('createdAt');
    expect(msg).toHaveProperty('isOwn');
  });

  it('includes both user and system messages', async () => {
    const { result } = renderHook(() => useChatMessages('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const types = result.current.data!.map((m) => m.type);
    expect(types).toContain('user');
    expect(types).toContain('system');
  });

  it('marks own messages correctly', async () => {
    const { result } = renderHook(() => useChatMessages('contest-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const ownMessages = result.current.data!.filter((m) => m.isOwn);
    expect(ownMessages.length).toBeGreaterThan(0);
    expect(ownMessages[0].isOwn).toBe(true);
  });
});

describe('useSendChatMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes send mutation successfully', async () => {
    const { result } = renderHook(() => useSendChatMessage('contest-1'));

    result.current.mutate('Hello everyone!');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('accepts string content parameter', async () => {
    const { result } = renderHook(() => useSendChatMessage('contest-1'));

    result.current.mutate('Test message');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
  });
});
