/**
 * Runtime config bootstrap.
 *
 * Per `service-rules.md §1` *Banned Backend Patterns* and the
 * `pool-master-rop.76.1` security defect: secrets must come from a
 * single bootstrap source that throws on missing values. No per-module
 * `process.env.X ?? '<literal>'` fallbacks anywhere in
 * `packages/core-api/src/`.
 *
 * The deterministic dev signing key
 * (`'poolmaster-dev-secret-change-in-production'`) used to live as the
 * `??`-fallback in three call sites. That string is no longer in any
 * code path that ships to production: dev/test must set the env var
 * explicitly (via `.env`, shell export, or test setup), and production
 * deployments must inject it via secret management (e.g.
 * AWS Secrets Manager → ECS task `secrets` block, K8s Secret mounted
 * as env, etc.). If `JWT_SECRET` is unset at the moment a reader
 * resolves it, `readJwtSecret()` throws — the substrate fails loud
 * rather than silently signing tokens with a known string.
 *
 * Readers call this function at runtime (plugin registration, service
 * construction) so test runners and bootstrap-config loaders can set
 * `process.env.JWT_SECRET` before the first call. Module-scope reads
 * are deliberately avoided.
 */

export class JwtSecretMissingError extends Error {
  constructor() {
    super(
      'JWT_SECRET environment variable is required. Set it via your '
      + 'shell, .env file, or deployment secret manager (e.g. AWS Secrets '
      + 'Manager). The previous deterministic dev fallback was removed in '
      + 'pool-master-rop.76.1 — production must fail loud rather than '
      + 'silently sign tokens with the published default. See .env.example '
      + 'for the dev placeholder.',
    );
    this.name = 'JwtSecretMissingError';
  }
}

/**
 * Resolve `JWT_SECRET` from `process.env` and throw if unset.
 *
 * Called once per reader at runtime — there is no caching at the
 * module level on purpose, so tests that override the env between
 * cases see fresh values and so importing this module never has a
 * side-effect on the env state.
 */
export function readJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new JwtSecretMissingError();
  }
  return secret;
}
