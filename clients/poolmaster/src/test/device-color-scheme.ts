/**
 * jsdom has no `matchMedia`. This stands in for the device's light or dark setting in tests:
 * `setDeviceDark` flips it and tells every listener, as a phone switching modes does. It also
 * answers `min-width` queries from the window's width, a phone's 390px unless `setDeviceWidth`
 * widens it, as a window resized does.
 */
type Listener = () => void;

const PHONE_WIDTH = 390;

let deviceIsDark = false;
let deviceWidth = PHONE_WIDTH;
const listeners = new Set<Listener>();

function mediaQueryList(query: string): MediaQueryList {
  const isDarkQuery = query.includes('prefers-color-scheme: dark');
  const minWidth = /min-width:\s*(\d+)px/.exec(query)?.[1];
  return {
    get matches() {
      if (minWidth !== undefined) return deviceWidth >= Number(minWidth);
      return isDarkQuery && deviceIsDark;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

export function installDeviceColorScheme() {
  window.matchMedia = mediaQueryList;
}

export function setDeviceDark(dark: boolean) {
  deviceIsDark = dark;
  for (const listener of [...listeners]) listener();
}

export function setDeviceWidth(width: number) {
  deviceWidth = width;
  for (const listener of [...listeners]) listener();
}

export function deviceListenerCount() {
  return listeners.size;
}

export function resetDeviceColorScheme() {
  deviceIsDark = false;
  deviceWidth = PHONE_WIDTH;
  listeners.clear();
  delete document.documentElement.dataset['colorScheme'];
  window.localStorage.clear();
}
