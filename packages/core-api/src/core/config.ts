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

import { BlockList, isIP } from 'node:net';

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
// Deployment identity: environment name (the running version is core/version-info.ts)
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
 * Which environment this process runs in (#184). `POOLMASTER_ENVIRONMENT` is the one
 * variable that says so, and every environment-gated behaviour in our code reads it
 * through `readAppEnv()`.
 *
 * `NODE_ENV` is not ours: it belongs to Node and third-party libraries, holds only
 * `development` | `test` | `production`, and Terraform sets it to `production` in every
 * deployment. Our code never reads it; `poolmaster/no-node-env-reads` enforces that.
 * The deployed names here are Terraform's `var.environment` values, so `prod`, never
 * `production`. `ci` is what the CI workflows set.
 */
export const AppEnvironment = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  CI: 'ci',
  QA: 'qa',
  STAGING: 'staging',
  PROD: 'prod',
} as const;
export type AppEnvironment = (typeof AppEnvironment)[keyof typeof AppEnvironment];

const APP_ENVIRONMENTS: ReadonlySet<string> = new Set(Object.values(AppEnvironment));

function isAppEnvironment(value: string): value is AppEnvironment {
  return APP_ENVIRONMENTS.has(value);
}

/** The deployed environments: the ones Terraform's `var.environment` can name. */
export function isDeployedEnvironment(environment: AppEnvironment): boolean {
  return environment === AppEnvironment.QA
    || environment === AppEnvironment.STAGING
    || environment === AppEnvironment.PROD;
}

/**
 * Resolve `POOLMASTER_ENVIRONMENT` and throw if it is unset or not an `AppEnvironment`.
 *
 * There is no fallback to `NODE_ENV` or to a literal. Before #184 three variables answered
 * this question, and a check against the wrong one shipped session cookies without
 * `Secure` (#182). An unknown name throws instead of being treated as some environment,
 * so a typo fails at startup rather than switching a behaviour on or off.
 */
export function readAppEnv(
  env: { readonly POOLMASTER_ENVIRONMENT?: string } = process.env,
): AppEnvironment {
  const raw = env.POOLMASTER_ENVIRONMENT;
  if (!raw || raw.trim().length === 0) {
    throw new RequiredEnvMissingError(
      'POOLMASTER_ENVIRONMENT',
      'environment-gated behaviour (secure cookies, provider selection, email defaults) and log lines read it',
      `Set it to one of: ${[...APP_ENVIRONMENTS].join(', ')}.`,
    );
  }
  const value = raw.trim().toLowerCase();
  if (!isAppEnvironment(value)) {
    throw new Error(
      `POOLMASTER_ENVIRONMENT "${raw}" is not a known environment. `
      + `Use one of: ${[...APP_ENVIRONMENTS].join(', ')}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Proxies in front of the app (#856)
// ---------------------------------------------------------------------------

/** Fastify's `trustProxy` as a function: whether the address `hop` steps back is a trusted proxy. */
export type TrustProxyFn = (address: string, hop: number) => boolean;

/**
 * Which proxies in front of this process to believe about the caller, passed to Fastify as
 * `trustProxy`, so `request.ip` (which the per-address rate limits key on) is the caller rather
 * than a proxy.
 *
 * `TRUSTED_PROXY_HOPS` is how many proxies add an `X-Forwarded-For` entry, and
 * `TRUSTED_PROXY_NETWORK` is the CIDR the nearest one connects from. Deployed, Terraform sets
 * 2 (CloudFront, then the ALB) and the VPC's CIDR. A connection from outside that network trusts
 * no header at all, so a caller who reaches the task some other way cannot choose their address.
 * The hop behind the ALB is believed because the ALB security group admits CloudFront alone.
 *
 * Both unset means no proxy and no forwarded header is trusted, which is right for local runs
 * and tests. One without the other, or a malformed value, throws at startup.
 */
export function readTrustProxy(
  env: {
    readonly TRUSTED_PROXY_HOPS?: string;
    readonly TRUSTED_PROXY_NETWORK?: string;
    readonly [name: string]: string | undefined;
  } = process.env,
): TrustProxyFn | false {
  const rawHops = env.TRUSTED_PROXY_HOPS?.trim();
  const rawNetwork = env.TRUSTED_PROXY_NETWORK?.trim();
  if (!rawHops && !rawNetwork) return false;
  if (!rawHops || !rawNetwork) {
    throw new Error('TRUSTED_PROXY_HOPS and TRUSTED_PROXY_NETWORK must be set together.');
  }
  const hops = Number(rawHops);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
    throw new Error(`TRUSTED_PROXY_HOPS "${rawHops}" must be a whole number from 1 to 5.`);
  }
  const [networkAddress = '', prefixText = ''] = rawNetwork.split('/');
  const prefix = prefixText === '' ? Number.NaN : Number(prefixText);
  if (isIP(networkAddress) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`TRUSTED_PROXY_NETWORK "${rawNetwork}" must be an IPv4 CIDR such as 10.0.0.0/16.`);
  }
  const nearestProxies = new BlockList();
  nearestProxies.addSubnet(networkAddress, prefix, 'ipv4');
  return (address, hop) => {
    if (hop >= hops) return false;
    if (hop > 0) return true;
    const ipv4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
    return isIP(ipv4) === 4 && nearestProxies.check(ipv4, 'ipv4');
  };
}
