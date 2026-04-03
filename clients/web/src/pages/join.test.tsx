import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Component as JoinPage } from './join';

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: false }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useMutation: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    }),
  };
});

function renderJoin(initialEntry = '/join/invite-123') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/join/:inviteCode" element={<JoinPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JoinPage', () => {
  it('renders auth CTAs for signed-out users', () => {
    renderJoin();
    expect(screen.getByRole('heading', { name: 'Join League' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Log In To Join/i })).toHaveAttribute(
      'href',
      '/login?redirectTo=%2Fjoin%2Finvite-123',
    );
    expect(screen.getByRole('link', { name: /Create Account/i })).toHaveAttribute(
      'href',
      '/register?redirectTo=%2Fjoin%2Finvite-123',
    );
  });
});
