import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from './search-bar';

describe('SearchBar', () => {
  it('renders with placeholder', () => {
    render(<SearchBar value="" onChange={() => {}} placeholder="Find leagues..." />);
    expect(screen.getByPlaceholderText('Find leagues...')).toBeInTheDocument();
  });

  it('renders default placeholder when none provided', () => {
    render(<SearchBar value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('calls onChange when typing', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="" onChange={onChange} />);
    await user.type(screen.getByPlaceholderText('Search...'), 'golf');
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="test" onChange={() => {}} onSubmit={onSubmit} />);
    await user.type(screen.getByPlaceholderText('Search...'), '{enter}');
    expect(onSubmit).toHaveBeenCalledWith('test');
  });

  it('shows clear button when value is present', () => {
    render(<SearchBar value="something" onChange={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onChange with empty string when clear is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar value="something" onChange={onChange} />);
    await user.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
