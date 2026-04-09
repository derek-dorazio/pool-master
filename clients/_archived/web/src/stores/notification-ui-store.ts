import { create } from 'zustand';

interface NotificationUiState {
  isDropdownOpen: boolean;
  activeCategory: string | null;
  pushBannerDismissed: boolean;
  toggleDropdown: () => void;
  setDropdownOpen: (open: boolean) => void;
  setActiveCategory: (category: string | null) => void;
  dismissPushBanner: () => void;
}

export const useNotificationUiStore = create<NotificationUiState>((set) => ({
  isDropdownOpen: false,
  activeCategory: null,
  pushBannerDismissed: false,
  toggleDropdown: () => set((s) => ({ isDropdownOpen: !s.isDropdownOpen })),
  setDropdownOpen: (open) => set({ isDropdownOpen: open }),
  setActiveCategory: (category) => set({ activeCategory: category }),
  dismissPushBanner: () => set({ pushBannerDismissed: true }),
}));
