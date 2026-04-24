import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UserRouteScaffoldPage } from './user-route-scaffold-page';

describe('UserRouteScaffoldPage', () => {
  it('renders the truthful placeholder route for the future canonical user page', () => {
    render(
      <MemoryRouter initialEntries={['/users/user-42']}>
        <Routes>
          <Route element={<UserRouteScaffoldPage />} path="/users/:userId" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('user-route-scaffold-page')).toBeInTheDocument();
    expect(screen.getByText('user-42')).toBeInTheDocument();
    expect(screen.getByTestId('user-route-scaffold-link-my-account')).toHaveAttribute(
      'href',
      '/my-account',
    );
  });
});
