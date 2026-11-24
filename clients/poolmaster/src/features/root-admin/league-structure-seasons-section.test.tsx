import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { SportLeagueSeasonDto } from '@/lib/api';
import { LeagueStructureSeasonSlotsSection, LeagueStructureSeasonsSection } from './league-structure-seasons-section';

function season(id: string, year: number, overrides: Partial<SportLeagueSeasonDto> = {}): SportLeagueSeasonDto {
  return {
    id, name: String(year), championshipYear: year,
    startsAt: `${year}-01-01T00:00:00.000Z`, endsAt: `${year}-12-31T23:59:59.999Z`,
    isCurrent: false, providerMappings: [], phases: [], ...overrides,
  };
}

function slot(id: string, overrides: Partial<SportLeagueSeasonDto['phases'][number]['slots'][number]> = {}): SportLeagueSeasonDto['phases'][number]['slots'][number] {
  return {
    id, slotDefinitionId: `def-${id}`, key: 'WEEK_1', slotKind: 'WEEK', weekNumber: 1, name: null,
    startsAt: null, endsAt: null, status: 'SCHEDULED', seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
    isTestData: false, label: null, ...overrides,
  };
}

const CURRENT = season('s2026', 2026, {
  isCurrent: true,
  providerMappings: [{ id: 'm1', providerId: 'balldontlie', providerName: 'BALLDONTLIE', providerLeagueCode: 'nfl', providerSeasonId: '2026' }],
  phases: [{ id: 'p-reg', phase: 'REGULAR', isSynced: true, slots: [slot('synced'), slot('test', { isTestData: true, label: 'QA A' })] }],
});
const EARLIER = season('s2025', 2025);

function renderIn(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('LeagueStructureSeasonsSection', () => {
  it('lists each Season with whether it is current and its provider ids, and opens a current Season to read with its slot count', async () => {
    renderIn(<LeagueStructureSeasonsSection seasons={[CURRENT, EARLIER]} timeZone="America/New_York" />);

    expect(screen.getByText('America/New_York')).toBeInTheDocument();
    const current = screen.getByTestId('root-admin-league-structure-season-2026');
    expect(within(current).getByText('Yes')).toBeInTheDocument();
    expect(within(current).getByText(/BALLDONTLIE/)).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-league-structure-season-2025')).getByText('No')).toBeInTheDocument();

    await userEvent.click(within(current).getByRole('button', { name: /open/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Yes')).toBeInTheDocument();
    expect(within(dialog).getByText('2')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('opens a Season with no provider id to read as not current, with no provider ids and no slots', async () => {
    renderIn(<LeagueStructureSeasonsSection seasons={[EARLIER]} timeZone="UTC" />);

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-season-2025')).getByRole('button', { name: /open/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('No')).toBeInTheDocument();
    expect(within(dialog).getByText('None')).toBeInTheDocument();
    expect(within(dialog).getByText('0')).toBeInTheDocument();
  });

  it('says the league has no Seasons when it has none', () => {
    renderIn(<LeagueStructureSeasonsSection seasons={[]} timeZone="UTC" />);

    expect(screen.getByText('No Seasons for this league.')).toBeInTheDocument();
  });
});

describe('LeagueStructureSeasonSlotsSection', () => {
  it('lists the current Season\'s slots with a test slot\'s label and a synced slot\'s blank one', () => {
    renderIn(<LeagueStructureSeasonSlotsSection seasons={[CURRENT, EARLIER]} />);

    expect(within(screen.getByTestId('root-admin-league-structure-season-slot-test')).getByText('QA A')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-league-structure-season-slot-synced')).toBeInTheDocument();
  });

  it('lists every Season\'s slots when no Season is current, and says so when there are none', () => {
    const { unmount } = renderIn(<LeagueStructureSeasonSlotsSection seasons={[{ ...CURRENT, isCurrent: false }]} />);
    expect(screen.getByTestId('root-admin-league-structure-season-slot-synced')).toBeInTheDocument();
    unmount();

    renderIn(<LeagueStructureSeasonSlotsSection seasons={[]} />);
    expect(screen.getByText('No Season slots for this league.')).toBeInTheDocument();
  });
});
