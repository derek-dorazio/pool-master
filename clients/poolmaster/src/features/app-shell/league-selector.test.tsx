import { fireEvent, render, screen } from '@testing-library/react';
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

  it('navigates to the selected league and logs the happy path', () => {
    const onNavigate = vi.fn();

    render(
      <MemoryRouter>
        <LeagueSelector
          activeLeagueCode="LEAGUE1"
          commissionerLeagueIds={new Set()}
          leagues={[
            {
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
            },
            {
              id: 'league-2',
              leagueCode: 'LEAGUE2',
              name: 'League Two',
              isActive: true,
              iconKey: 'FOOTBALL',
              memberCount: 10,
              activeContestCount: 1,
              cupName: 'League Two Cup',
              cupPointsScale: 'STANDARD',
              cupCustomPoints: [],
              hallOfLameVisible: true,
              planEntitlements: buildPlanEntitlements(),
              planRenewsAt: '2027-04-24T00:00:00.000Z',
              mutedSportLeagueIds: [],
              eventEmailDelivery: 'PER_EVENT',
            },
          ]}
          onCreateLeague={() => undefined}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('league-selector-toggle'));
    fireEvent.click(screen.getByTestId('league-selector-option-LEAGUE2'));

    expect(onNavigate).toHaveBeenCalledWith('/league/LEAGUE2');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leagueSelector.navigate',
      }),
      expect.any(String),
    );
  });

  it('logs the create-league request branch', () => {
    const onCreateLeague = vi.fn();

    render(
      <MemoryRouter>
        <LeagueSelector
          activeLeagueCode={null}
          commissionerLeagueIds={new Set()}
          leagues={[]}
          onCreateLeague={onCreateLeague}
          onNavigate={() => undefined}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('league-selector-toggle'));
    fireEvent.click(screen.getByTestId('league-selector-create'));

    expect(onCreateLeague).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'leagueSelector.createRequested',
      }),
      expect.any(String),
    );
  });

  it.each([
    ['a click outside the menu', () => fireEvent.mouseDown(document.body)],
    ['the Escape key', () => fireEvent.keyDown(window, { key: 'Escape' })],
  ])('closes the open league menu on %s', (_trigger, closeMenu) => {
    renderSelector([buildLeague({ leagueCode: 'LEAGUE1', name: 'League One' })]);

    fireEvent.click(screen.getByTestId('league-selector-toggle'));
    expect(screen.getByTestId('league-selector-option-LEAGUE1')).toBeVisible();
    closeMenu();

    expect(screen.queryByTestId('league-selector-option-LEAGUE1')).not.toBeInTheDocument();
  });

  it('keeps the league menu open when a click lands inside it, and ignores other keys', () => {
    renderSelector([buildLeague({ leagueCode: 'LEAGUE1', name: 'League One' })]);

    fireEvent.click(screen.getByTestId('league-selector-toggle'));
    fireEvent.mouseDown(screen.getByTestId('league-selector-option-LEAGUE1'));
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(screen.getByTestId('league-selector-option-LEAGUE1')).toBeVisible();
  });

  it('shows its commissioner an inactive league marked not currently active in place of its league code', () => {
    renderSelector(
      [buildLeague({ id: 'league-9', leagueCode: 'OLDLEAGUE', name: 'Old League', isActive: false })],
      'LEAGUE1',
      new Set(['league-9']),
    );

    fireEvent.click(screen.getByTestId('league-selector-toggle'));

    const option = screen.getByTestId('league-selector-option-OLDLEAGUE');
    expect(option).toHaveTextContent('Not currently active');
    expect(option).not.toHaveTextContent('OLDLEAGUE');
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
) {
  return render(
    <MemoryRouter>
      <LeagueSelector
        activeLeagueCode={activeLeagueCode}
        commissionerLeagueIds={commissionerLeagueIds}
        leagues={leagues}
        onCreateLeague={() => undefined}
        onNavigate={() => undefined}
      />
    </MemoryRouter>,
  );
}
