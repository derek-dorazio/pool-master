import { usePreferencesStore } from './preferences-store';

describe('preferences-store', () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      dateFormat: 'MDY',
      timeFormat: '12H',
      firstDayOfWeek: 'SUNDAY',
      numberFormat: 'en-US',
      sidebarCollapsed: false,
    });
  });

  it('has sensible defaults', () => {
    const s = usePreferencesStore.getState();
    expect(s.dateFormat).toBe('MDY');
    expect(s.timeFormat).toBe('12H');
    expect(s.firstDayOfWeek).toBe('SUNDAY');
    expect(s.numberFormat).toBe('en-US');
    expect(s.sidebarCollapsed).toBe(false);
    expect(s.timezone).toBeDefined();
  });

  it('setTimezone updates timezone', () => {
    usePreferencesStore.getState().setTimezone('Europe/London');
    expect(usePreferencesStore.getState().timezone).toBe('Europe/London');
  });

  it('setDateFormat updates dateFormat', () => {
    usePreferencesStore.getState().setDateFormat('DMY');
    expect(usePreferencesStore.getState().dateFormat).toBe('DMY');
  });

  it('setTimeFormat updates timeFormat', () => {
    usePreferencesStore.getState().setTimeFormat('24H');
    expect(usePreferencesStore.getState().timeFormat).toBe('24H');
  });

  it('setFirstDayOfWeek updates firstDayOfWeek', () => {
    usePreferencesStore.getState().setFirstDayOfWeek('MONDAY');
    expect(usePreferencesStore.getState().firstDayOfWeek).toBe('MONDAY');
  });

  it('setNumberFormat updates numberFormat', () => {
    usePreferencesStore.getState().setNumberFormat('de-DE');
    expect(usePreferencesStore.getState().numberFormat).toBe('de-DE');
  });

  it('toggleSidebar flips sidebarCollapsed', () => {
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(false);
    usePreferencesStore.getState().toggleSidebar();
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true);
    usePreferencesStore.getState().toggleSidebar();
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(false);
  });
});
