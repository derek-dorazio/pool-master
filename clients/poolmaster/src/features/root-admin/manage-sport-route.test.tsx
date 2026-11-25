import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ManageSportRoute } from './manage-sport-route';
import { SPORTS_FIXTURE, sportsQueryClient } from './sport-test-fixtures';

// `/manage/sports/:sport` finds its sport by the sport's stored URL segment (#2042): a segment
// that names a sport shows its pages, one that names none stops at a plain message.

const { listSportsMock } = vi.hoisted(() => ({ listSportsMock: vi.fn() }));

bindApiMocks({ listSports: listSportsMock });

function renderAt(path: string, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ManageSportRoute />} path="/manage/sports/:sport">
            <Route element={<p>Sport pages</p>} index />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('ManageSportRoute', () => {
  it('shows the pages under a sport named by its stored URL segment', () => {
    renderAt('/manage/sports/horse-racing', sportsQueryClient());

    expect(screen.getByText('Sport pages')).toBeInTheDocument();
  });

  it('stops at "We don\'t manage that sport." for a segment that names no sport, such as the sport\'s code', () => {
    renderAt('/manage/sports/HORSE_RACING', sportsQueryClient());

    expect(screen.getByTestId('root-admin-sport-not-found')).toHaveTextContent('We don\'t manage that sport.');
    expect(screen.queryByText('Sport pages')).not.toBeInTheDocument();
  });

  it('shows the loading message while the sports load, then the pages', async () => {
    listSportsMock.mockResolvedValue({ data: { sports: SPORTS_FIXTURE } });

    renderAt('/manage/sports/golf', freshClient());

    expect(screen.getByText('Loading the sport...')).toBeInTheDocument();
    expect(await screen.findByText('Sport pages')).toBeInTheDocument();
  });

  it('shows the sports error when the sports cannot be loaded', async () => {
    listSportsMock.mockResolvedValue({ error: { code: 'INTERNAL_ERROR', message: 'Down' } });

    renderAt('/manage/sports/golf', freshClient());

    expect(await screen.findByTestId('root-admin-sport-error')).toBeInTheDocument();
  });

  it('reads the sports again on Retry after they could not be loaded, then shows the pages', async () => {
    listSportsMock.mockResolvedValueOnce({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } }, status: 500 });
    listSportsMock.mockResolvedValue({ data: { sports: SPORTS_FIXTURE } });
    renderAt('/manage/sports/golf', freshClient());

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Sport pages')).toBeInTheDocument();
  });
});
