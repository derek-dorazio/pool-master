import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CanonicalLeagueCode } from './canonical-league-code';

function ShowLocation() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<CanonicalLeagueCode><ShowLocation /></CanonicalLeagueCode>} path="/league/:leagueCode" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CanonicalLeagueCode', () => {
  it('sends a lower case league address on to the upper case code, keeping the query', () => {
    renderAt('/league/bigdawgs?tab=1');
    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS?tab=1');
  });

  it('renders the page as is when the code is already upper case', () => {
    renderAt('/league/BIGDAWGS');
    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS');
  });
});
