import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Podium } from './podium';

const steps = [
  { place: 1 as const, squads: [{ squadId: 's1', squadName: 'Birdie Bandits', points: 120 }] },
  { place: 2 as const, squads: [{ squadId: 's2', squadName: 'Casey Crushers', points: 905 }] },
  { place: 3 as const, squads: [{ squadId: 's3', squadName: 'Eagle Eyes', points: 60 }] },
];

describe('Podium', () => {
  it('stands 2nd, 1st and 3rd left to right, each step in its own place colours with its numeral', () => {
    render(<Podium focusSquadId={null} steps={steps} testId="podium" />);

    const places = within(screen.getByTestId('podium')).getAllByRole('listitem');
    expect(places.map((place) => place.getAttribute('data-testid'))).toEqual(['podium-2', 'podium-1', 'podium-3']);
    const firstNumeral = within(screen.getByTestId('podium-1')).getByText('1');
    expect(firstNumeral).toHaveClass('font-display', 'font-black');
    expect(screen.getByTestId('podium-1-step')).toHaveClass('podium-step-1', 'h-16');
    expect(within(screen.getByTestId('podium-1-step')).getByText('1')).toBe(firstNumeral);
    expect(screen.getByTestId('podium-3-step')).toHaveClass('podium-step-3', 'h-8');
    expect(screen.getByTestId('podium-2')).toHaveTextContent('Casey Crushers90.5 pts2');
  });

  it('sets the focus squad bold and leaves an empty step out when a tie takes its place', () => {
    render(<Podium focusSquadId="s1" steps={steps.filter((step) => step.place !== 2)} testId="podium" />);

    expect(screen.getByText('Birdie Bandits')).toHaveClass('font-bold');
    expect(screen.getByText('Eagle Eyes')).toHaveClass('font-semibold');
    expect(screen.queryByTestId('podium-2')).not.toBeInTheDocument();
  });
});
