import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundPage } from './not-found-page';

const { mockLogger } = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return { mockLogger };
});

const { authState } = vi.hoisted(() => ({ authState: { isAuthenticated: false } }));

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

describe('NotFoundPage', () => {
  afterEach(() => {
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('tells a signed-out visitor the page was not found, offers Sign in, and logs the page load', () => {
    authState.isAuthenticated = false;
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.getByText('The link may be old or mistyped.')).toBeVisible();
    expect(screen.getByTestId('not-found-page')).toHaveAttribute('data-kind', 'notFound');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'route.notFound.loaded',
      }),
      expect.any(String),
    );
  });

  it('sends a signed-in member to their leagues instead of to sign in', () => {
    authState.isAuthenticated = true;
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Go to my leagues' })).toHaveAttribute('href', '/welcome');
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
