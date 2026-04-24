import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LeagueRouteScaffoldPage } from './league-route-scaffold-page';

describe('LeagueRouteScaffoldPage', () => {
  it('renders a truthful scaffold for the league contests route', () => {
    render(
      <MemoryRouter initialEntries={['/league/BIGDOGS/contests']}>
        <Routes>
          <Route
            element={<LeagueRouteScaffoldPage scaffoldKey="contests" />}
            path="/league/:leagueCode/contests"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('league-route-scaffold-page-contests')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to League Home' })).toHaveAttribute(
      'href',
      '/league/BIGDOGS',
    );
    expect(screen.getByTestId('league-route-scaffold-link-contests')).toHaveAttribute(
      'href',
      '/league/BIGDOGS',
    );
  });
});
