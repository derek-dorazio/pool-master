import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryFinishCard, type EntryFinishAction } from './entry-finish-card';

const action = (overrides: Partial<EntryFinishAction> = {}): EntryFinishAction => ({
  disabled: false,
  isBusy: false,
  label: 'Submit week',
  onClick: vi.fn(),
  testId: 'submit',
  ...overrides,
});

const name = (overrides: Partial<{ onChange: (value: string) => void; value: string }> = {}) => ({
  onChange: vi.fn(),
  testId: 'name',
  value: 'Sharks 1',
  ...overrides,
});

/** A stand-in IntersectionObserver whose callback the test fires, as the browser would on scroll. */
function stubIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }
    disconnect() {}
    observe() {}
  });
  return (isIntersecting: boolean) => act(() => callbacks.forEach((callback) => callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EntryFinishCard', () => {
  it('holds the entry\'s name, the page\'s own fields, the status and the one button, titled Name and submit', () => {
    const onChange = vi.fn();
    const submit = action();
    render(
      <EntryFinishCard action={submit} name={name({ onChange })} status="Submit by Thu 8:15 PM" statusTestId="status" testId="card" title="Name and submit">
        <p>Tiebreaker field</p>
      </EntryFinishCard>,
    );

    expect(screen.getByRole('heading', { name: 'Name and submit' })).toBeInTheDocument();
    expect(screen.getByTestId('name')).toHaveValue('Sharks 1');
    expect(screen.getByText('Tiebreaker field')).toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('Submit by Thu 8:15 PM');
    fireEvent.change(screen.getByTestId('name'), { target: { value: 'Sharks 2' } });
    expect(onChange).toHaveBeenCalledWith('Sharks 2');
    fireEvent.click(screen.getByTestId('submit'));
    expect(submit.onClick).toHaveBeenCalledTimes(1);
  });

  it('shows no button once there is nothing to save or submit, and leaves the name off when it cannot change', () => {
    render(<EntryFinishCard action={null} name={null} status="✓ Submitted · change until kickoff" statusTestId="status" testId="card" title="Name and submit" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('name')).not.toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('✓ Submitted · change until kickoff');
  });

  it('keeps the button closed while it is disabled and reads Saving while it runs, and shows why the last try was refused', () => {
    render(<EntryFinishCard action={action({ disabled: true, isBusy: true })} error="That game has started." errorTestId="error" name={name()} status="" testId="card" title="Entry name" />);

    expect(screen.getByRole('heading', { name: 'Entry name' })).toBeInTheDocument();
    expect(screen.getByTestId('submit')).toBeDisabled();
    expect(screen.getByTestId('submit')).toHaveTextContent('Saving...');
    expect(screen.getByTestId('error')).toHaveTextContent('That game has started.');
  });

  it('keeps the status and button in a bar at the bottom of a phone while the card is out of view, and drops it once the card scrolls in', () => {
    const scroll = stubIntersectionObserver();
    const submit = action();
    render(<EntryFinishCard action={submit} name={null} status="3 still to pick" testId="card" title="Name and submit" />);

    scroll(false);
    expect(screen.getByTestId('card-sticky')).toHaveClass('fixed', 'bottom-0', 'md:hidden');
    expect(screen.getByTestId('card-sticky-status')).toHaveTextContent('3 still to pick');
    fireEvent.click(screen.getByTestId('submit-sticky'));
    expect(submit.onClick).toHaveBeenCalledTimes(1);

    scroll(true);
    expect(screen.queryByTestId('card-sticky')).not.toBeInTheDocument();
  });

  it('shows no phone bar with no button', () => {
    const scroll = stubIntersectionObserver();
    render(<EntryFinishCard action={null} name={name()} status="Nothing to submit: the draw picks for you" testId="card" title="Entry name" />);

    scroll(false);
    expect(screen.queryByTestId('card-sticky')).not.toBeInTheDocument();
  });
});
