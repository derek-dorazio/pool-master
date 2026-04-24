import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RootAdminManageLayout } from './root-admin-manage-layout';

describe('RootAdminManageLayout', () => {
  it('renders breadcrumbs for nested manage routes', () => {
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
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/manage',
    );
    expect(
      screen.getByRole('link', { name: 'Content Configuration' }),
    ).toHaveAttribute('href', '/manage/content-configuration');
    expect(screen.getByText('golf-tiered-pick-6')).toBeInTheDocument();
    expect(screen.getByText('Detail body')).toBeInTheDocument();
  });
});
