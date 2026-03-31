import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactionBar } from './reaction-bar';
import type { Reaction } from './hooks/use-feed';

describe('ReactionBar', () => {
  const mockOnToggle = vi.fn();

  beforeEach(() => {
    mockOnToggle.mockClear();
  });

  it('renders emoji buttons for all available emojis', () => {
    render(<ReactionBar reactions={[]} onToggle={mockOnToggle} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(5);
    expect(screen.getByLabelText('React with 👍')).toBeInTheDocument();
    expect(screen.getByLabelText('React with 🔥')).toBeInTheDocument();
    expect(screen.getByLabelText('React with 😂')).toBeInTheDocument();
  });

  it('shows count per reaction', () => {
    const reactions: Reaction[] = [
      { emoji: '👍', count: 5, reacted: false },
      { emoji: '🔥', count: 2, reacted: false },
    ];

    render(<ReactionBar reactions={reactions} onToggle={mockOnToggle} />);

    expect(screen.getByLabelText('👍 5')).toBeInTheDocument();
    expect(screen.getByLabelText('🔥 2')).toBeInTheDocument();
  });

  it('click calls toggle handler with the emoji', async () => {
    const user = userEvent.setup();
    const reactions: Reaction[] = [
      { emoji: '👍', count: 3, reacted: false },
    ];

    render(<ReactionBar reactions={reactions} onToggle={mockOnToggle} />);

    await user.click(screen.getByLabelText('👍 3'));

    expect(mockOnToggle).toHaveBeenCalledWith('👍');
  });

  it('active reaction is highlighted with primary styling', () => {
    const reactions: Reaction[] = [
      { emoji: '👍', count: 2, reacted: true },
      { emoji: '🔥', count: 1, reacted: false },
    ];

    render(<ReactionBar reactions={reactions} onToggle={mockOnToggle} />);

    const activeButton = screen.getByLabelText("👍 2, you reacted");
    expect(activeButton.className).toContain('bg-primary/10');

    const inactiveButton = screen.getByLabelText('🔥 1');
    expect(inactiveButton.className).toContain('bg-muted');
  });
});
