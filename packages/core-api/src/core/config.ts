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

// ---------------------------------------------------------------------------
// Deployment identity: environment name and running version
// ---------------------------------------------------------------------------

export class RequiredEnvMissingError extends Error {
  constructor(name: string, purpose: string, suggestion: string) {
    super(
      `${name} environment variable is required — ${purpose}. ${suggestion} `
      + 'There is deliberately no default: a hardcoded fallback means a '
      + 'misconfigured deployment reports something plausible and wrong rather '
      + 'than failing at startup. See .env.example.',
    );
    this.name = 'RequiredEnvMissingError';
  }
}

/**
 * Resolve the deployment environment name and throw if unset.
 *
 * This used to be `process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'`
 * in `core/logger.ts`. The scanner that bans env fallbacks never caught it,
 * because the chain spanned three lines and the scanner matched one line at a
 * time — so every log line from a misconfigured production box claimed
 * `env: "development"`, which is both wrong and the exact signal an operator
 * would use to tell those apart.
 *
 * The variable is `POOLMASTER_ENVIRONMENT` rather than a new name, deliberately.
 * The codebase already carries FOUR names for "which environment is this":
 * `POOLMASTER_ENVIRONMENT` (this, the webapp build, `VersionService`),
 * `ENVIRONMENT` (ingestion provider selection, `provider-bindings.ts`),
 * `NODE_ENV` (the secure-cookie flag, default log level), and briefly `APP_ENV`,
 * which this reader introduced and which is now gone. Consolidating the
 * remaining three is #180; adding a fourth was not worth the blast radius.
 *
 * Note this value drives NO behaviour. Its only consumer is the `env:` field on
 * log lines. Anything that branches reads `NODE_ENV` or `ENVIRONMENT` instead,
 * so changing this cannot silently flip a code path.
 */
export function readAppEnv(): string {
  const value = process.env.POOLMASTER_ENVIRONMENT;
  if (!value || value.trim().length === 0) {
    throw new RequiredEnvMissingError(
      'POOLMASTER_ENVIRONMENT',
      'log lines are labelled with it, so an operator can tell environments apart',
      'Set it to the deployment environment name (development, test, qa, staging, production).',
    );
  }
  return value;
}

/**
 * Resolve the running service version and throw if no source provides one.
 *
 * `POOLMASTER_SERVICE_VERSION` is listed first because it is the name the deploy
 * pipeline actually sets — `.github/workflows/ci.yml` injects it into the core-api
 * ECS task definition from the full commit SHA. The rest are accepted aliases for
 * local runs and other harnesses.
 *
 * This chain is NOT a fallback: every entry is an environment variable, and the
 * function still throws when none is set. A `?? 'literal'` at the end would be the
 * banned pattern — a name list is not.
 *
 * `npm_package_version` is last and is set only when the process was started
 * through an npm script. A container running `node dist/index.js` has none of
 * these unless the deployment supplies one — which is the point: a service that
 * cannot say what version it is running should not start, rather than reporting a
 * number someone hardcoded once.
 */
export function readServiceVersion(): string {
  const value = process.env.POOLMASTER_SERVICE_VERSION
    || process.env.RELEASE_VERSION
    || process.env.APP_VERSION
    || process.env.GIT_SHA
    || process.env.npm_package_version;
  if (!value || value.trim().length === 0) {
    throw new RequiredEnvMissingError(
      'POOLMASTER_SERVICE_VERSION',
      'health output and log lines report the running version',
      'Set POOLMASTER_SERVICE_VERSION (or RELEASE_VERSION / APP_VERSION / GIT_SHA) at deploy time.',
    );
  }
  return value;
}
