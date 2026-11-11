import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './account-menu';

function renderMenu(props: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  const onLogout = vi.fn();
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter>
      <AccountMenu
        initials="DD"
        onLogout={onLogout}
        profilePath="/users/user-1"
        userName="Derek Dorazio"
        {...props}
      />
    </MemoryRouter>,
  );
  const openMenu = () => user.click(screen.getByTestId('account-menu-trigger'));
  return { ...utils, onLogout, openMenu, user };
}

describe('AccountMenu', () => {
  it('shows the initials, not the name, on its button, and names the account for screen readers', () => {
    renderMenu();
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger).toHaveTextContent('DD');
    expect(trigger).not.toHaveTextContent('Derek');
    expect(trigger).toHaveAccessibleName('Account menu for Derek Dorazio');
  });

  it('shows a person icon in place of initials when the account has no name', () => {
    renderMenu({ initials: null, userName: 'Account' });
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger).toHaveTextContent('');
    expect(within(trigger).getByTestId('account-menu-person-icon')).toBeInTheDocument();
  });

  it('shows the full name in the open menu', async () => {
    const { openMenu } = renderMenu();
    await openMenu();
    expect(screen.getByTestId('account-menu-identity')).toHaveTextContent('Derek Dorazio');
  });

  it('hides the Manage link by default', async () => {
    const { openMenu } = renderMenu();
    await openMenu();
    expect(screen.queryByTestId('account-menu-manage')).not.toBeInTheDocument();
  });

  it('hides the Manage link when the user is not a root admin', async () => {
    const { openMenu } = renderMenu({ isRootAdmin: false });
    await openMenu();
    expect(screen.queryByTestId('account-menu-manage')).not.toBeInTheDocument();
  });

  it('shows a Manage link pointing at /manage when the user is a root admin', async () => {
    const { openMenu } = renderMenu({ isRootAdmin: true });
    await openMenu();
    const link = screen.getByTestId('account-menu-manage');
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', '/manage');
  });

  it('closes the menu when the Manage link is clicked', async () => {
    const { openMenu, user } = renderMenu({ isRootAdmin: true });
    await openMenu();
    expect(screen.getByTestId('account-menu-panel')).toBeVisible();
    await user.click(screen.getByTestId('account-menu-manage'));
    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
  });

  it('links Profile to the canonical user route', async () => {
    const { openMenu } = renderMenu();
    await openMenu();
    expect(screen.getByTestId('account-menu-profile')).toHaveAttribute('href', '/users/user-1');
  });

  it('closes the menu when the Profile link is clicked', async () => {
    const { openMenu, user } = renderMenu();
    await openMenu();
    await user.click(screen.getByTestId('account-menu-profile'));
    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
  });

  it('closes the menu and signs the user out when Log out is clicked', async () => {
    const { onLogout, openMenu, user } = renderMenu();
    await openMenu();
    await user.click(screen.getByTestId('account-menu-logout'));
    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('closes the open account menu when the user clicks outside it', async () => {
    const { openMenu, user } = renderMenu();
    await openMenu();
    expect(screen.getByTestId('account-menu-panel')).toBeVisible();

    await user.click(document.body);

    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
  });

  it('closes the open account menu on Escape and returns focus to its trigger', async () => {
    const { openMenu, user } = renderMenu();
    await openMenu();
    expect(screen.getByTestId('account-menu-panel')).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('account-menu-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('account-menu-trigger')).toHaveFocus();
  });
});
