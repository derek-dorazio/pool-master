import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuCheck,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

function TestMenu({ name, onPick = () => undefined }: { name: string; onPick?: (item: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger testId={`${name}-trigger`}>{name}</DropdownMenuTrigger>
      <DropdownMenuContent testId={`${name}-menu`} width="md">
        <DropdownMenuLabel>Choices</DropdownMenuLabel>
        <DropdownMenuItem data-testid={`${name}-first`} isSelected onSelect={() => onPick('first')}>
          <DropdownMenuItemText detail="Second line" name="First" />
          <DropdownMenuCheck />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid={`${name}-second`} onSelect={() => onPick('second')}>
          <DropdownMenuItemText isMuted name="Second" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A page outside the menu that moves to another route, as the browser's back button would. */
function NavigateAway() {
  const navigate = useNavigate();
  return (
    <button data-testid="navigate-away" onClick={() => void navigate('/elsewhere')} type="button">
      Go elsewhere
    </button>
  );
}

function renderMenus(onPick?: (item: string) => void) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/start']}>
      <TestMenu name="alpha" onPick={onPick} />
      <TestMenu name="beta" />
      <Routes>
        <Route element={<NavigateAway />} path="/start" />
        <Route element={<Link to="/start">Back</Link>} path="/elsewhere" />
      </Routes>
    </MemoryRouter>,
  );
  return { user };
}

describe('DropdownMenu', () => {
  it('opens on a click of its button and marks the button expanded', async () => {
    const { user } = renderMenus();
    const trigger = screen.getByTestId('alpha-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(screen.getByTestId('alpha-menu')).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it.each([['{Enter}'], [' '], ['{ArrowDown}']])('opens from the keyboard on %s', async (key) => {
    const { user } = renderMenus();
    screen.getByTestId('alpha-trigger').focus();

    await user.keyboard(key);

    expect(screen.getByTestId('alpha-menu')).toBeVisible();
  });

  it('moves between items with the arrow keys and chooses one with Enter, then closes', async () => {
    const onPick = vi.fn();
    const { user } = renderMenus(onPick);
    screen.getByTestId('alpha-trigger').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('alpha-first')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('alpha-second')).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onPick).toHaveBeenCalledWith('second');
    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('alpha-trigger')).toHaveFocus();
  });

  it('closes when an item is clicked', async () => {
    const onPick = vi.fn();
    const { user } = renderMenus(onPick);
    await user.click(screen.getByTestId('alpha-trigger'));

    await user.click(screen.getByTestId('alpha-first'));

    expect(onPick).toHaveBeenCalledWith('first');
    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to its button', async () => {
    const { user } = renderMenus();
    await user.click(screen.getByTestId('alpha-trigger'));

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('alpha-trigger')).toHaveFocus();
  });

  it('closes on a click outside it, and the click still reaches what it landed on', async () => {
    const { user } = renderMenus();
    await user.click(screen.getByTestId('alpha-trigger'));

    await user.click(screen.getByTestId('navigate-away'));

    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('navigate-away')).not.toBeInTheDocument();
  });

  it('closes on a second click of its button', async () => {
    const { user } = renderMenus();
    await user.click(screen.getByTestId('alpha-trigger'));

    await user.click(screen.getByTestId('alpha-trigger'));

    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
  });

  it('closes when the page changes while it is open', async () => {
    const { user } = renderMenus();
    screen.getByTestId('alpha-trigger').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('alpha-menu')).toBeVisible();

    // A route change that does not come from a click outside, as the browser's back button makes.
    fireEvent.click(screen.getByTestId('navigate-away'));

    expect(await screen.findByText('Back')).toBeVisible();
    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
  });

  it('stays closed on coming back to the page it was opened on', async () => {
    const { user } = renderMenus();
    screen.getByTestId('alpha-trigger').focus();
    await user.keyboard('{ArrowDown}');
    fireEvent.click(screen.getByTestId('navigate-away'));
    await screen.findByText('Back');

    fireEvent.click(screen.getByText('Back'));

    expect(await screen.findByTestId('navigate-away')).toBeVisible();
    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
  });

  it('stays open when the pointer moves away from it', async () => {
    const { user } = renderMenus();
    await user.click(screen.getByTestId('alpha-trigger'));

    await user.hover(screen.getByTestId('alpha-first'));
    await user.unhover(screen.getByTestId('alpha-menu'));
    await user.hover(document.body);

    expect(screen.getByTestId('alpha-menu')).toBeVisible();
  });

  it('keeps only one menu open: opening a second menu closes the first', async () => {
    const { user } = renderMenus();
    await user.click(screen.getByTestId('alpha-trigger'));

    await user.click(screen.getByTestId('beta-trigger'));

    expect(screen.queryByTestId('alpha-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('beta-menu')).toBeVisible();
  });

  it('marks the selected item and mutes a muted name', async () => {
    const { user } = renderMenus();
    await user.click(screen.getByTestId('alpha-trigger'));

    expect(screen.getByTestId('alpha-first')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('alpha-second')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Second')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Second line')).toBeVisible();
  });
});
