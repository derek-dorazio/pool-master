import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { buildLeagueMembership } from './test/fixtures';
import { useLeagueMembersQuery } from './use-league-members-query';

const listLeagueMembersMock = vi.fn();
bindApiMocks({ listLeagueMembers: listLeagueMembersMock });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useLeagueMembersQuery', () => {
  it('reads the roster and indexes it by user', async () => {
    const member = buildLeagueMembership({ userId: 'user-7' });
    listLeagueMembersMock.mockResolvedValue({ data: { members: [member] } });

    const { result } = renderHook(() => useLeagueMembersQuery('league-1'), { wrapper });

    await waitFor(() => expect(result.current.members).toEqual([member]));
    expect(result.current.membersByUserId.get('user-7')).toEqual(member);
  });

  it('fails the read, with an empty index, when the API refuses', async () => {
    listLeagueMembersMock.mockResolvedValue({ error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'No such league.' } }, status: 404 });

    const { result } = renderHook(() => useLeagueMembersQuery('league-1'), { wrapper });

    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.membersByUserId.size).toBe(0);
  });

  it('reads nothing until it has a league id', () => {
    renderHook(() => useLeagueMembersQuery(''), { wrapper });

    expect(listLeagueMembersMock).not.toHaveBeenCalled();
  });
});
