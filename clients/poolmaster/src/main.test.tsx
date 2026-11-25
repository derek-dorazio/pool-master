import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app', () => ({ App: () => <p>The app</p> }));

describe('the app bootstrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('mounts the app into the page\'s #root element', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await act(async () => {
      await import('./main');
    });

    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('refuses to start when the page has no #root element', async () => {
    await expect(import('./main')).rejects.toThrow('index.html is missing the #root element');
  });
});
