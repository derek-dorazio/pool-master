import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component as TimezonePage } from './timezone';

const setTimezone = vi.fn();
const setDateFormat = vi.fn();
const setTimeFormat = vi.fn();
const setFirstDayOfWeek = vi.fn();

vi.mock('@/stores/preferences-store', () => ({
  usePreferencesStore: () => ({
    timezone: 'America/New_York',
    dateFormat: 'MDY',
    timeFormat: '12H',
    firstDayOfWeek: 'SUNDAY',
    setTimezone,
    setDateFormat,
    setTimeFormat,
    setFirstDayOfWeek,
  }),
}));

vi.mock('@/lib/format-time', () => ({
  getTimezoneAbbr: () => 'EST',
}));

vi.mock('@/lib/timezones', () => ({
  getTimezonesByRegion: () => ({
    Americas: [
      { iana: 'America/New_York', label: 'New York (Eastern)' },
      { iana: 'America/Chicago', label: 'Chicago (Central)' },
    ],
    Europe: [{ iana: 'Europe/London', label: 'London (GMT/BST)' }],
  }),
  searchTimezones: (query: string) => (
    query.toLowerCase().includes('london')
      ? [{ iana: 'Europe/London', label: 'London (GMT/BST)' }]
      : []
  ),
}));

function renderPage() {
  return render(<TimezonePage />);
}

describe('TimezonePage', () => {
  beforeEach(() => {
    setTimezone.mockClear();
    setDateFormat.mockClear();
    setTimeFormat.mockClear();
    setFirstDayOfWeek.mockClear();
  });

  it('renders the active timezone and preference controls', () => {
    renderPage();

    expect(screen.getByText('Timezone & Locale')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search timezones...')).toBeInTheDocument();
    expect(screen.getByText('Current: America/New_York (EST)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Preferences' })).toBeInTheDocument();
  });

  it('filters timezones and saves the selected locale preferences', async () => {
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByPlaceholderText('Search timezones...'), 'London');
    await user.click(await screen.findByRole('button', { name: /london \(gmt\/bst\)/i }));
    await user.click(screen.getByRole('radio', { name: /DD\/MM\/YYYY/i }));
    await user.click(screen.getByRole('radio', { name: /24-hour/i }));
    await user.click(screen.getByRole('radio', { name: /Monday/i }));
    await user.click(screen.getByRole('button', { name: 'Save Preferences' }));

    await waitFor(() => {
      expect(setTimezone).toHaveBeenCalledWith('Europe/London');
      expect(setDateFormat).toHaveBeenCalledWith('DMY');
      expect(setTimeFormat).toHaveBeenCalledWith('24H');
      expect(setFirstDayOfWeek).toHaveBeenCalledWith('MONDAY');
    });
  }, 10000);
});
