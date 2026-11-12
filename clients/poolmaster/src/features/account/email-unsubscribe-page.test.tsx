import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EmailUnsubscribePage } from './email-unsubscribe-page';

const { unsubscribeFromEmailMock } = vi.hoisted(() => ({
  unsubscribeFromEmailMock: vi.fn(),
}));

bindApiMocks({
  unsubscribeFromEmail: unsubscribeFromEmailMock,
});

function renderPage(entry = '/email/unsubscribe?token=link-token-123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<EmailUnsubscribePage />} path="/email/unsubscribe" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmailUnsubscribePage', () => {
  beforeEach(() => {
    unsubscribeFromEmailMock.mockReset();
  });

  it('asks before unsubscribing, so opening the link alone turns nothing off', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Stop these emails' })).toBeInTheDocument();
    expect(unsubscribeFromEmailMock).not.toHaveBeenCalled();
  });

  it('sends the link\'s token on confirm and says which emails stopped, with a link to the email settings', async () => {
    unsubscribeFromEmailMock.mockResolvedValue({ data: { category: 'LIVE_STANDINGS' } });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Stop these emails' }));

    expect(await screen.findByText('No more live standings emails from any of your leagues.')).toBeInTheDocument();
    expect(screen.getByTestId('email-unsubscribe-done')).toHaveAttribute('data-kind', 'done');
    expect(unsubscribeFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({ query: { token: 'link-token-123' } }));
    expect(screen.getByRole('link', { name: 'Email notifications' })).toHaveAttribute('href', '/my-account');
  });

  it('says the link doesn\'t work when the API refuses its token', async () => {
    unsubscribeFromEmailMock.mockResolvedValue({
      error: { error: { code: 'EMAIL_UNSUBSCRIBE_LINK_INVALID', message: 'This unsubscribe link is not valid.' } },
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Stop these emails' }));

    expect(await screen.findByTestId('email-unsubscribe-invalid')).toHaveTextContent("This link doesn't work");
  });

  it('says the link doesn\'t work when it has no token, without calling the API', () => {
    renderPage('/email/unsubscribe');

    expect(screen.getByTestId('email-unsubscribe-invalid')).toBeInTheDocument();
    expect(unsubscribeFromEmailMock).not.toHaveBeenCalled();
  });

  it('keeps the button and shows the reason when unsubscribing fails for another cause', async () => {
    unsubscribeFromEmailMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Email settings are unavailable right now.' } },
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Stop these emails' }));

    expect(await screen.findByText('Email settings are unavailable right now.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stop these emails' })).toBeEnabled();
    expect(screen.queryByTestId('email-unsubscribe-invalid')).not.toBeInTheDocument();
  });
});
