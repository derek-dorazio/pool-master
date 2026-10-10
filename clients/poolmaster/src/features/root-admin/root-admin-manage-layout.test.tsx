import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { ManageLandingRedirect, RootAdminManageLayout } from './root-admin-manage-layout';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function EntityHomeProbe() {
  useManagePageOwnsHeading();
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
          <Route element={<div>Detail body</div>} path="content-configuration/:templateKey" />
          <Route element={<div>Ingestion schedule body</div>} path="settings/ingestion-schedule" />
          <Route element={<EntityHomeProbe />} path="users/:userId" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RootAdminManageLayout', () => {
  it('opens the Leagues section when a root admin goes to /manage itself', () => {
    renderManage('/manage');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/leagues');
  });

  it('sends an old Manage link to the Leagues section', () => {
    renderManage('/manage/legacy');

    expect(screen.getByTestId('location')).toHaveTextContent('/manage/leagues');
  });

  it('shows every section in a side menu grouped as Platform, Sports and Operations, marking the current one', () => {
    renderManage('/manage/leagues');

    const menu = screen.getByRole('navigation', { name: 'Manage' });
    const links = within(menu).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual([
      'Leagues',
      'Users',
      'Golf',
      'Content Configuration',
      'Events',
      'Sync',
      'Settings',
    ]);
    expect(within(menu).getByText('Platform')).toBeInTheDocument();
    expect(within(menu).getByText('Sports')).toBeInTheDocument();
    expect(within(menu).getByText('Operations')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-menu-leagues')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-users')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('root-admin-manage-exit')).toHaveAttribute('href', '/');
  });

  it('titles a section page by its menu entry and shows no breadcrumb trail', () => {
    renderManage('/manage/leagues');

    expect(screen.getByRole('heading', { name: 'Leagues', level: 1 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Manage breadcrumbs')).not.toBeInTheDocument();
  });

  it('shows a deep page the trail back up to its section, starting at the section', () => {
    renderManage('/manage/content-configuration/golf-tiered-pick-6');

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(screen.getByRole('heading', { name: 'golf-tiered-pick-6', level: 1 })).toBeInTheDocument();
    expect(within(breadcrumbNav).queryByText('Manage')).not.toBeInTheDocument();
    expect(within(breadcrumbNav).getByRole('link', { name: 'Content Configuration' })).toHaveAttribute(
      'href',
      '/manage/content-configuration',
    );
    expect(within(breadcrumbNav).getByText('golf-tiered-pick-6')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-manage-menu-content-configuration')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Detail body')).toBeInTheDocument();
  });

  it('titles the ingestion schedule under Settings, marking Settings in the menu', () => {
    renderManage('/manage/settings/ingestion-schedule');

    expect(screen.getByRole('heading', { name: 'Global Ingestion Schedule', level: 1 })).toBeInTheDocument();
    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/manage/settings');
    expect(screen.getByTestId('root-admin-manage-menu-settings')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Ingestion schedule body')).toBeInTheDocument();
  });

  it('leaves the title to an entity home that shows its own heading, keeping the trail with its name', () => {
    renderManage('/manage/users/user-2');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(within(breadcrumbNav).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/manage/users');
    expect(within(breadcrumbNav).getByText('Target User')).toHaveAttribute('aria-current', 'page');
  });
});
