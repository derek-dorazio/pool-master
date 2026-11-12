import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParticipantLine } from './participant-line';

describe('ParticipantLine', () => {
  it('shows the name with the team under it, the team line small in a list and larger on a tier card', () => {
    render(
      <>
        <div data-testid="card"><ParticipantLine affiliation="Duke" name="Cooper Flagg" /></div>
        <div data-testid="compact"><ParticipantLine affiliation="Houston" density="compact" name="L.J. Cryer" /></div>
      </>,
    );

    expect(screen.getByText('Cooper Flagg')).toBeInTheDocument();
    expect(screen.getByText('Duke')).toHaveClass('text-sm');
    expect(screen.getByText('Houston')).toHaveClass('text-xs');
  });

  it('shows the name alone when there is no team', () => {
    render(<div data-testid="line"><ParticipantLine affiliation={null} name="Scottie Scheffler" /></div>);

    expect(screen.getByTestId('line')).toHaveTextContent(/^Scottie Scheffler$/);
  });

  it('cuts a long name short with an ellipsis when asked to', () => {
    render(<ParticipantLine name="A very long participant name" truncate />);

    expect(screen.getByText('A very long participant name')).toHaveClass('truncate');
  });
});
