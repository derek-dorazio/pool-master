import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeagueSelector } from './league-selector';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';

const { mockLogger } = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return { mockLogger };
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

describe('LeagueSelector', () => {
  afterEach(() => {
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('navigates to the selected league and logs the happy path', async () => {
    const onNavigate = vi.fn();
    const { user } = renderSelector(
      [
        buildLeague({ id: 'league-1', leagueCode: 'LEAGUE1', name: 'League One' }),
        buildLeague({ id: 'league-2', leagueCode: 'LEAGUE2', name: 'League Two', iconKey: 'FOOTBALL' }),
      ],
      'LEAGUE1',
      new Set(),
      { onNavigate },
    );

    await user.click(screen.getByTestId('league-selector-toggle'));
    await user.click(screen.getByTestId('league-selector-option-LEAGUE2'));

    expect(onNavigate).toHaveBeenCalledWith('/league/LEAGUE2');
    expect(screen.queryByTestId('league-selector-menu')).not.toBeInTheDocument();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leagueSelector.navigate',
      }),
      expect.any(String),
    );
  });

  it('logs the create-league request branch and closes the menu', async () => {
    const onCreateLeague = vi.fn();
    const { user } = renderSelector([], null, new Set(), { onCreateLeague });

    await user.click(screen.getByTestId('league-selector-toggle'));
    await user.click(screen.getByTestId('league-selector-create'));

    expect(onCreateLeague).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('league-selector-menu')).not.toBeInTheDocument();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leagueSelector.createRequested',
      }),
      expect.any(String),
    );
  });

  it('marks the current league with a check and the selected accent, and no other league', async () => {
    const { user } = renderSelector([
      buildLeague({ id: 'league-1', leagueCode: 'LEAGUE1', name: 'League One' }),
      buildLeague({ id: 'league-2', leagueCode: 'LEAGUE2', name: 'League Two' }),
    ]);

    await user.click(screen.getByTestId('league-selector-toggle'));

    const current = screen.getByTestId('league-selector-option-LEAGUE1');
    const other = screen.getByTestId('league-selector-option-LEAGUE2');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(within(current).getByTestId('dropdown-menu-check')).toBeInTheDocument();
    expect(other).not.toHaveAttribute('aria-current');
    expect(within(other).queryByTestId('dropdown-menu-check')).not.toBeInTheDocument();
  });

  it('shows the league code and, for a league the viewer runs, Commissioner under its name', async () => {
    const { user } = renderSelector(
      [
        buildLeague({ id: 'league-1', leagueCode: 'LEAGUE1', name: 'League One' }),
        buildLeague({ id: 'league-2', leagueCode: 'LEAGUE2', name: 'League Two' }),
      ],
      'LEAGUE1',
      new Set(['league-1']),
    );

    await user.click(screen.getByTestId('league-selector-toggle'));

    expect(screen.getByTestId('league-selector-option-LEAGUE1')).toHaveTextContent('LEAGUE1 · Commissioner');
    expect(screen.getByTestId('league-selector-option-LEAGUE2')).toHaveTextContent('LEAGUE2');
    expect(screen.getByTestId('league-selector-option-LEAGUE2')).not.toHaveTextContent('Commissioner');
  });

  it('puts Create league below a divider when the viewer has leagues', async () => {
    const { user } = renderSelector([buildLeague()]);

    await user.click(screen.getByTestId('league-selector-toggle'));

    const menu = within(screen.getByTestId('league-selector-menu'));
    expect(menu.getAllByRole('separator')).toHaveLength(1);
    expect(menu.getAllByRole('menuitem').at(-1)).toBe(screen.getByTestId('league-selector-create'));
  });

  it('shows no divider above Create league when the viewer has no leagues yet', async () => {
    const { user } = renderSelector([], null);

    await user.click(screen.getByTestId('league-selector-toggle'));

    expect(within(screen.getByTestId('league-selector-menu')).queryByRole('separator')).not.toBeInTheDocument();
  });

  it.each([
    ['a click outside the menu', (user: UserEvent) => user.click(document.body)],
    ['the Escape key', (user: UserEvent) => user.keyboard('{Escape}')],
    ['a second click on its button', (user: UserEvent) => user.click(screen.getByTestId('league-selector-toggle'))],
  ])('closes the open league menu on %s', async (_trigger, closeMenu) => {
    const { user } = renderSelector([buildLeague({ leagueCode: 'LEAGUE1', name: 'League One' })]);

    await user.click(screen.getByTestId('league-selector-toggle'));
    expect(screen.getByTestId('league-selector-option-LEAGUE1')).toBeVisible();
    await closeMenu(user);

    expect(screen.queryByTestId('league-selector-option-LEAGUE1')).not.toBeInTheDocument();
  });

  it('keeps the league menu open when the pointer moves off it', async () => {
    const { user } = renderSelector([buildLeague({ leagueCode: 'LEAGUE1', name: 'League One' })]);

    await user.click(screen.getByTestId('league-selector-toggle'));
    await user.hover(screen.getByTestId('league-selector-option-LEAGUE1'));
    await user.unhover(screen.getByTestId('league-selector-menu'));
    await user.hover(document.body);

    expect(screen.getByTestId('league-selector-option-LEAGUE1')).toBeVisible();
  });

  it('shows its commissioner an inactive league, muted and marked not currently active in place of its league code', async () => {
    const { user } = renderSelector(
      [buildLeague({ id: 'league-9', leagueCode: 'OLDLEAGUE', name: 'Old League', isActive: false })],
      'LEAGUE1',
      new Set(['league-9']),
    );

    await user.click(screen.getByTestId('league-selector-toggle'));

    const option = screen.getByTestId('league-selector-option-OLDLEAGUE');
    expect(option).toHaveTextContent('Not currently active');
    expect(option).not.toHaveTextContent('OLDLEAGUE');
    expect(screen.getByText('Old League')).toHaveClass('text-muted-foreground');
  });

  it('asks the member to select a league when no league is active', () => {
    renderSelector([buildLeague({ leagueCode: 'LEAGUE1', name: 'League One' })], null);

    expect(screen.getByTestId('league-selector-toggle')).toHaveTextContent('Select league');
  });
});

type SelectorLeague = Parameters<typeof LeagueSelector>[0]['leagues'][number];

function buildLeague(overrides: Partial<SelectorLeague> = {}): SelectorLeague {
  return {
    id: 'league-1',
    leagueCode: 'LEAGUE1',
    name: 'League One',
    isActive: true,
    iconKey: 'GOLF_FLAG',
    memberCount: 12,
    activeContestCount: 3,
    cupName: 'League One Cup',
    cupPointsScale: 'STANDARD',
    cupCustomPoints: [],
    hallOfLameVisible: true,
    planEntitlements: buildPlanEntitlements(),
    planRenewsAt: '2027-04-24T00:00:00.000Z',
    mutedSportLeagueIds: [],
    eventEmailDelivery: 'PER_EVENT',
    ...overrides,
  };
}

function renderSelector(
  leagues: SelectorLeague[],
  activeLeagueCode: string | null = 'LEAGUE1',
  commissionerLeagueIds: ReadonlySet<string> = new Set(),
  handlers: { onCreateLeague?: () => void; onNavigate?: (path: string) => void } = {},
) {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter>
      <LeagueSelector
        activeLeagueCode={activeLeagueCode}
        commissionerLeagueIds={commissionerLeagueIds}
        leagues={leagues}
        onCreateLeague={handlers.onCreateLeague ?? (() => undefined)}
        onNavigate={handlers.onNavigate ?? (() => undefined)}
      />
    </MemoryRouter>,
  );
  return { ...utils, user };
}
