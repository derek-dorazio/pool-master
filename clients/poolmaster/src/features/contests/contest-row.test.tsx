import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ContestRow } from './contest-row';

function drawRow(props: Partial<ComponentProps<typeof ContestRow>> = {}) {
  render(
    <MemoryRouter>
      <ul>
        <ContestRow
        name="Masters Pick 6"
        startsAt="2026-04-09T12:00:00.000Z"
        status={<span>Open for entries</span>}
        testId="row"
        to="/league/BIGDAWGS/contests/contest-1"
        {...props}
        />
      </ul>
    </MemoryRouter>,
  );
  return screen.getByTestId('row');
}

describe('ContestRow', () => {
  it('tints the contest the viewer came from and scrolls it into view', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const row = drawRow({ isHighlighted: true });

    expect(row).toHaveAttribute('data-highlighted', 'true');
    expect(row.className).toContain('bg-primary/10');
    expect(scroll).toHaveBeenCalledTimes(1);
    scroll.mockRestore();
  });

  it('leaves an ordinary row untinted and where it is', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const row = drawRow();

    expect(row).not.toHaveAttribute('data-highlighted');
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('opens its contest from anywhere on the row', () => {
    const row = drawRow();

    expect(row).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
    expect(within(row).getByText('Masters Pick 6')).toBeInTheDocument();
  });

  it('says when the contest starts, then what kind of contest it is', () => {
    drawRow({ details: 'Tiered' });

    expect(screen.getByTestId('row-date')).toHaveTextContent('Starts Apr 9, 2026, 8:00 AM EDT');
    expect(screen.getByTestId('row')).toHaveTextContent(/Starts Apr 9, 2026, 8:00 AM EDT\s*·\s*Tiered/);
  });

  it('says when it finished in place of its start once it has', () => {
    drawRow({ completedAt: '2026-04-12T23:00:00.000Z' });

    expect(screen.getByTestId('row-date')).toHaveTextContent('Finished Apr 12, 2026');
    expect(screen.getByTestId('row-date')).not.toHaveTextContent('Starts');
  });

  it('shows no date line for a contest without an event yet', () => {
    drawRow({ startsAt: null });

    expect(screen.queryByTestId('row-date')).not.toBeInTheDocument();
  });

  it('shows the list\'s own figure beside the status badge', () => {
    const row = drawRow({ trailing: 'Double points' });

    expect(screen.getByTestId('row-trailing')).toHaveTextContent('Double points');
    expect(within(row).getByText('Open for entries')).toBeInTheDocument();
  });

  it('shows no figure when the list has none', () => {
    drawRow();

    expect(screen.queryByTestId('row-trailing')).not.toBeInTheDocument();
  });

  it('shows the list\'s note about the contest', () => {
    drawRow({ note: 'You have an entry' });

    expect(screen.getByTestId('row')).toHaveTextContent('You have an entry');
  });
});
