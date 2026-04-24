import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CanonicalTeamHomeRoute } from './canonical-team-home-route';

vi.mock('./my-team-page', () => ({
  MyTeamPage: () => <div data-testid="my-team-page">My Team Body</div>,
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}

describe('CanonicalTeamHomeRoute', () => {
  it('adds the teamId query param before rendering the current team page implementation', async () => {
    render(
      <MemoryRouter initialEntries={['/league/BIGDOGS/teams/team-42']}>
        <Routes>
          <Route
            element={<CanonicalTeamHomeRoute />}
            path="/league/:leagueCode/teams/:teamId"
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('my-team-page')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/league/BIGDOGS/teams/team-42?teamId=team-42',
    );
  });
});
