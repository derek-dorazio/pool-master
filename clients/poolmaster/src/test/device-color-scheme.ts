/**
 * jsdom has no `matchMedia`. This stands in for the device's light or dark setting in tests:
 * `setDeviceDark` flips it and tells every listener, as a phone switching modes does.
 */
type Listener = () => void;

let deviceIsDark = false;
const listeners = new Set<Listener>();

function mediaQueryList(query: string): MediaQueryList {
  const isDarkQuery = query.includes('prefers-color-scheme: dark');
  return {
    get matches() {
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

export function deviceListenerCount() {
  return listeners.size;
}

export function resetDeviceColorScheme() {
  deviceIsDark = false;
  listeners.clear();
  delete document.documentElement.dataset['colorScheme'];
  window.localStorage.clear();
}
