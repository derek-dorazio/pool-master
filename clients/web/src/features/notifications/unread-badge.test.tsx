import { render, screen } from '@testing-library/react';
import { UnreadBadge } from './unread-badge';

describe('UnreadBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when count is negative', () => {
    const { container } = render(<UnreadBadge count={-1} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders count when positive', () => {
    render(<UnreadBadge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('caps display at 99+', () => {
    render(<UnreadBadge count={150} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows exact count at 99', () => {
    render(<UnreadBadge count={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });
});
