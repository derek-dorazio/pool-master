import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_LEAGUES_PATH } from '@/features/root-admin/manage-navigation';
import { bindApiMocks } from '@/test/msw-api';
import { buildLeague } from './test/fixtures';
import { LeagueDangerZone } from './league-danger-zone';

const { authState, inactivateLeagueMock, activateLeagueMock, deleteLeagueMock } = vi.hoisted(() => ({
  authState: { isRootAdmin: false },
  inactivateLeagueMock: vi.fn(),
  activateLeagueMock: vi.fn(),
  deleteLeagueMock: vi.fn(),
}));

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => authState }));
bindApiMocks({ inactivateLeague: inactivateLeagueMock, activateLeague: activateLeagueMock, deleteLeague: deleteLeagueMock });

const ACTIVE = buildLeague({ id: 'league-1', leagueCode: 'BIGDAWGS', isActive: true });
const INACTIVE = buildLeague({ id: 'league-1', leagueCode: 'BIGDAWGS', isActive: false });

function renderZone(league = ACTIVE) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/settings']}>
        <Routes>
          <Route element={<LeagueDangerZone league={league} />} path="/league/BIGDAWGS/settings" />
          <Route element={<p>Welcome page</p>} path="/welcome" />
          <Route element={<p>Customer leagues</p>} path={CUSTOMER_LEAGUES_PATH} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pressEscape() {
  await userEvent.keyboard('{Escape}');
}

const REFUSED = { error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'No such league.' } }, status: 404 };

afterEach(() => {
  vi.clearAllMocks();
  authState.isRootAdmin = false;
});

describe('LeagueDangerZone inactivate and activate', () => {
  it('inactivates an active league once confirmed, closing the dialog', async () => {
    inactivateLeagueMock.mockResolvedValue({ data: { league: INACTIVE } });
    renderZone();

    fireEvent.click(screen.getByTestId('league-inactivate-open'));
    fireEvent.click(screen.getByTestId('league-inactivate'));

    await waitFor(() => expect(screen.queryByTestId('league-inactivate-modal')).not.toBeInTheDocument());
    expect(inactivateLeagueMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('shows a refused inactivation in the dialog, which Escape then closes', async () => {
    inactivateLeagueMock.mockResolvedValue(REFUSED);
    renderZone();

    fireEvent.click(screen.getByTestId('league-inactivate-open'));
    fireEvent.click(screen.getByTestId('league-inactivate'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await pressEscape();

    await waitFor(() => expect(screen.queryByTestId('league-inactivate-modal')).not.toBeInTheDocument());
  });

  it('keeps the inactivate dialog open on Escape while it is still inactivating', async () => {
    inactivateLeagueMock.mockReturnValue(new Promise(() => undefined));
    renderZone();

    fireEvent.click(screen.getByTestId('league-inactivate-open'));
    fireEvent.click(screen.getByTestId('league-inactivate'));
    await screen.findByText('Inactivating...');
    await pressEscape();

    expect(screen.getByTestId('league-inactivate-modal')).toBeInTheDocument();
  });

  it('activates an inactive league again, and shows a refusal beside the button', async () => {
    activateLeagueMock.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce({ data: { league: ACTIVE } });
    renderZone(INACTIVE);

    fireEvent.click(screen.getByTestId('league-activate'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('league-activate'));

    await waitFor(() => expect(activateLeagueMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('LeagueDangerZone delete', () => {
  it('keeps Delete off for an active league', () => {
    renderZone();

    expect(screen.getByTestId('league-delete-open')).toBeDisabled();
  });

  it('deletes an inactive league once its code is typed back, then sends a member to the welcome page', async () => {
    deleteLeagueMock.mockResolvedValue({ data: { success: true } });
    renderZone(INACTIVE);

    fireEvent.click(screen.getByTestId('league-delete-open'));
    expect(screen.getByTestId('league-delete-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('league-delete-confirmation'), { target: { value: ' bigdawgs ' } });
    fireEvent.click(screen.getByTestId('league-delete-submit'));

    expect(await screen.findByText('Welcome page')).toBeInTheDocument();
    expect(deleteLeagueMock).toHaveBeenCalledWith(expect.objectContaining({ body: { leagueCode: 'BIGDAWGS' } }));
  });

  it('sends a root admin back to the customer leagues list after a delete', async () => {
    authState.isRootAdmin = true;
    deleteLeagueMock.mockResolvedValue({ data: { success: true } });
    renderZone(INACTIVE);

    fireEvent.click(screen.getByTestId('league-delete-open'));
    fireEvent.change(screen.getByTestId('league-delete-confirmation'), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(screen.getByTestId('league-delete-submit'));

    expect(await screen.findByText('Customer leagues')).toBeInTheDocument();
  });

  it('shows a refused delete in the dialog, and forgets the typed code and the refusal when closed', async () => {
    deleteLeagueMock.mockResolvedValue(REFUSED);
    renderZone(INACTIVE);

    fireEvent.click(screen.getByTestId('league-delete-open'));
    fireEvent.change(screen.getByTestId('league-delete-confirmation'), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(screen.getByTestId('league-delete-submit'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await pressEscape();
    await waitFor(() => expect(screen.queryByTestId('league-delete-modal')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('league-delete-open'));
    expect(screen.getByTestId('league-delete-confirmation')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the delete dialog open on Escape while it is still deleting', async () => {
    deleteLeagueMock.mockReturnValue(new Promise(() => undefined));
    renderZone(INACTIVE);

    fireEvent.click(screen.getByTestId('league-delete-open'));
    fireEvent.change(screen.getByTestId('league-delete-confirmation'), { target: { value: 'BIGDAWGS' } });
    fireEvent.click(screen.getByTestId('league-delete-submit'));
    await screen.findByText('Deleting...');
    await pressEscape();

    expect(screen.getByTestId('league-delete-modal')).toBeInTheDocument();
  });
});
