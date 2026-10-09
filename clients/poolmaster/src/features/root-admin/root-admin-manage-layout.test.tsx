import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminManageLayout } from './root-admin-manage-layout';

describe('RootAdminManageLayout', () => {
  it('pool-master-dxd.35 renders the page title and breadcrumbs in one admin header tile', () => {
    render(
      <MemoryRouter initialEntries={['/manage/content-configuration/golf-tiered-pick-6']}>
        <Routes>
          <Route element={<RootAdminManageLayout />} path="/manage">
            <Route
              element={<div>Detail body</div>}
              path="content-configuration/:templateKey"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const breadcrumbNav = screen.getByLabelText('Manage breadcrumbs');
    expect(breadcrumbNav).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'golf-tiered-pick-6', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/manage',
    );
    expect(
      screen.getByRole('link', { name: 'Content Configuration' }),
    ).toHaveAttribute('href', '/manage/content-configuration');
    expect(within(breadcrumbNav).getByText('golf-tiered-pick-6')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Detail body')).toBeInTheDocument();
  });

  it('pool-master-dxd.35 renders friendly breadcrumb labels for sync configuration sub-pages', () => {
    render(
      <MemoryRouter initialEntries={['/manage/sync-config/ingestion-schedule']}>
        <Routes>
          <Route element={<RootAdminManageLayout />} path="/manage">
            <Route
              element={<div>Sync config body</div>}
              path="sync-config/ingestion-schedule"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/manage',
    );
    expect(
      screen.getByRole('heading', { name: 'Global Ingestion Schedule', level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sync Configuration' }),
    ).toHaveAttribute('href', '/manage/sync-config');
    expect(
      within(screen.getByLabelText('Manage breadcrumbs')).getByText('Global Ingestion Schedule'),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Sync config body')).toBeInTheDocument();
  });
});
