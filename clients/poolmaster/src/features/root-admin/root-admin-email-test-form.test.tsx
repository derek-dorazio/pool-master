import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EmailTestForm } from './root-admin-email-test-form';

const { sendTestEmailMock } = vi.hoisted(() => ({ sendTestEmailMock: vi.fn() }));

bindApiMocks({ sendTestEmail: sendTestEmailMock });

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EmailTestForm />
    </QueryClientProvider>,
  );
}

function sendTo(address: string) {
  fireEvent.change(screen.getByTestId('root-admin-email-test-to'), { target: { value: address } });
  fireEvent.click(screen.getByTestId('root-admin-email-test-send'));
}

describe('the Send test email form', () => {
  it('sends the typed address and says the email was sent', async () => {
    sendTestEmailMock.mockResolvedValue({ data: { status: 'SENT', skipReason: null, error: null } });
    renderForm();

    sendTo('derek@gmail.com');

    expect(await screen.findByTestId('root-admin-email-test-result')).toHaveTextContent('Sent. Check the inbox in a minute.');
    expect(sendTestEmailMock).toHaveBeenCalledWith(expect.objectContaining({ body: { to: 'derek@gmail.com' } }));
  });

  it('says why a skipped test email was not sent, here because email is switched off', async () => {
    sendTestEmailMock.mockResolvedValue({ data: { status: 'SKIPPED', skipReason: 'EMAIL_DISABLED', error: null } });
    renderForm();

    sendTo('derek@gmail.com');

    expect(await screen.findByTestId('root-admin-email-test-result')).toHaveTextContent('"Send system email" is off');
  });

  it('shows the email provider\'s error when the first try failed', async () => {
    sendTestEmailMock.mockResolvedValue({
      data: { status: 'QUEUED', skipReason: null, error: 'Email address is not verified.' },
    });
    renderForm();

    sendTo('unverified@gmail.com');

    expect(await screen.findByTestId('root-admin-email-test-result')).toHaveTextContent(
      'The first try failed and it will be tried again. The email provider said: Email address is not verified.',
    );
  });

  it('refuses something that is not an email address without calling the server', async () => {
    renderForm();

    sendTo('not-an-address');

    expect(await screen.findByText('Enter an email address.')).toBeInTheDocument();
    expect(sendTestEmailMock).not.toHaveBeenCalled();
  });
});
