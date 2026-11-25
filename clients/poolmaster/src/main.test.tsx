import { act, screen } from '@testing-library/react';
import type * as ReactDomClient from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app', () => ({ App: () => <p>The app</p> }));

/** The roots the bootstrap made, so each test unmounts what it mounted. */
const mountedRoots: Root[] = [];
vi.mock('react-dom/client', async (importOriginal) => {
  const client = await importOriginal<typeof ReactDomClient>();
  const createRoot: typeof client.createRoot = (...args) => {
    const root = client.createRoot(...args);
    mountedRoots.push(root);
    return root;
  };
  return { ...client, default: { ...client, createRoot }, createRoot };
});

describe('the app bootstrap', () => {
  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount();
    });
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('mounts the app into the page\'s #root element', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await act(async () => {
      await import('./main');
    });

    expect(screen.getByText('The app')).toBeInTheDocument();
    expect(mountedRoots).toHaveLength(1);
  });

  it('refuses to start when the page has no #root element', async () => {
    await expect(import('./main')).rejects.toThrow('index.html is missing the #root element');
    expect(mountedRoots).toEqual([]);
  });
});
