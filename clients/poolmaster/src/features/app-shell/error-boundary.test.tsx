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

    expect(
      screen.getByText(/poolmaster hit an unexpected problem/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app.errorBoundary.caught',
        err: expect.any(Error),
        data: expect.objectContaining({
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
      value: {
        ...window.location,
        reload: reloadSpy,
      },
    });

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: /reload page/i }));

    expect(reloadSpy).toHaveBeenCalledTimes(1);

    loggerSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
