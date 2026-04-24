import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LeagueRouteScaffoldPage } from './league-route-scaffold-page';

describe('LeagueRouteScaffoldPage', () => {
  it('renders a truthful scaffold for the history route', () => {
    render(
      <MemoryRouter initialEntries={['/league/BIGDOGS/history']}>
        <Routes>
          <Route
            element={<LeagueRouteScaffoldPage scaffoldKey="history" />}
            path="/league/:leagueCode/history"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('league-route-scaffold-page-history')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to League Home' })).toHaveAttribute(
      'href',
      '/league/BIGDOGS',
    );
    expect(screen.getByTestId('league-route-scaffold-link-history')).toHaveAttribute(
      'href',
      '/league/BIGDOGS/team',
    );
  });
});
