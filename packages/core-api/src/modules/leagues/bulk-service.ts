/**
 * BulkService — CSV member import.
 *
 * #202 — the last-season copy and its types are gone with the `copy-season` route.
 */

import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import { InvitationStatus, InviteType } from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

// --- CSV Member Import (08-029) ---

export interface CsvImportRow {
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

export interface CsvImportResult {
  total: number;
  sent: number;
  failed: { email: string; reason: string }[];
  duplicates: string[];
}

export class BulkService {
  constructor(
      private readonly leagueRepo: LeagueRepository,
    // Never read. The `private readonly` modifier is dropped rather than the
    // parameter: callers (routes.ts:94 and three unit tests) pass it positionally.
    // An underscore alone does NOT satisfy `noUnusedLocals` for a parameter
    // PROPERTY -- that is TS6138, which the underscore convention does not cover.
    _membershipRepo: LeagueMembershipRepository,
    private readonly invitationRepo: LeagueInvitationRepository,
  ) {}

  /** Imports members from parsed CSV rows, creating invitations for new emails. */
  async importMembersFromCsv(
    leagueId: string,
    invitedBy: string,
    rows: CsvImportRow[],
  ): Promise<CsvImportResult> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new BulkOperationError('League not found', 'LEAGUE_NOT_FOUND');
    }
    const failed: { email: string; reason: string }[] = [];
    const duplicates: string[] = [];
    const emails = rows.map((row) => row.email.toLowerCase().trim());
    const valid = emails.filter((email) => email && email.includes('@'));
    // One read of the pending invitations and one write of the new ones (#1173), not one each per row.
    const pending = new Set((await this.invitationRepo.findPendingByEmails(leagueId, [...new Set(valid)]))
      .map((invitation) => invitation.email));
    const toInvite = new Set<string>();
    for (const email of emails) {
      if (!email || !email.includes('@')) {
        failed.push({ email, reason: 'Invalid email format' });
      } else if (pending.has(email) || toInvite.has(email)) {
        duplicates.push(email);
      } else {
        toInvite.add(email);
      }
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const created = await this.invitationRepo.createMany([...toInvite].map((email) => ({
      leagueId,
      email,
      inviteCode: randomUUID().replace(/-/g, '').slice(0, 12),
      inviteType: InviteType.EMAIL,
      status: InvitationStatus.PENDING,
      maxUses: 1,
      currentUses: 0,
      invitedBy,
      expiresAt,
    })));
    const sent = created.length;
    return { total: rows.length, sent, failed, duplicates };
  }
}

// --- Team Reassignment (08-032) ---

export type ReassignmentAction = 'REASSIGN' | 'VACATE' | 'AUTO_PILOT';

export interface TeamReassignmentInput {
  contestId: string;
  originalMemberId: string;
  action: ReassignmentAction;
  newMemberId?: string;
}

export class BulkOperationError extends Error {
  code: ApiErrorCode;

  constructor(reason: string, code: ApiErrorCode = 'LEAGUE_BULK_OPERATION_INVALID') {
    super(reason);
    this.name = 'BulkOperationError';
    this.code = code;
  }
}
