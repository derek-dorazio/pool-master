import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { buildLeagueSquad } from '@/features/leagues/test/fixtures';
import { DataGrid } from '@/features/shared/ui';
import { buildTeamDirectoryRows } from './team-directory';
import { teamNameColumn } from './team-name-column';

function renderNameColumn(isActive: boolean) {
  const rows = buildTeamDirectoryRows([buildLeagueSquad({ id: 'team-7', isActive, name: 'Late Scratch' })]);
  return render(
    <MemoryRouter>
      <DataGrid columns={[teamNameColumn('BIGDAWGS')]} data={rows} emptyMessage="No teams yet." getRowId={(row) => row.team.id} />
    </MemoryRouter>,
  );
}

describe('teamNameColumn', () => {
  it("heads the column Name and links each team's name to its team page", () => {
    renderNameColumn(true);

    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeVisible();
    expect(screen.getByTestId('league-team-home-link-team-7')).toHaveAttribute('href', '/league/BIGDAWGS/teams/team-7');
    expect(screen.getByTestId('league-team-home-link-team-7')).toHaveTextContent('Late Scratch');
  });

  it('marks a team that has left the league as inactive', () => {
    renderNameColumn(false);

    expect(screen.getByText('Inactive')).toBeVisible();
  });
});
