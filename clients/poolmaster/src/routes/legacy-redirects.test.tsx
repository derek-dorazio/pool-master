import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  LegacyContestCreateRedirect,
  LegacyContestHistoryRedirect,
  LegacyContestManageRedirect,
  LegacyContestTypesRedirect,
  LegacyLeagueContestsRedirect,
  LegacyManageContestsRedirect,
  LegacyManageSyncRedirect,
} from './legacy-redirects';

const { getLeagueByCodeMock } = vi.hoisted(() => ({ getLeagueByCodeMock: vi.fn() }));

bindApiMocks({ getLeagueByCode: getLeagueByCodeMock });

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1', isRootAdmin: false }, clearSession: vi.fn() }),
}));

afterEach(() => {
  getLeagueByCodeMock.mockReset();
});

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

function FullLocationProbe() {
  const location = useLocation();
  return <div data-testid="full-location">{`${location.pathname}${location.search}`}</div>;
}

function renderContestsLinkAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<LegacyLeagueContestsRedirect />} path="/league/:leagueCode/contests" />
        <Route element={<LegacyContestHistoryRedirect />} path="/league/:leagueCode/contests/history" />
        <Route element={<FullLocationProbe />} path="/league/:leagueCode" />
        <Route element={<FullLocationProbe />} path="/league/:leagueCode/team" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Links to the Contests tab, which folded into Home and My team', () => {
  it('sends the old Contests list to League Home', () => {
    renderContestsLinkAt('/league/BIGDAWGS/contests');

    expect(screen.getByTestId('full-location')).toHaveTextContent(/^\/league\/BIGDAWGS$/);
  });

  it('keeps the contest an old Contests link focused on, so Home tints it', () => {
    renderContestsLinkAt('/league/BIGDAWGS/contests?focus=contest-9');

    expect(screen.getByTestId('full-location')).toHaveTextContent('/league/BIGDAWGS?focus=contest-9');
  });

  it('sends the old Past view to My team\'s full Past contests at the year and contest it named', () => {
    renderContestsLinkAt('/league/BIGDAWGS/contests/history?year=2025&focus=contest-9');

    expect(screen.getByTestId('full-location')).toHaveTextContent('/league/BIGDAWGS/team?past=all&pastYear=2025&focus=contest-9');
  });

  it('opens Past contests on its newest year when the old link named none, or a year that is not one', () => {
    renderContestsLinkAt('/league/BIGDAWGS/contests/history?year=soon');

    expect(screen.getByTestId('full-location')).toHaveTextContent(/^\/league\/BIGDAWGS\/team\?past=all$/);
  });
});

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

describe('The Contest types link from before it moved to Commissioner tools', () => {
  function renderContestTypesLink(role: 'COMMISSIONER' | 'MEMBER') {
    getLeagueByCodeMock.mockResolvedValue({
      data: {
        league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs', isActive: true },
        membership: { id: 'membership-1', leagueId: 'league-1', userId: 'user-1', role, status: 'ACTIVE' },
        squadMembership: null,
      },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/league/BIGDAWGS/contest-types']}>
          <Routes>
            <Route element={<LegacyContestTypesRedirect />} path="/league/:leagueCode/contest-types" />
            <Route element={<LocationProbe />} path="/league/:leagueCode/admin/*" />
            <Route element={<LocationProbe />} path="/how-to-play" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('opens Contest types in Commissioner tools for a commissioner', async () => {
    renderContestTypesLink('COMMISSIONER');

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/admin/contest-types');
  });

  it('opens How to Play, which explains every contest type, for a member', async () => {
    renderContestTypesLink('MEMBER');

    expect(await screen.findByTestId('location')).toHaveTextContent('/how-to-play');
  });
});

describe('Links to the old sync run history page and its tools (#1887)', () => {
  function renderSyncLinkAt(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<LegacyManageSyncRedirect />} path="/manage/sync/*" />
          <Route element={<FullLocationProbe />} path="/manage/activity" />
          <Route element={<FullLocationProbe />} path="/manage/providers/*" />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('sends the old sync run history page to Activity', () => {
    renderSyncLinkAt('/manage/sync');

    expect(screen.getByTestId('full-location')).toHaveTextContent(/^\/manage\/activity$/);
  });

  it('sends Run event sync to its page under Providers', () => {
    renderSyncLinkAt('/manage/sync/run-event-sync');

    expect(screen.getByTestId('full-location')).toHaveTextContent(/^\/manage\/providers\/run-event-sync$/);
  });

  it('sends an old Map competitor link under Providers, where its unmapped participants path then opens Findings', () => {
    renderSyncLinkAt('/manage/sync/unmapped-participants/map?provider=bdl&competitor=golfer-7');

    expect(screen.getByTestId('full-location')).toHaveTextContent('/manage/providers/unmapped-participants/map?provider=bdl&competitor=golfer-7');
  });
});
