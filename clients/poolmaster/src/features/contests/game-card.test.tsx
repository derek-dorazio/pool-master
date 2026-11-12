import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameCard } from './game-card';

describe('GameCard', () => {
  it('names the game on its caption line, shows its markers there and its choices under it', () => {
    render(
      <ul>
        <GameCard aside={<span>Locked</span>} label={<span>Game 3</span>} testId="game-3">
          <button type="button">Duke</button>
        </GameCard>
      </ul>,
    );

    const card = screen.getByTestId('game-3');
    expect(card.tagName).toBe('LI');
    expect(within(card).getByText('Game 3')).toBeInTheDocument();
    expect(within(card).getByText('Locked')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Duke' })).toBeInTheDocument();
  });

  it('draws the box with the standard 8px corners, roomy by default and tighter when compact', () => {
    render(
      <ul>
        <GameCard label="Roomy" testId="roomy"><span>a</span></GameCard>
        <GameCard density="compact" label="Compact" testId="compact"><span>b</span></GameCard>
      </ul>,
    );

    expect(screen.getByTestId('roomy')).toHaveClass('rounded-lg', 'p-4');
    expect(screen.getByTestId('compact')).toHaveClass('rounded-lg', 'p-3');
  });

  it('leaves the caption line\'s right side empty when the game has no markers', () => {
    render(<ul><GameCard label="Game 1" testId="game-1"><span>choices</span></GameCard></ul>);

    expect(screen.getByTestId('game-1')).toHaveTextContent(/^Game 1choices$/);
  });
});
