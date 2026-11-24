import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { StartEntryButton } from './start-entry-button';

const { enterContestMock } = vi.hoisted(() => ({ enterContestMock: vi.fn() }));

bindApiMocks({ enterContest: enterContestMock });

const REFUSAL = 'You already have the most entries this contest allows.';

function renderButton() {
  enterContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_ENTRY_LIMIT_REACHED', message: REFUSAL } }, status: 409 });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <StartEntryButton contestId="contest-1" label="Make your picks" leagueCode="BIGDAWGS" testId="start" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId('start'));
}

afterEach(() => {
  enterContestMock.mockReset();
});

describe('StartEntryButton — a refused new entry', () => {
  it('shows the refusal in a danger notice on an ordinary page', async () => {
    renderButton();

    const refusal = await screen.findByTestId('start-error');
    expect(refusal).toHaveTextContent(REFUSAL);
    expect(refusal).toHaveClass('rounded-lg');
  });
});
