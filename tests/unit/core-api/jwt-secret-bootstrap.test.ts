/**
 * Defect-proof for pool-master-rop.76.1 — JWT_SECRET fallback ships a
 * deterministic dev signing key in production code.
 *
 * Pre-fix state: three production files duplicated
 *   `process.env.JWT_SECRET ?? 'poolmaster-dev-secret-change-in-production'`
 * — the published default would silently sign every JWT if the env
 * var was unset. The fix removes all three fallbacks and routes every
 * reader through `readJwtSecret()` in `packages/core-api/src/core/config.ts`,
 * which throws when the env var is missing.
 *
 * On origin/main these structural assertions all fail (the bootstrap
 * module doesn't exist; the call-site grep finds the legacy literal).
 * On this branch every assertion passes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readJwtSecret,
  JwtSecretMissingError,
} from '../../../packages/core-api/src/core/config';

const CORE_API_SRC = resolve(__dirname, '../../../packages/core-api/src');

const previousSecret = process.env.JWT_SECRET;

describe('pool-master-rop.76.1 — JWT_SECRET single bootstrap source', () => {
  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  });

  describe('readJwtSecret()', () => {
    it('returns the env value when JWT_SECRET is set', () => {
      process.env.JWT_SECRET = 'integration-test-secret';
      expect(readJwtSecret()).toBe('integration-test-secret');
    });

    it('throws JwtSecretMissingError when JWT_SECRET is unset', () => {
      delete process.env.JWT_SECRET;
      expect(() => readJwtSecret()).toThrow(JwtSecretMissingError);
    });

    it('throws JwtSecretMissingError when JWT_SECRET is empty string', () => {
      process.env.JWT_SECRET = '';
      expect(() => readJwtSecret()).toThrow(JwtSecretMissingError);
    });

    it('throws JwtSecretMissingError when JWT_SECRET is whitespace-only', () => {
      process.env.JWT_SECRET = '   ';
      expect(() => readJwtSecret()).toThrow(JwtSecretMissingError);
    });
  });

  describe('no production code path retains the dev fallback literal', () => {
    const ORIGIN_MAIN_LITERAL = 'poolmaster-dev-secret-change-in-production';
    const FILES = [
      'plugins/admin-auth.ts',
      'plugins/auth-guard.ts',
      'modules/auth/auth-service.ts',
    ];

    it.each(FILES)('does not contain the dev fallback literal in %s', (relPath) => {
      const src = readFileSync(resolve(CORE_API_SRC, relPath), 'utf8');
      expect(src).not.toMatch(new RegExp(ORIGIN_MAIN_LITERAL));
    });

    it.each(FILES)('does not contain the `process.env.JWT_SECRET ?? ...` pattern in %s', (relPath) => {
      const src = readFileSync(resolve(CORE_API_SRC, relPath), 'utf8');
      expect(src).not.toMatch(/process\.env\.JWT_SECRET\s*\?\?/);
    });

    it('routes all three call sites through readJwtSecret()', () => {
      for (const relPath of FILES) {
        const src = readFileSync(resolve(CORE_API_SRC, relPath), 'utf8');
        expect(src).toMatch(/readJwtSecret\(\)/);
      }
    });
  });
});
