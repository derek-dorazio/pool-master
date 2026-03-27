import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type DateFormatCode = 'MDY' | 'DMY' | 'YMD';
type TimeFormatCode = '12H' | '24H';
type FirstDayOfWeek = 'SUNDAY' | 'MONDAY';

interface PreferencesState {
  timezone: string;
  dateFormat: DateFormatCode;
  timeFormat: TimeFormatCode;
  firstDayOfWeek: FirstDayOfWeek;
  numberFormat: 'en-US' | 'de-DE' | 'fr-FR';
  sidebarCollapsed: boolean;
  setTimezone: (tz: string) => void;
  setDateFormat: (fmt: DateFormatCode) => void;
  setTimeFormat: (fmt: TimeFormatCode) => void;
  setFirstDayOfWeek: (day: FirstDayOfWeek) => void;
  setNumberFormat: (fmt: PreferencesState['numberFormat']) => void;
  toggleSidebar: () => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dateFormat: 'MDY',
      timeFormat: '12H',
      firstDayOfWeek: 'SUNDAY',
      numberFormat: 'en-US',
      sidebarCollapsed: false,
      setTimezone: (timezone) => set({ timezone }),
      setDateFormat: (dateFormat) => set({ dateFormat }),
      setTimeFormat: (timeFormat) => set({ timeFormat }),
      setFirstDayOfWeek: (firstDayOfWeek) => set({ firstDayOfWeek }),
      setNumberFormat: (numberFormat) => set({ numberFormat }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'poolmaster-preferences' },
  ),
);
