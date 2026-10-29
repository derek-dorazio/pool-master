import { createHash } from 'node:crypto';

/**
 * What `refresh_tokens` stores for a refresh token: its SHA-256 in hex (#1230). A read of the
 * table, from a backup or a leak, then hands out no session; the token is random, so an unsalted
 * hash cannot be reversed.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
