import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './account-menu';

function renderMenu(props: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  const onLogout = vi.fn();
  const utils = render(
    <MemoryRouter>
      <AccountMenu
        onLogout={onLogout}
        profilePath="/users/user-1"
        userName="Derek Dorazio"
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onLogout };
}

describe('AccountMenu', () => {
  it('hides the Manage link by default', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.queryByTestId('account-menu-manage')).not.toBeInTheDocument();
  });

  it('hides the Manage link when the user is not a root admin', () => {
    renderMenu({ isRootAdmin: false });
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.queryByTestId('account-menu-manage')).not.toBeInTheDocument();
  });

  it('shows a Manage link pointing at /manage when the user is a root admin', () => {
    renderMenu({ isRootAdmin: true });
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    const link = screen.getByTestId('account-menu-manage');
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', '/manage');
  });

  it('closes the menu when the Manage link is clicked', () => {
    renderMenu({ isRootAdmin: true });
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.getByTestId('account-menu-panel')).toBeVisible();
    fireEvent.click(screen.getByTestId('account-menu-manage'));
    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
  });

  it('links Profile to the canonical user route', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.getByTestId('account-menu-profile')).toHaveAttribute('href', '/users/user-1');
  });

  it('closes the menu when the Profile link is clicked', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    fireEvent.click(screen.getByTestId('account-menu-profile'));
    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
  });

  it('closes the menu and signs the user out when Log out is clicked', () => {
    const { onLogout } = renderMenu();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    fireEvent.click(screen.getByTestId('account-menu-logout'));
    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('closes the open account menu when the user clicks outside it', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.getByTestId('account-menu-panel')).toBeVisible();

    await user.click(document.body);

    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
  });

  it('closes the open account menu on Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.getByTestId('account-menu-panel')).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('account-menu-trigger')).toHaveFocus();
  });
});
