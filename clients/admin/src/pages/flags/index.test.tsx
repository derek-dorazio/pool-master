import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as FlagsPage } from './index';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockFlags = [
  { key: 'live_draft_v2', name: 'Live Draft V2', type: 'Percentage' as const, enabled: true, rolloutPct: 45, overridesCount: 2, owner: 'eng-team', lastUpdated: '2026-03-24' },
  { key: 'dark_mode', name: 'Dark Mode', type: 'Boolean' as const, enabled: false, rolloutPct: 100, overridesCount: 0, owner: 'design', lastUpdated: '2026-03-15' },
  { key: 'salary_cap_nfl', name: 'Salary Cap NFL', type: 'Tenant List' as const, enabled: true, rolloutPct: 0, overridesCount: 3, owner: 'eng-team', lastUpdated: '2026-03-18' },
];

vi.mock('@/hooks/use-flags-api', () => ({
  useFlagList: () => ({
    data: mockFlags,
    isLoading: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  adminApi: { put: vi.fn() },
}));

function renderFlags() {
  return render(
    <MemoryRouter>
      <FlagsPage />
    </MemoryRouter>,
  );
}

describe('FlagsPage', () => {
  it('renders flag table with flag names', () => {
    renderFlags();

    expect(screen.getByText('Live Draft V2')).toBeInTheDocument();
    expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    expect(screen.getByText('Salary Cap NFL')).toBeInTheDocument();
  });

  it('shows flag keys in monospace cells', () => {
    renderFlags();

    const keyCell = screen.getByText('live_draft_v2');
    expect(keyCell.className).toContain('font-mono');

    const keyCell2 = screen.getByText('dark_mode');
    expect(keyCell2.className).toContain('font-mono');
  });

  it('toggle switches are present for each flag', () => {
    renderFlags();

    const toggles = screen.getAllByRole('switch');
    expect(toggles).toHaveLength(3);
  });

  it('"Create Flag" button exists', () => {
    renderFlags();

    expect(screen.getByRole('button', { name: /create flag/i })).toBeInTheDocument();
  });

  it('renders the Feature Flags heading', () => {
    renderFlags();

    expect(screen.getByRole('heading', { name: 'Feature Flags' })).toBeInTheDocument();
  });

  it('shows type badges for different flag types', () => {
    renderFlags();

    expect(screen.getByText('Percentage')).toBeInTheDocument();
    expect(screen.getByText('Boolean')).toBeInTheDocument();
    expect(screen.getByText('Tenant List')).toBeInTheDocument();
  });
});
