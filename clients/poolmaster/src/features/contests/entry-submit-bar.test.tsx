import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntrySubmitBar } from './entry-submit-bar';

const submit = (overrides: Partial<{ disabled: boolean; isSubmitting: boolean }> = {}) => ({
  disabled: false,
  isSubmitting: false,
  label: 'Submit week',
  onSubmit: vi.fn(),
  testId: 'submit',
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

describe('EntrySubmitBar', () => {
  it('keeps the progress and Submit in a bar at the bottom of a phone while the section is out of view, and drops it once the section scrolls in', () => {
    const scroll = stubIntersectionObserver();
    const action = submit();
    render(<EntrySubmitBar progress="3 of 8 picked" submit={action} testId="bar" />);

    scroll(false);
    expect(screen.getByTestId('bar-sticky')).toHaveClass('fixed', 'bottom-0', 'md:hidden');
    expect(screen.getByTestId('bar-sticky-progress')).toHaveTextContent('3 of 8 picked');
    fireEvent.click(screen.getByTestId('submit-sticky'));
    expect(action.onSubmit).toHaveBeenCalledTimes(1);

    scroll(true);
    expect(screen.queryByTestId('bar-sticky')).not.toBeInTheDocument();
  });

  it('keeps the phone bar\'s Submit closed while the section\'s is, and shows no phone bar with nothing to submit', () => {
    const scroll = stubIntersectionObserver();
    const { rerender } = render(<EntrySubmitBar submit={submit({ disabled: true, isSubmitting: true })} testId="bar" />);

    scroll(false);
    expect(screen.getByTestId('submit-sticky')).toBeDisabled();
    expect(screen.getByTestId('submit-sticky')).toHaveTextContent('Submitting...');
    expect(screen.queryByTestId('bar-sticky-progress')).not.toBeInTheDocument();

    rerender(<EntrySubmitBar submit={null} testId="bar" />);
    expect(screen.queryByTestId('bar-sticky')).not.toBeInTheDocument();
  });

  it('titles the section Submit and shows the progress fact in its title bar', () => {
    render(<EntrySubmitBar progress="3 of 8 picked" progressTestId="progress" testId="bar" />);

    expect(screen.getByRole('heading', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByTestId('progress')).toHaveTextContent('3 of 8 picked');
  });

  it('calls onSubmit when the open Submit button is pressed', () => {
    const action = submit();
    render(<EntrySubmitBar submit={action} testId="bar" />);

    fireEvent.click(screen.getByTestId('submit'));

    expect(action.onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('submit')).toHaveTextContent('Submit week');
  });

  it('keeps Submit closed while it is disabled and reads Submitting while a submit runs', () => {
    render(<EntrySubmitBar submit={submit({ disabled: true, isSubmitting: true })} testId="bar" />);

    expect(screen.getByTestId('submit')).toBeDisabled();
    expect(screen.getByTestId('submit')).toHaveTextContent('Submitting...');
  });

  it('shows no button when there is nothing to submit, but still shows the page\'s own content, hint and error', () => {
    render(
      <EntrySubmitBar error="Refused" errorTestId="error" hint="Pick every game to submit." hintTestId="hint" submit={null} testId="bar" title="Tiebreaker and submit">
        <p>Saved tiebreaker</p>
      </EntrySubmitBar>,
    );

    expect(screen.queryByTestId('submit')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tiebreaker and submit' })).toBeInTheDocument();
    expect(screen.getByText('Saved tiebreaker')).toBeInTheDocument();
    expect(screen.getByTestId('hint')).toHaveTextContent('Pick every game to submit.');
    expect(screen.getByTestId('error')).toHaveTextContent('Refused');
  });

  it('shows no hint, error or progress when none is given', () => {
    render(<EntrySubmitBar testId="bar" />);

    expect(screen.getByTestId('bar')).toHaveTextContent('Submit');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
