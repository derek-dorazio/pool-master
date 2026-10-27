import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { UndoEmailChangePage } from './undo-email-change-page';

const { authState, undoEmailChangeMock } = vi.hoisted(() => ({
  authState: {
    user: null as { id: string } | null,
    isAuthenticated: false,
    isLoading: false,
    isRootAdmin: false,
    clearSession: vi.fn(),
  },
  undoEmailChangeMock: vi.fn(),
}));

bindApiMocks({
  undoEmailChange: undoEmailChangeMock,
});

vi.mock('./auth-context', () => ({
  useAuth: () => authState,
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current address">{`${location.pathname}${location.hash}`}</output>;
}

function renderPage(entry = '/undo-email-change#token=undo-token-123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={
              <>
                <UndoEmailChangePage />
                <LocationProbe />
              </>
            }
            path="/undo-email-change"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const putBack = () => fireEvent.click(screen.getByRole('button', { name: 'Put my address back' }));

describe('UndoEmailChangePage', () => {
  beforeEach(() => {
    undoEmailChangeMock.mockReset();
    authState.user = null;
    authState.clearSession.mockReset();
  });

  it('does nothing until the button is pressed, so a mail scanner opening the link changes nothing', async () => {
    renderPage();

    expect(await screen.findByLabelText('Current address')).toHaveTextContent(/^\/undo-email-change$/);
    expect(undoEmailChangeMock).not.toHaveBeenCalled();
  });

  it('sends the token from the link and then sends the person to set a new password', async () => {
    undoEmailChangeMock.mockResolvedValue({ data: { success: true } });
    renderPage();

    putBack();

    expect(await screen.findByTestId('undo-email-change-done')).toHaveTextContent('Your account uses your old email address again. Everyone is signed out of it, and its old password no longer works. Set a new password to sign in.');
    expect(undoEmailChangeMock).toHaveBeenCalledWith(expect.objectContaining({ body: { token: 'undo-token-123' } }));
    expect(screen.getByRole('link', { name: 'Set a new password' })).toHaveAttribute('href', '/forgot-password');
  });

  it("ends this browser's session too when a signed-in person puts their address back", async () => {
    authState.user = { id: 'user-1' };
    undoEmailChangeMock.mockResolvedValue({ data: { success: true } });
    renderPage();

    putBack();

    await screen.findByTestId('undo-email-change-done');
    expect(authState.clearSession).toHaveBeenCalledTimes(1);
  });

  it('shows the dead-link state when the link is used or expired', async () => {
    undoEmailChangeMock.mockResolvedValue({
      error: { error: { code: 'EMAIL_CHANGE_UNDO_LINK_INVALID', message: 'Dead link' } },
    });
    renderPage();

    putBack();

    expect(await screen.findByText('This link has expired or has already been used.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put my address back' })).not.toBeInTheDocument();
  });

  it('shows the dead-link state straight away when the link carries no token', () => {
    renderPage('/undo-email-change');

    expect(screen.getByText('This link has expired or has already been used.')).toBeInTheDocument();
  });

  it('says so, and keeps the button, when another account has the old address now', async () => {
    undoEmailChangeMock.mockResolvedValue({
      error: { error: { code: 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN', message: 'Taken' } },
    });
    renderPage();

    putBack();

    expect(await screen.findByTestId('undo-email-change-error')).toHaveTextContent("Another account uses that email address now, so it can't be put back.");
  });
});
