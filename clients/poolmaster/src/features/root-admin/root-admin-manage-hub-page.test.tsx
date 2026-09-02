import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminManageHubPage } from './root-admin-manage-hub-page';

// plans/124 §6.1 — /manage groups sections by axis (Platform / Sports / Operations),
// with Golf as the first Sports entry (pool-master-3dg).
describe('RootAdminManageHubPage', () => {
  it('renders the manage sections with canonical links', () => {
    render(
      <MemoryRouter>
        <RootAdminManageHubPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('root-admin-manage-hub-page')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-link-content-configuration')).toHaveAttribute(
      'href',
      '/manage/content-configuration',
    );
    expect(screen.getByTestId('root-admin-manage-link-sync')).toHaveAttribute(
      'href',
      '/manage/sync',
    );
    expect(screen.getByTestId('root-admin-manage-link-teams')).toHaveAttribute(
      'href',
      '/manage/teams',
    );
    expect(screen.queryByText('Live now')).not.toBeInTheDocument();
    expect(screen.queryByText('Temporary scaffold')).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked by backend')).not.toBeInTheDocument();
  });

  it('pool-master-3dg groups Golf under a Sports heading linking to /manage/golf', () => {
    render(
      <MemoryRouter>
        <RootAdminManageHubPage />
      </MemoryRouter>,
    );

    const sportsGroup = screen.getByTestId('root-admin-manage-group-sports');
    expect(within(sportsGroup).getByRole('heading', { name: 'Sports' })).toBeInTheDocument();
    expect(within(sportsGroup).getByTestId('root-admin-manage-link-golf')).toHaveAttribute(
      'href',
      '/manage/golf',
    );

    const platformGroup = screen.getByTestId('root-admin-manage-group-platform');
    expect(
      within(platformGroup).getByTestId('root-admin-manage-link-leagues'),
    ).toBeInTheDocument();
  });
});
