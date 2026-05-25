import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

  it('renders the fallback route and logs the page-load milestone', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("We couldn't find that page.")).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'route.notFound.loaded',
      }),
      expect.any(String),
    );
  });
});
