import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLandOnEntry, useLinkedEntry } from './use-linked-entry';

function LinkedEntryProbe() {
  const linkedEntry = useLinkedEntry();
  const location = useLocation();
  return (
    <>
      <div data-testid="linked">{linkedEntry.entryId ?? 'none'}</div>
      <div data-testid="address">{`${location.search}|${useNavigationType()}`}</div>
      <button onClick={linkedEntry.clear} type="button">Close</button>
    </>
  );
}

function renderAt(search: string) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1', search }]}>
      <LinkedEntryProbe />
    </MemoryRouter>,
  );
}

describe('useLinkedEntry', () => {
  it('reads the entry a link names from ?entry=, and none without one', () => {
    renderAt('?entry=entry-7');
    expect(screen.getByTestId('linked')).toHaveTextContent('entry-7');
  });

  it('drops ?entry= on clear by replacing the history entry, and keeps the address\'s other flags', () => {
    renderAt('?mine=1&entry=entry-7');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByTestId('linked')).toHaveTextContent('none');
    expect(screen.getByTestId('address')).toHaveTextContent('?mine=1|REPLACE');
  });

  it('leaves the address alone on clear when no entry is linked', () => {
    renderAt('?mine=1');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByTestId('address')).toHaveTextContent('?mine=1|POP');
  });
});

function LandingProbe({ entryId, onLand }: { entryId: string | null; onLand: () => void }) {
  const landOn = useLandOnEntry();
  landOn(entryId, onLand);
  return <div data-entry-id="entry-7" data-testid="entry-7" />;
}

describe('useLandOnEntry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lands on an entry once, scrolling to its element after the render, however often the page renders again', () => {
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    const onLand = vi.fn();

    const { rerender } = render(<LandingProbe entryId="entry-7" onLand={onLand} />);
    rerender(<LandingProbe entryId="entry-7" onLand={onLand} />);

    expect(onLand).toHaveBeenCalledTimes(1);
    expect(scrolled).toEqual([screen.getByTestId('entry-7')]);
  });

  it('does nothing until the page names an entry it shows', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    const onLand = vi.fn();

    render(<LandingProbe entryId={null} onLand={onLand} />);

    expect(onLand).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });
});
