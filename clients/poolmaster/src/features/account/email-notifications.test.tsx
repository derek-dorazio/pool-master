import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EmailNotificationsDialog, EmailSuppressionBanner } from './email-notifications';

const { getUserEmailPreferencesMock, updateUserEmailPreferenceMock } = vi.hoisted(() => ({
  getUserEmailPreferencesMock: vi.fn(),
  updateUserEmailPreferenceMock: vi.fn(),
}));

bindApiMocks({
  getUserEmailPreferences: getUserEmailPreferencesMock,
  updateUserEmailPreference: updateUserEmailPreferenceMock,
});

const ALL_ON = [
  { category: 'COMMISSIONER_UPDATES', enabled: true },
  { category: 'CONTEST_UPDATES', enabled: true },
  { category: 'LIVE_STANDINGS', enabled: true },
  { category: 'RESULTS', enabled: true },
  { category: 'RECEIPTS', enabled: true },
];

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailNotificationsDialog onOpenChange={vi.fn()} open />
    </QueryClientProvider>,
  );
}

describe('EmailNotificationsDialog', () => {
  beforeEach(() => {
    getUserEmailPreferencesMock.mockReset();
    updateUserEmailPreferenceMock.mockReset();
  });

  it('shows one switch per category a member can turn off, each as the API reports it', async () => {
    getUserEmailPreferencesMock.mockResolvedValue({
      data: { preferences: ALL_ON.map((p) => (p.category === 'RESULTS' ? { ...p, enabled: false } : p)), emailSuppression: null },
    });
    renderDialog();

    expect(await screen.findByLabelText(/Live standings/)).toBeChecked();
    expect(screen.getByLabelText(/^Results/)).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.queryByTestId('email-suppression-banner')).not.toBeInTheDocument();
  });

  it('turns a category off for the member\'s own account and shows the switches the API answers with', async () => {
    getUserEmailPreferencesMock.mockResolvedValue({ data: { preferences: ALL_ON, emailSuppression: null } });
    updateUserEmailPreferenceMock.mockResolvedValue({
      data: { preferences: ALL_ON.map((p) => (p.category === 'RECEIPTS' ? { ...p, enabled: false } : p)), emailSuppression: null },
    });
    renderDialog();

    fireEvent.click(await screen.findByLabelText(/Entry receipts/));

    await waitFor(() => {
      expect(updateUserEmailPreferenceMock).toHaveBeenCalledWith(expect.objectContaining({
        path: { userId: 'me' },
        body: { category: 'RECEIPTS', enabled: false },
      }));
    });
    await waitFor(() => { expect(screen.getByLabelText(/Entry receipts/)).not.toBeChecked(); });
  });

  it('warns the member when no email reaches them because their address bounced', async () => {
    getUserEmailPreferencesMock.mockResolvedValue({ data: { preferences: ALL_ON, emailSuppression: 'BOUNCE' } });
    renderDialog();

    expect(await screen.findByTestId('email-suppression-banner')).toHaveTextContent('Email to your address bounced');
  });
});

describe('EmailSuppressionBanner', () => {
  it('tells a member who marked an email as spam that email stopped and how to start it again', () => {
    render(<EmailSuppressionBanner reason="COMPLAINT" />);

    expect(screen.getByTestId('email-suppression-banner')).toHaveTextContent('marked as spam');
    expect(screen.getByTestId('email-suppression-banner')).toHaveTextContent('Change your email in Edit profile');
  });

  it('shows nothing when the address can be emailed', () => {
    const { container } = render(<EmailSuppressionBanner reason={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
