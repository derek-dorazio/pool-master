import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { sportEventFixture } from './sport-test-fixtures';
import { ManageSportEventRoute } from './manage-sport-event-route';
import { ManageSportRoute } from './manage-sport-route';

// An event's Manage pages read their words from the URL's sport and their results card from the
// event's own sport, so a URL naming another sport than the event's is sent to the event's own.

const { getEventMock } = vi.hoisted(() => ({ getEventMock: vi.fn() }));

bindApiMocks({ getEvent: getEventMock });

function CurrentPath() {
  return <p data-testid="current-path">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ManageSportRoute />} path="/manage/sports/:sport">
            <Route element={<ManageSportEventRoute />} path="events/:eventId">
              <Route element={<CurrentPath />} index />
              <Route element={<CurrentPath />} path="results" />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('an event page under another sport\'s URL', () => {
  it('redirects a golf event opened under horse racing to the same page under golf', async () => {
    getEventMock.mockResolvedValue({ data: { event: sportEventFixture({ id: 'evt-1', sport: 'GOLF' }) } });

    renderAt('/manage/sports/horse-racing/events/evt-1/results');

    expect(await screen.findByText('/manage/sports/golf/events/evt-1/results')).toBeInTheDocument();
  });

  it('keeps an event opened under its own sport where it is', async () => {
    getEventMock.mockResolvedValue({ data: { event: sportEventFixture({ id: 'evt-2', sport: 'HORSE_RACING' }) } });

    renderAt('/manage/sports/horse-racing/events/evt-2');

    expect(await screen.findByText('/manage/sports/horse-racing/events/evt-2')).toBeInTheDocument();
  });
});
