import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PreferencesState {
  timezone: string;
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  numberFormat: 'en-US' | 'de-DE' | 'fr-FR';
  sidebarCollapsed: boolean;
  setTimezone: (tz: string) => void;
  setDateFormat: (fmt: PreferencesState['dateFormat']) => void;
  setNumberFormat: (fmt: PreferencesState['numberFormat']) => void;
  toggleSidebar: () => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dateFormat: 'MM/DD/YYYY',
      numberFormat: 'en-US',
      sidebarCollapsed: false,
      setTimezone: (timezone) => set({ timezone }),
      setDateFormat: (dateFormat) => set({ dateFormat }),
      setNumberFormat: (numberFormat) => set({ numberFormat }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'poolmaster-preferences' },
  ),
);
