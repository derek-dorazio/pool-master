import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { ManageLandingRedirect, RootAdminManageLayout } from './root-admin-manage-layout';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function EntityHomeProbe() {
  useManageBreadcrumbOverride('user-2', 'Target User');
  return <h1>Target User</h1>;
}

function renderManage(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RootAdminManageLayout />} path="/manage">
          <Route element={<ManageLandingRedirect />} index />
          <Route element={<ManageLandingRedirect />} path="legacy" />
          <Route element={<LocationProbe />} path="leagues" />
          <Route element={<LocationProbe />} path="sports" />
          <Route element={<div>Plans body</div>} path="plans" />
          <Route element={<div>Detail body</div>} path="content-configuration/:templateKey" />
          <Route element={<div>Providers body</div>} path="providers" />
          <Route element={<EntityHomeProbe />} path="users/:userId" />
          <Route element={<div>League page body</div>} path="sports/golf/leagues/:leagueId/participants" />
          <Route element={<div>Event field body</div>} path="sports/golf/events/:eventId/field" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RootAdminManageLayout', () => {
  it('opens the Sports page when a root admin goes to /manage itself', () => {
    renderManage('/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports');
  });

  it('sends an old Manage link to the Sports page', () => {
    renderManage('/manage/legacy');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports');
  });

  it('shows Manage on the tools frame: a band with the way out, then the menu Sports to Pricing as top tabs, marking the open one', () => {
    renderManage('/manage/plans');

    const band = screen.getByTestId('root-admin-manage-layout-band');
    expect(within(band).getByText('Root admin')).toBeInTheDocument();
    expect(within(band).getByText('Manage')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Manage' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Sports',
      'Activity',
      'Notifications',
      'Providers',
      'Customers',
      'Plans',
      'Pricing',
    ]);
    expect(screen.getByTestId('root-admin-manage-menu-plans')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-sports')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('root-admin-manage-exit')).toHaveAttribute('href', '/');
    expect(screen.queryByRole('navigation', { name: 'Sports' })).not.toBeInTheDocument();
  });

  it('under Sports, lights Sports and adds no second row', () => {
    renderManage('/manage/sports/golf/events/evt-1/field');

    expect(screen.getByTestId('root-admin-manage-menu-sports')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'Sports' })).not.toBeInTheDocument();
  });

  it('leaves the title to the page and shows no trail on a page at its tab\'s level', () => {
    renderManage('/manage/leagues');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
  });

  it('shows a page under a sport the trail from the sport, skipping the sport\'s old list page', () => {
    renderManage('/manage/sports/golf/events/evt-1/field');

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Golf' })).toHaveAttribute('href', '/manage/sports/golf');
    expect(within(breadcrumbNav).queryByText('Tournaments')).not.toBeInTheDocument();
    expect(within(breadcrumbNav).getByText('Field')).toHaveAttribute('aria-current', 'page');
  });

  it('leaves a League page\'s trail to its own header', () => {
    renderManage('/manage/sports/golf/leagues/league-1/participants');

    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
    expect(screen.getByText('League page body')).toBeInTheDocument();
  });

  it('shows a deep page the trail back up to its tab, starting at the tab', () => {
    renderManage('/manage/content-configuration/golf-tiered-pick-6');

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).queryByText('Manage')).not.toBeInTheDocument();
    expect(within(breadcrumbNav).getByRole('link', { name: 'Contest templates' })).toHaveAttribute(
      'href',
      '/manage/content-configuration',
    );
    expect(within(breadcrumbNav).getByText('golf-tiered-pick-6')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-sports')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Detail body')).toBeInTheDocument();
  });

  it('lights Providers on the Providers page, whose menu item leads there, with no trail of its own', () => {
    renderManage('/manage/providers');

    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-menu-providers')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-providers')).toHaveAttribute('href', '/manage/providers');
    expect(screen.getByText('Providers body')).toBeInTheDocument();
  });

  it('names an entity in the trail by the name its page gives', () => {
    renderManage('/manage/users/user-2');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/manage/users');
    expect(within(breadcrumbNav).getByText('Target User')).toHaveAttribute('aria-current', 'page');
  });
});
