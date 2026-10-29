import { createHash } from 'node:crypto';

/** A refresh token's stored form; only `hashRefreshToken` makes one, so a raw token cannot pass as it. */
export type RefreshTokenHash = string & { readonly __brand: 'RefreshTokenHash' };

/**
 * What `refresh_tokens` stores for a refresh token: its SHA-256 in hex (#1230). A read of the
 * table, from a backup or a leak, then hands out no session; the token is random, so an unsalted
 * hash cannot be reversed.
 */
export function hashRefreshToken(token: string): RefreshTokenHash {
  return createHash('sha256').update(token).digest('hex') as RefreshTokenHash;
}
