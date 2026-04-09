import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposeBox } from './compose-box';

describe('ComposeBox', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('renders textarea with placeholder', () => {
    render(<ComposeBox onSubmit={mockOnSubmit} />);

    expect(screen.getByPlaceholderText("What's on your mind?")).toBeInTheDocument();
  });

  it('shows character count starting at 0/2000', () => {
    render(<ComposeBox onSubmit={mockOnSubmit} />);

    expect(screen.getByText('0/2000')).toBeInTheDocument();
  });

  it('updates character count when typing', async () => {
    const user = userEvent.setup();
    render(<ComposeBox onSubmit={mockOnSubmit} />);

    const textarea = screen.getByPlaceholderText("What's on your mind?");
    await user.type(textarea, 'Hello');

    expect(screen.getByText('5/2000')).toBeInTheDocument();
  });

  it('can type in textarea', async () => {
    const user = userEvent.setup();
    render(<ComposeBox onSubmit={mockOnSubmit} />);

    const textarea = screen.getByPlaceholderText("What's on your mind?");
    await user.type(textarea, 'Test post content');

    expect(textarea).toHaveValue('Test post content');
  });

  it('submits a real post payload', async () => {
    const user = userEvent.setup();
    render(<ComposeBox onSubmit={mockOnSubmit} />);

    await user.type(screen.getByPlaceholderText("What's on your mind?"), 'League update');
    await user.click(screen.getByRole('button', { name: /post/i }));

    expect(mockOnSubmit).toHaveBeenCalledWith({ content: 'League update' });
  });
});
