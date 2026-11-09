import { ColorScheme } from '@poolmaster/shared/domain';
import { useEffect } from 'react';

/**
 * Light or dark, as the page shows it (#1471). `globals.css` turns dark mode on from
 * `data-color-scheme="dark"` on the root element; this module and the first-paint script in
 * `index.html` are the only two that set it.
 */
export type AppliedColorScheme = 'light' | 'dark';

/**
 * Where the browser remembers a signed-in member's Appearance choice, so the first-paint script
 * in `index.html` can apply it before the session loads. That script repeats this key by hand
 * (it runs before any module), and `color-scheme.test.tsx` checks the two agree.
 */
export const COLOR_SCHEME_STORAGE_KEY = 'poolmaster.colorScheme';

export const DEVICE_DARK_QUERY = '(prefers-color-scheme: dark)';

/** The mode a choice puts on the page. No choice, like Match my device, follows the device. */
export function resolveColorScheme(choice: ColorScheme | null, deviceIsDark: boolean): AppliedColorScheme {
  if (choice === ColorScheme.DARK) return 'dark';
  if (choice === ColorScheme.LIGHT) return 'light';
  return deviceIsDark ? 'dark' : 'light';
}

function rememberChoice(choice: ColorScheme | null) {
  try {
    if (choice === null) window.localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY);
    else window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, choice);
  } catch {
    // A browser that refuses storage still gets the right mode for this page; only the
    // first paint of the next visit falls back to the device setting.
  }
}

/**
 * Puts the member's Appearance on the page and keeps it there.
 *
 * - `pending`: the session is still loading, so the page keeps what the first-paint script set.
 * - `signedOut`: visitors always follow their device, and the remembered choice is forgotten.
 * - otherwise: the member's choice (no choice means Match my device) is applied and remembered.
 *
 * Following the device listens for the device switching between light and dark.
 */
export function useAppliedColorScheme(
  state: { kind: 'pending' } | { kind: 'signedOut' } | { kind: 'member'; choice: ColorScheme | null },
) {
  const kind = state.kind;
  const choice = state.kind === 'member' ? state.choice : null;

  useEffect(() => {
    if (kind === 'pending') return undefined;
    rememberChoice(kind === 'member' ? choice : null);

    const root = document.documentElement;
    const device = window.matchMedia(DEVICE_DARK_QUERY);
    const apply = () => {
      root.dataset['colorScheme'] = resolveColorScheme(choice, device.matches);
    };
    apply();
    if (choice === ColorScheme.LIGHT || choice === ColorScheme.DARK) return undefined;
    device.addEventListener('change', apply);
    return () => device.removeEventListener('change', apply);
  }, [kind, choice]);
}
