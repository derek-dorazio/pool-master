import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LeagueRouteScaffoldPage } from './league-route-scaffold-page';

describe('LeagueRouteScaffoldPage', () => {
  it('renders a truthful scaffold for the entries route', () => {
    render(
      <MemoryRouter initialEntries={['/league/BIGDOGS/entries']}>
        <Routes>
          <Route
            element={<LeagueRouteScaffoldPage scaffoldKey="entries" />}
            path="/league/:leagueCode/entries"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('league-route-scaffold-page-entries')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to League Home' })).toHaveAttribute(
      'href',
      '/league/BIGDOGS',
    );
    expect(screen.getByTestId('league-route-scaffold-link-entries')).toHaveAttribute(
      'href',
      '/league/BIGDOGS/team',
    );
  });
});
