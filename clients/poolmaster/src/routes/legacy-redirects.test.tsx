import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  LegacyContestCreateRedirect,
  LegacyContestManageRedirect,
  LegacyManageContestsRedirect,
} from './legacy-redirects';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<LegacyManageContestsRedirect />} path="/league/:leagueCode/contests/manage" />
        <Route element={<LegacyContestCreateRedirect />} path="/league/:leagueCode/contests/new" />
        <Route element={<LegacyContestManageRedirect />} path="/league/:leagueCode/contests/:contestId/manage" />
        <Route element={<LocationProbe />} path="/league/:leagueCode/admin/*" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Contest setup links from before Commissioner tools', () => {
  it('sends the old Manage Contests link to the Commissioner tools contest list', () => {
    renderAt('/league/BIGDAWGS/contests/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contests');
  });

  it('sends the old Create contest link to Create contest in Commissioner tools', () => {
    renderAt('/league/BIGDAWGS/contests/new');

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contests/new');
  });

  it('sends an old manage-contest link to that contest\'s setup page in Commissioner tools', () => {
    renderAt('/league/BIGDAWGS/contests/contest-9/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contests/contest-9');
  });
});
