import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EntryRenameSection } from './entry-rename-section';

const { updateContestEntryMock } = vi.hoisted(() => ({ updateContestEntryMock: vi.fn() }));

bindApiMocks({ updateContestEntry: updateContestEntryMock });

function renderSection(savedName = 'Birdie Hunters 1') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntryRenameSection contestId="contest-1" entryId="entry-1" savedName={savedName} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  updateContestEntryMock.mockReset();
});

describe('EntryRenameSection — an entry\'s name on its pick screen', () => {
  it('shows the saved name with no Save until it is changed', () => {
    renderSection();

    expect(screen.getByTestId('contest-entry-rename-input')).toHaveValue('Birdie Hunters 1');
    expect(screen.queryByTestId('contest-entry-rename-save')).not.toBeInTheDocument();
  });

  it('saves the new name, trimmed, for this entry', async () => {
    updateContestEntryMock.mockResolvedValue({ data: { entry: { id: 'entry-1', name: 'Eagle Eyes' } } });
    renderSection();

    fireEvent.change(screen.getByTestId('contest-entry-rename-input'), { target: { value: '  Eagle Eyes ' } });
    fireEvent.click(screen.getByTestId('contest-entry-rename-save'));

    await waitFor(() => expect(updateContestEntryMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: 'Eagle Eyes' },
      path: { contestId: 'contest-1', entryId: 'entry-1' },
    })));
  });

  it('keeps the typed name and shows the refusal when the name is taken, and Cancel puts the saved name back', async () => {
    updateContestEntryMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_ENTRY_NAME_TAKEN', message: 'Your team already has an entry with that name.' } },
      status: 409,
    });
    renderSection();

    fireEvent.change(screen.getByTestId('contest-entry-rename-input'), { target: { value: 'Birdie Hunters 2' } });
    fireEvent.click(screen.getByTestId('contest-entry-rename-save'));

    expect(await screen.findByText('Your team already has an entry with that name.')).toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-rename-input')).toHaveValue('Birdie Hunters 2');

    fireEvent.click(screen.getByTestId('contest-entry-rename-cancel'));
    expect(screen.getByTestId('contest-entry-rename-input')).toHaveValue('Birdie Hunters 1');
    expect(screen.queryByText('Your team already has an entry with that name.')).not.toBeInTheDocument();
  });
});
