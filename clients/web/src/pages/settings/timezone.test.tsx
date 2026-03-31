import { render, screen } from '@testing-library/react';
import { Component as TimezonePage } from './timezone';

vi.mock('@/stores/preferences-store', () => ({
  usePreferencesStore: () => ({
    timezone: 'America/New_York',
    dateFormat: 'MDY',
    timeFormat: '12H',
    firstDayOfWeek: 'SUNDAY',
    setTimezone: vi.fn(),
    setDateFormat: vi.fn(),
    setTimeFormat: vi.fn(),
    setFirstDayOfWeek: vi.fn(),
  }),
}));

vi.mock('@/lib/format-time', () => ({
  formatTime: () => '7:00 PM',
  getTimezoneAbbr: () => 'EST',
}));

vi.mock('@/lib/timezones', () => ({
  TIMEZONES: [],
  getTimezonesByRegion: () => ({
    Americas: [
      { iana: 'America/New_York', label: 'Eastern Time (New York)' },
      { iana: 'America/Chicago', label: 'Central Time (Chicago)' },
    ],
  }),
  searchTimezones: () => [],
}));

function renderPage() {
  return render(<TimezonePage />);
}

describe('TimezonePage', () => {
  it('renders timezone picker', () => {
    renderPage();
    expect(screen.getByText('Timezone')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search timezones...')).toBeInTheDocument();
  });

  it('renders date format options', () => {
    renderPage();
    expect(screen.getByText('Date Format')).toBeInTheDocument();
    expect(screen.getByText('MM/DD/YYYY')).toBeInTheDocument();
    expect(screen.getByText('DD/MM/YYYY')).toBeInTheDocument();
    expect(screen.getByText('YYYY-MM-DD')).toBeInTheDocument();
  });

  it('renders time format options', () => {
    renderPage();
    expect(screen.getByText('Time Format')).toBeInTheDocument();
    expect(screen.getByText('12-hour')).toBeInTheDocument();
    expect(screen.getByText('24-hour')).toBeInTheDocument();
  });

  it('renders format preview section', () => {
    renderPage();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('has "Save" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Save Preferences' })).toBeInTheDocument();
  });
});
