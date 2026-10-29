import { TeamIconKey } from '@poolmaster/shared/domain';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { TeamAvatar } from './team-avatar';
import { TeamName } from './team-name';
import { getTeamIconOption } from './team-icon-catalog';

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('TeamAvatar', () => {
  it.each([
    ['sm', 'h-9'],
    ['md', 'h-12'],
    ['lg', 'h-16'],
  ] as const)('draws the %s square in the icon colour', (size, squareClass) => {
    render(<TeamAvatar iconKey={TeamIconKey.CAPTAIN_SMILE_OCEAN} label="Team icon" size={size} />);

    expect(screen.getByLabelText('Team icon')).toHaveClass(
      squareClass,
      getTeamIconOption(TeamIconKey.CAPTAIN_SMILE_OCEAN).themeClass,
    );
    expect(screen.getByLabelText('Team icon')).not.toHaveClass('bg-primary/10');
  });

  it('defaults to the small square used in lists', () => {
    render(<TeamAvatar iconKey={TeamIconKey.CAPTAIN_SMILE_OCEAN} label="Team icon" />);

    expect(screen.getByLabelText('Team icon')).toHaveClass('h-9');
  });
});

describe('TeamName', () => {
  it('links the name to the team page when there is somewhere to go', () => {
    renderInRouter(<TeamName iconKey={TeamIconKey.CAPTAIN_SMILE_OCEAN} name="Blitz" testId="team" to="/leagues/ABC/teams/1" />);

    expect(screen.getByRole('link', { name: 'Blitz' })).toHaveAttribute('href', '/leagues/ABC/teams/1');
  });

  it('shows a plain name, not a link, when there is nowhere to go', () => {
    renderInRouter(<TeamName iconKey={TeamIconKey.CAPTAIN_SMILE_OCEAN} name="Blitz" testId="team" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('team')).toHaveTextContent('Blitz');
  });

  it('marks an inactive team, and leaves an active one unmarked', () => {
    const { rerender } = renderInRouter(<TeamName name="Blitz" isActive={false} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();

    rerender(<MemoryRouter><TeamName name="Blitz" /></MemoryRouter>);
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });

  it("marks the viewer's own team with the shared Yours marker, and nobody else's", () => {
    const { rerender } = renderInRouter(<TeamName name="Blitz" isMine />);
    expect(screen.getByText('Yours')).toBeInTheDocument();

    rerender(<MemoryRouter><TeamName name="Blitz" /></MemoryRouter>);
    expect(screen.queryByText('Yours')).not.toBeInTheDocument();
  });

  it('shows the line underneath, such as the owners, only when given one', () => {
    const { rerender } = renderInRouter(<TeamName name="Blitz" subtitle="Ann Lee, Bo Diaz" />);
    expect(screen.getByText('Ann Lee, Bo Diaz')).toBeInTheDocument();

    rerender(<MemoryRouter><TeamName name="Blitz" /></MemoryRouter>);
    expect(screen.queryByText('Ann Lee, Bo Diaz')).not.toBeInTheDocument();
  });
});
