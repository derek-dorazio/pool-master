import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useLinkedAccounts, useConnectAccount, useDisconnectAccount } from './use-linked-accounts';

describe('useLinkedAccounts', () => {
  it('returns linked accounts array', async () => {
    const { result } = renderHook(() => useLinkedAccounts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('each account has expected shape', async () => {
    const { result } = renderHook(() => useLinkedAccounts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const account = result.current.data![0];
    expect(account).toHaveProperty('provider');
    expect(account).toHaveProperty('connected');
    expect(account).toHaveProperty('email');
  });

  it('providers are google or apple', async () => {
    const { result } = renderHook(() => useLinkedAccounts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    result.current.data!.forEach((account) => {
      expect(['google', 'apple']).toContain(account.provider);
    });
  });

  it('connected account has an email, disconnected has null', async () => {
    const { result } = renderHook(() => useLinkedAccounts());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const connected = result.current.data!.find((a) => a.connected);
    const disconnected = result.current.data!.find((a) => !a.connected);
    expect(connected?.email).toBeTruthy();
    expect(disconnected?.email).toBeNull();
  });
});

describe('useConnectAccount', () => {
  it('exposes a mutate function', () => {
    const { result } = renderHook(() => useConnectAccount());

    expect(result.current.mutate).toBeDefined();
    expect(typeof result.current.mutate).toBe('function');
  });
});

describe('useDisconnectAccount', () => {
  it('exposes a mutate function and starts idle', () => {
    const { result } = renderHook(() => useDisconnectAccount());

    expect(result.current.mutate).toBeDefined();
    expect(result.current.isIdle).toBe(true);
  });
});
