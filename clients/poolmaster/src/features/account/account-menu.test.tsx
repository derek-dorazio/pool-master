import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './account-menu';

function renderMenu(props: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  const onLogout = vi.fn();
  const utils = render(
    <MemoryRouter>
      <AccountMenu onLogout={onLogout} userName="Derek Dorazio" {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onLogout };
}

describe('AccountMenu', () => {
  it('hides the Manage link by default', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.queryByTestId('account-menu-manage')).toBeNull();
  });

  it('hides the Manage link when the user is not a root admin', () => {
    renderMenu({ isRootAdmin: false });
    fireEvent.click(screen.getByTestId('account-menu-trigger'));
    expect(screen.queryByTestId('account-menu-manage')).toBeNull();
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
    expect(screen.queryByTestId('account-menu-panel')).toBeNull();
  });
});
