import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './error-boundary';
import { logger } from '@/lib/logger';

function ThrowingChild(): ReactElement {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the fallback UI and logs fatal render failures', () => {
    const loggerSpy = vi.spyOn(logger, 'fatal').mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('Reload to try again.')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary')).toHaveAttribute('data-kind', 'error');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app.errorBoundary.caught',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
        err: expect.any(Error),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
        data: expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric-matcher sentinel, typed any by design.
          componentStack: expect.any(String),
        }),
      }),
      'Unhandled render error',
    );

    consoleErrorSpy.mockRestore();
  });

  it('reloads the page when the fallback action is used', async () => {
    const user = userEvent.setup();
    const loggerSpy = vi.spyOn(logger, 'fatal').mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reloadSpy = vi.fn();

    Object.defineProperty(window, 'location', {
      configurable: true,
      // The logger reads `pathname`; the boundary calls `reload`.
      value: {
        pathname: window.location.pathname,
        reload: reloadSpy,
      },
    });

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reloadSpy).toHaveBeenCalledTimes(1);

    loggerSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
