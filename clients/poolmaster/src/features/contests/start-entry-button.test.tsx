import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { StartEntryButton } from './start-entry-button';

const { enterContestMock } = vi.hoisted(() => ({ enterContestMock: vi.fn() }));

bindApiMocks({ enterContest: enterContestMock });

const REFUSAL = 'Your team already has the most entries allowed.';

function renderButton(surface?: 'inverse') {
  enterContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_ENTRY_LIMIT_REACHED', message: REFUSAL } }, status: 409 });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <StartEntryButton contestId="contest-1" label="Make your picks" leagueCode="BIGDAWGS" surface={surface} testId="start" />
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

  it('shows the refusal as light alert text, not a light notice box, on a dark tile', async () => {
    renderButton('inverse');

    const refusal = await screen.findByTestId('start-error');
    expect(refusal).toHaveTextContent(REFUSAL);
    expect(refusal).toHaveAttribute('role', 'alert');
    expect(refusal).toHaveClass('text-on-inverse');
    expect(refusal).not.toHaveClass('rounded-lg');
  });
});
