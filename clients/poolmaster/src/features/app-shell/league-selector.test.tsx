import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeagueSelector } from './league-selector';

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
  logger: mockLogger,
  useLogger: () => mockLogger,
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
          leagues={[
            {
              id: 'league-1',
              leagueCode: 'LEAGUE1',
              name: 'League One',
              isActive: true,
              iconKey: 'GOLF_FLAG',
              memberCount: 12,
              activeContestCount: 3,
              memberType: 'MEMBER',
              leagueRelationship: { leagueMember: true, commissioner: false },
              isRootAdmin: false,
            },
            {
              id: 'league-2',
              leagueCode: 'LEAGUE2',
              name: 'League Two',
              isActive: true,
              iconKey: 'FOOTBALL',
              memberCount: 10,
              activeContestCount: 1,
              memberType: 'MEMBER',
              leagueRelationship: { leagueMember: true, commissioner: false },
              isRootAdmin: false,
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
});
