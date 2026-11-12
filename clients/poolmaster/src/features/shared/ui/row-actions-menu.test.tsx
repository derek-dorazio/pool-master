import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RowActionsMenu, type RowAction } from './row-actions-menu';

function renderMenu(actions: RowAction[]) {
  return render(
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route element={<RowActionsMenu actions={actions} label="Actions for Masters Pool" testId="row-actions" />} path="/list" />
        <Route element={<p>Opened page</p>} path="/opened" />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RowActionsMenu', () => {
  it('shows no button when the row has no quick actions', () => {
    renderMenu([]);

    expect(screen.queryByRole('button', { name: 'Actions for Masters Pool' })).not.toBeInTheDocument();
  });

  it('opens from a button named for the row and runs the chosen action, then closes', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderMenu([{ label: 'Delete', onSelect: onDelete, testId: 'row-delete', tone: 'danger' }]);

    await user.click(screen.getByRole('button', { name: 'Actions for Masters Pool' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByText('Delete')).toHaveClass('text-destructive');

    await user.click(screen.getByTestId('row-delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a link action as a page in the app', async () => {
    const user = userEvent.setup();
    renderMenu([{ label: 'View team page', testId: 'row-view', to: '/opened' }]);

    await user.click(screen.getByRole('button', { name: 'Actions for Masters Pool' }));
    expect(screen.getByRole('menuitem', { name: 'View team page' })).toHaveAttribute('href', '/opened');
    expect(screen.getByText('View team page')).not.toHaveClass('text-destructive');

    await user.click(screen.getByTestId('row-view'));
    expect(await screen.findByText('Opened page')).toBeInTheDocument();
  });

  it('opens from the keyboard and moves through its items with the arrow keys', async () => {
    const user = userEvent.setup();
    renderMenu([
      { label: 'Resend', onSelect: vi.fn() },
      { label: 'Cancel invite', onSelect: vi.fn(), tone: 'danger' },
    ]);

    screen.getByRole('button', { name: 'Actions for Masters Pool' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Cancel invite' })).toHaveFocus();
  });
});
