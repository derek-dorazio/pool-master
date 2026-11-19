import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ParticipantLinkRedirect } from './participant-link-redirect';
import { participantFixture } from './sport-test-fixtures';

// A participant's old Manage address (#1866) opens its league's Participants tab.

const { getParticipantMock } = vi.hoisted(() => ({ getParticipantMock: vi.fn() }));

bindApiMocks({ getParticipant: getParticipantMock });

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ParticipantLinkRedirect />} path="/manage/sports/:sport/participants/:participantId/*" />
          <Route element={<LocationProbe />} path="*" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ParticipantLinkRedirect', () => {
  afterEach(() => vi.clearAllMocks());

  it('opens the participant\'s own league\'s Participants tab, from its page and its edit page', async () => {
    getParticipantMock.mockResolvedValue({ data: { participant: participantFixture({ id: 'p-1', sportLeagueId: 'league-9' }) } });
    renderAt('/manage/sports/golf/participants/p-1/edit');

    expect(await screen.findByTestId('location')).toHaveTextContent('/manage/sports/golf/leagues/league-9/participants');
    expect(getParticipantMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'p-1' } }));
  });

  it('opens the Sports page when the participant cannot be read', async () => {
    getParticipantMock.mockResolvedValue({ error: { message: 'Not found' }, response: new Response(null, { status: 404 }) });
    renderAt('/manage/sports/golf/participants/p-gone');

    expect(await screen.findByTestId('location')).toHaveTextContent(/^\/manage\/sports$/);
  });
});
