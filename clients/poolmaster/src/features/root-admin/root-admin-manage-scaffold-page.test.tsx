import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminManageScaffoldPage } from './root-admin-manage-scaffold-page';

describe('RootAdminManageScaffoldPage', () => {
  it('routes legacy-backed sections back to the transitional manage surface', () => {
    render(
      <MemoryRouter>
        <RootAdminManageScaffoldPage sectionKey="leagues" />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId('root-admin-manage-scaffold-page-leagues'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-manage-scaffold-legacy-leagues'),
    ).toHaveAttribute('href', '/manage/legacy');
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
