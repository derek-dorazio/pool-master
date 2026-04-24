import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminManageScaffoldPage } from './root-admin-manage-scaffold-page';

describe('RootAdminManageScaffoldPage', () => {
  it('shows the dedicated-surface note for live sections', () => {
    render(
      <MemoryRouter>
        <RootAdminManageScaffoldPage sectionKey="content-configuration" />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('root-admin-manage-scaffold-page-content-configuration'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/already has a dedicated surface/i),
    ).toBeInTheDocument();
  });

  it('renders a blocker note for backend-blocked sections', () => {
    render(
      <MemoryRouter>
        <RootAdminManageScaffoldPage sectionKey="teams" />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('root-admin-manage-scaffold-page-teams'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/waiting on backend work/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-manage-scaffold-legacy-teams'),
    ).not.toBeInTheDocument();
  });
});
