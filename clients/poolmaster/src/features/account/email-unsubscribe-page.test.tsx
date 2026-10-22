import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

    expect(await screen.findByText(/You won't get live standings emails from any of your leagues/)).toBeInTheDocument();
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
});
