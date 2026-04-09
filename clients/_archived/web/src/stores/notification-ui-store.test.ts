import { useNotificationUiStore } from './notification-ui-store';

describe('notification-ui-store', () => {
  beforeEach(() => {
    useNotificationUiStore.setState({
      isDropdownOpen: false,
      activeCategory: null,
      pushBannerDismissed: false,
    });
  });

  it('starts with dropdown closed', () => {
    expect(useNotificationUiStore.getState().isDropdownOpen).toBe(false);
  });

  it('toggleDropdown flips isDropdownOpen', () => {
    useNotificationUiStore.getState().toggleDropdown();
    expect(useNotificationUiStore.getState().isDropdownOpen).toBe(true);
    useNotificationUiStore.getState().toggleDropdown();
    expect(useNotificationUiStore.getState().isDropdownOpen).toBe(false);
  });

  it('setDropdownOpen sets exact value', () => {
    useNotificationUiStore.getState().setDropdownOpen(true);
    expect(useNotificationUiStore.getState().isDropdownOpen).toBe(true);
    useNotificationUiStore.getState().setDropdownOpen(false);
    expect(useNotificationUiStore.getState().isDropdownOpen).toBe(false);
  });

  it('setActiveCategory updates category', () => {
    useNotificationUiStore.getState().setActiveCategory('scoring');
    expect(useNotificationUiStore.getState().activeCategory).toBe('scoring');
    useNotificationUiStore.getState().setActiveCategory(null);
    expect(useNotificationUiStore.getState().activeCategory).toBeNull();
  });

  it('dismissPushBanner sets pushBannerDismissed to true', () => {
    expect(useNotificationUiStore.getState().pushBannerDismissed).toBe(false);
    useNotificationUiStore.getState().dismissPushBanner();
    expect(useNotificationUiStore.getState().pushBannerDismissed).toBe(true);
  });
});
