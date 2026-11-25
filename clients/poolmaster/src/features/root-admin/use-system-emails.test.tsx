import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { EmailTemplateKey } from '@poolmaster/shared/domain';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { useCheckDelivery, useSendLatestToMe, useSystemEmailLatestSendQuery, useSystemEmailsQuery } from './use-system-emails';

const refusal = { error: { error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED', message: 'Root admins only.' } }, status: 403 };

bindApiMocks({
  listSystemEmails: vi.fn().mockResolvedValue(refusal),
  getSystemEmailLatestSend: vi.fn().mockResolvedValue(refusal),
  sendSystemEmailLatestSendToMe: vi.fn().mockResolvedValue(refusal),
  sendTestEmail: vi.fn().mockResolvedValue(refusal),
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('the system email reads and sends', () => {
  it('fails the email list read when the API refuses it', async () => {
    const { result } = renderHook(() => useSystemEmailsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails the latest send read when the API refuses it', async () => {
    const { result } = renderHook(() => useSystemEmailLatestSendQuery(EmailTemplateKey.CONTEST_OPENED), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails Send me this email when the API refuses it', async () => {
    const { result } = renderHook(() => useSendLatestToMe(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(EmailTemplateKey.CONTEST_OPENED)).rejects.toThrow();
    });
  });

  it('fails Check delivery when the API refuses it', async () => {
    const { result } = renderHook(() => useCheckDelivery(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync('admin@example.com')).rejects.toThrow();
    });
  });
});
