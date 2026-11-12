import { describe, expect, it } from 'vitest';
import type { LeagueInvitationDto } from '@/lib/api';
import { buildGeneratedInviteLink } from '@/features/leagues/test/fixtures';
import {
  buildInviteUrl,
  describeInviteResult,
  emailStatusLabel,
  isEmailProblem,
  isExpiredInvitation,
  isInviteFilter,
  joinedCount,
} from './invites-page-helpers';

function invite(overrides: Partial<LeagueInvitationDto> = {}): LeagueInvitationDto {
  return { ...buildGeneratedInviteLink(), ...overrides };
}

function sent(overrides: Partial<LeagueInvitationDto> = {}) {
  return { sent: [invite({ email: 'friend@example.com', inviteType: 'EMAIL', ...overrides })], skippedDuplicates: [], skippedMembers: [] };
}

describe('invite page helpers', () => {
  it('accepts only Pending and Expired as the list\'s filter', () => {
    expect(isInviteFilter('pending')).toBe(true);
    expect(isInviteFilter('expired')).toBe(true);
    expect(isInviteFilter('accepted')).toBe(false);
  });

  it('builds an invite\'s link on this site from its code', () => {
    expect(buildInviteUrl('abc123')).toBe(`${window.location.origin}/invite/abc123`);
  });

  it('counts an invite as expired when the server says so or its expiry has passed, never when it has none', () => {
    expect(isExpiredInvitation(invite({ status: 'EXPIRED', expiresAt: null }))).toBe(true);
    expect(isExpiredInvitation(invite({ expiresAt: '2020-01-01T00:00:00.000Z' }))).toBe(true);
    expect(isExpiredInvitation(invite({ expiresAt: '2999-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isExpiredInvitation(invite({ expiresAt: null }))).toBe(false);
  });

  it('confirms a sent invite with a toast, and keeps a notice on the page when no email went out', () => {
    expect(describeInviteResult(sent({ emailStatus: 'QUEUED' }))).toEqual({ kind: 'sent', message: 'Invitation sent to friend@example.com' });
    expect(describeInviteResult(sent({ emailStatus: 'SKIPPED' }))).toEqual({
      kind: 'notice',
      message: 'Invitation made for friend@example.com, but no email was sent. Copy its link below to share it.',
      tone: 'warning',
    });
    expect(describeInviteResult(sent({ emailSkipReason: 'SUPPRESSED', emailStatus: 'SKIPPED' }))).toEqual({
      kind: 'notice',
      message: 'Invitation made for friend@example.com, but we can\'t email that address. Copy its link below to share it.',
      tone: 'warning',
    });
  });

  it('says an address that is already a member, or already invited, was skipped, and says nothing when nothing happened', () => {
    expect(describeInviteResult({ sent: [], skippedDuplicates: [], skippedMembers: ['pat@example.com'] })).toEqual({
      kind: 'notice', message: 'pat@example.com is already a member of this league.', tone: 'info',
    });
    expect(describeInviteResult({ sent: [], skippedDuplicates: ['sam@example.com'], skippedMembers: [] })).toEqual({
      kind: 'notice', message: 'sam@example.com already has a pending invitation.', tone: 'info',
    });
    expect(describeInviteResult({ sent: [], skippedDuplicates: [], skippedMembers: [] })).toBeNull();
  });

  it('says where an invite\'s email stands, and calls a suppressed address one we can\'t email without saying why', () => {
    expect(emailStatusLabel(invite(), 'DELIVERED')).toBe('Email delivered');
    expect(emailStatusLabel(invite({ emailSkipReason: 'SUPPRESSED' }), 'SKIPPED')).toBe('We can\'t email this address. Copy the link to share it.');
  });

  it('marks a failed, bounced, complained or suppressed email as a problem, and a sent one as not', () => {
    expect(isEmailProblem(invite(), 'FAILED')).toBe(true);
    expect(isEmailProblem(invite(), 'BOUNCED')).toBe(true);
    expect(isEmailProblem(invite(), 'COMPLAINED')).toBe(true);
    expect(isEmailProblem(invite({ emailSkipReason: 'SUPPRESSED' }), 'SKIPPED')).toBe(true);
    expect(isEmailProblem(invite(), 'SENT')).toBe(false);
  });

  it('counts the people who used a join link in words', () => {
    expect(joinedCount(1)).toBe('1 person has used it');
    expect(joinedCount(3)).toBe('3 people have used it');
  });
});
