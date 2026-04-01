import { render, screen } from '@testing-library/react';
import { PostCard } from './post-card';
import type { FeedPost } from './hooks/use-feed';

vi.mock('./reaction-bar', () => ({
  ReactionBar: ({ reactions }: { reactions: unknown[] }) => (
    <div data-testid="reaction-bar">reactions: {reactions.length}</div>
  ),
}));

vi.mock('./poll-card', () => ({
  PollCard: () => <div data-testid="poll-card" />,
}));

vi.mock('./thread-view', () => ({
  ThreadView: () => <div data-testid="thread-view" />,
}));

vi.mock('./automated-event-card', () => ({
  AutomatedEventCard: ({ post }: { post: FeedPost }) => (
    <div data-testid="event-card">{post.content}</div>
  ),
}));

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'p-1',
    type: 'post',
    authorId: 'u-1',
    authorName: 'John Doe',
    authorInitials: 'JD',
    authorAvatarUrl: null,
    content: 'Hello world post content',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    pinned: false,
    pinnedBy: null,
    reactions: [{ emoji: '👍', count: 3, reacted: false }],
    replyCount: 2,
    poll: null,
    ...overrides,
  };
}

const defaultProps = {
  leagueId: 'league-1',
  onReaction: vi.fn(),
};

describe('PostCard', () => {
  it('renders author name and content', () => {
    render(<PostCard post={makePost()} {...defaultProps} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Hello world post content')).toBeInTheDocument();
  });

  it('shows timestamp', () => {
    render(<PostCard post={makePost()} {...defaultProps} />);

    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('displays reaction bar', () => {
    render(
      <PostCard
        post={makePost({ reactions: [{ emoji: '👍', count: 3, reacted: false }, { emoji: '🔥', count: 1, reacted: true }] })}
        {...defaultProps}
      />,
    );

    expect(screen.getByTestId('reaction-bar')).toHaveTextContent('reactions: 2');
  });

  it('shows reply count', () => {
    render(<PostCard post={makePost({ replyCount: 4 })} {...defaultProps} />);

    expect(screen.getByText('4 replies')).toBeInTheDocument();
  });

  it('shows singular "reply" when replyCount is 1', () => {
    render(<PostCard post={makePost({ replyCount: 1 })} {...defaultProps} />);

    expect(screen.getByText('1 reply')).toBeInTheDocument();
  });

  it('announcement type has special styling and badge', () => {
    render(
      <PostCard post={makePost({ type: 'announcement' })} {...defaultProps} />,
    );

    expect(screen.getByText('Announcement')).toBeInTheDocument();
    // The avatar circle should have amber styling for announcements
    const avatar = screen.getByText('JD');
    expect(avatar.className).toContain('bg-amber-100');
  });
});
