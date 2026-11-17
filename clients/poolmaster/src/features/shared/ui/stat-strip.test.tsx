import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatStrip } from './stat-strip';

describe('StatStrip', () => {
  it('shows each number after its label on one strip, with each value reachable by its own test id', () => {
    render(
      <StatStrip
        items={[{ label: 'Picked', value: '9 of 14', testId: 'picked' }, { label: 'Points', value: '0', testId: 'points' }]}
        testId="strip"
      />,
    );

    expect(screen.getByTestId('strip')).toHaveTextContent('Picked9 of 14Points0');
    expect(screen.getByTestId('picked')).toHaveTextContent('9 of 14');
    expect(screen.getByTestId('points')).toHaveClass('tabular-nums');
  });

  it('keeps a label and its value together, so a narrow screen wraps between numbers and never splits one', () => {
    render(<StatStrip items={[{ label: 'Numbers', value: 'After the board fills', testId: 'numbers' }]} />);

    expect(screen.getByTestId('numbers-item')).toHaveClass('whitespace-nowrap');
  });

  it('draws an item given no test id with no test ids of its own, so a strip never invents one', () => {
    render(<StatStrip items={[{ label: 'Max', value: '42' }]} testId="strip" />);

    expect(screen.getByTestId('strip')).toHaveTextContent('Max42');
    expect(screen.queryByTestId(/-item$/)).not.toBeInTheDocument();
  });
});
