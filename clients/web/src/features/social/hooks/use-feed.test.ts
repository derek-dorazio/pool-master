import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import {
  useFeed,
  useCreatePost,
  useToggleReaction,
  usePinPost,
  useDeletePost,
  useCreateReply,
  useVotePoll,
} from './use-feed';

describe('useFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns feed pages with items and pinned posts', async () => {
    const { result } = renderHook(() => useFeed('league-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const firstPage = result.current.data!.pages[0];
    expect(firstPage).toHaveProperty('items');
    expect(firstPage).toHaveProperty('pinned');
    expect(Array.isArray(firstPage.items)).toBe(true);
    expect(Array.isArray(firstPage.pinned)).toBe(true);
  });

  it('returns feed items with expected shape', async () => {
    const { result } = renderHook(() => useFeed('league-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const post = result.current.data!.pages[0].items[0];
    expect(post).toHaveProperty('id');
    expect(post).toHaveProperty('type');
    expect(post).toHaveProperty('authorName');
    expect(post).toHaveProperty('content');
    expect(post).toHaveProperty('reactions');
    expect(post).toHaveProperty('replyCount');
  });

  it('returns pinned posts', async () => {
    const { result } = renderHook(() => useFeed('league-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    const pinned = result.current.data!.pages[0].pinned;
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned[0].pinned).toBe(true);
  });

  it('returns nextCursor for pagination', async () => {
    const { result } = renderHook(() => useFeed('league-1'));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.pages[0]).toHaveProperty('nextCursor');
  });
});

describe('useCreatePost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes mutation successfully', async () => {
    const { result } = renderHook(() => useCreatePost('league-1'));

    result.current.mutate({ content: 'Hello world' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('accepts post with poll data', async () => {
    const { result } = renderHook(() => useCreatePost('league-1'));

    result.current.mutate({
      content: 'Vote!',
      poll: { question: 'Who wins?', options: ['A', 'B'], expiresIn: '24h' },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useToggleReaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes reaction toggle mutation', async () => {
    const { result } = renderHook(() => useToggleReaction('league-1'));

    result.current.mutate({ postId: 'p-1', emoji: '👍' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('usePinPost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes pin mutation', async () => {
    const { result } = renderHook(() => usePinPost('league-1'));

    result.current.mutate({ postId: 'p-1', pin: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('completes unpin mutation', async () => {
    const { result } = renderHook(() => usePinPost('league-1'));

    result.current.mutate({ postId: 'p-1', pin: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useDeletePost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes delete mutation', async () => {
    const { result } = renderHook(() => useDeletePost('league-1'));

    result.current.mutate('p-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useCreateReply', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes reply mutation', async () => {
    const { result } = renderHook(() => useCreateReply('p-1', 'league-1'));

    result.current.mutate('Great post!');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useVotePoll', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes vote mutation', async () => {
    const { result } = renderHook(() => useVotePoll('league-1'));

    result.current.mutate({ postId: 'p-3', optionId: 'o1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
