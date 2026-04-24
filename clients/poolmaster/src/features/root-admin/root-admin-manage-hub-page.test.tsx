import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminManageHubPage } from './root-admin-manage-hub-page';

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
    expect(screen.getAllByText('Live now')).toHaveLength(2);
    expect(screen.getAllByText('Temporary scaffold')).toHaveLength(3);
    expect(screen.getByText('Blocked by backend')).toBeInTheDocument();
  });
});
