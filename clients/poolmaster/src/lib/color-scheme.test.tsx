import { ColorScheme } from '@poolmaster/shared/domain';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import { deviceListenerCount, setDeviceDark } from '@/test/device-color-scheme';
import { COLOR_SCHEME_STORAGE_KEY, resolveColorScheme, useAppliedColorScheme } from './color-scheme';

type State = Parameters<typeof useAppliedColorScheme>[0];

const pageMode = () => document.documentElement.dataset['colorScheme'];

function renderScheme(initial: State) {
  return renderHook((state: State) => useAppliedColorScheme(state), { initialProps: initial });
}

/** Runs the first-paint script from index.html, as the browser does before the app loads. */
function runFirstPaintScript() {
  const open = '<script>';
  const start = indexHtml.indexOf(open) + open.length;
  const script = indexHtml.slice(start, indexHtml.indexOf('</script>', start));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs index.html's own first-paint script, read from the file
  const firstPaint = new Function(script) as () => void;
  firstPaint();
}

describe('resolveColorScheme', () => {
  it.each<[ColorScheme | null, boolean, string]>([
    [ColorScheme.DARK, false, 'dark'],
    [ColorScheme.LIGHT, true, 'light'],
    [ColorScheme.DEVICE, true, 'dark'],
    [ColorScheme.DEVICE, false, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
  ])('puts %s on the page as %s-device %s', (choice, deviceIsDark, expected) => {
    expect(resolveColorScheme(choice, deviceIsDark)).toBe(expected);
  });
});

describe('useAppliedColorScheme', () => {
  it("puts a member's Dark choice on the page, even on a light device, and remembers it for the next first paint", () => {
    renderScheme({ kind: 'member', choice: ColorScheme.DARK });

    expect(pageMode()).toBe('dark');
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe(ColorScheme.DARK);
  });

  it("keeps a member's Light choice when the device switches to dark", () => {
    setDeviceDark(true);
    renderScheme({ kind: 'member', choice: ColorScheme.LIGHT });

    expect(pageMode()).toBe('light');
    expect(deviceListenerCount()).toBe(0);
  });

  it('follows the device, and a change to it, when the member chose Match my device', () => {
    renderScheme({ kind: 'member', choice: ColorScheme.DEVICE });
    expect(pageMode()).toBe('light');

    act(() => setDeviceDark(true));
    expect(pageMode()).toBe('dark');

    act(() => setDeviceDark(false));
    expect(pageMode()).toBe('light');
  });

  it('follows the device for a member who has made no choice, and remembers no choice', () => {
    setDeviceDark(true);
    renderScheme({ kind: 'member', choice: null });

    expect(pageMode()).toBe('dark');
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBeNull();
  });

  it('follows the device for a signed-out visitor and forgets the last member\'s choice', () => {
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, ColorScheme.DARK);
    renderScheme({ kind: 'signedOut' });

    expect(pageMode()).toBe('light');
    expect(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBeNull();
  });

  it('leaves the first-paint mode alone while the session loads, then switches at once to the saved choice', () => {
    document.documentElement.dataset['colorScheme'] = 'dark';
    const { rerender } = renderScheme({ kind: 'pending' });
    expect(pageMode()).toBe('dark');

    rerender({ kind: 'member', choice: ColorScheme.LIGHT });
    expect(pageMode()).toBe('light');
  });

  it('stops listening to the device once the member picks Light or Dark', () => {
    const { rerender } = renderScheme({ kind: 'member', choice: ColorScheme.DEVICE });
    expect(deviceListenerCount()).toBe(1);

    rerender({ kind: 'member', choice: ColorScheme.DARK });
    expect(deviceListenerCount()).toBe(0);
  });
});

describe('the first-paint script in index.html', () => {
  it('reads the same storage key the app writes', () => {
    expect(indexHtml).toContain(`'${COLOR_SCHEME_STORAGE_KEY}'`);
  });

  it.each<[string | null, boolean, string]>([
    [ColorScheme.DARK, false, 'dark'],
    [ColorScheme.LIGHT, true, 'light'],
    [ColorScheme.DEVICE, true, 'dark'],
    [null, true, 'dark'],
    [null, false, 'light'],
  ])('puts a remembered %s on the page as %s-device %s before the app loads', (remembered, deviceIsDark, expected) => {
    if (remembered) window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, remembered);
    setDeviceDark(deviceIsDark);

    runFirstPaintScript();

    expect(pageMode()).toBe(expected);
  });
});
