/**
 * #184 — one variable says which environment the app is in: `POOLMASTER_ENVIRONMENT`.
 *
 * `NODE_ENV` belongs to Node and third-party libraries, and Terraform sets it to the
 * literal `production` in every deployment. `ENVIRONMENT` was read by provider
 * selection but set nowhere in the repo. These cases assert against the values the
 * deployment actually sets, so a comparison that is silently false shows up here.
 */

import { AppEnvironment, readAppEnv } from '../../../packages/core-api/src/core/config';

describe('readAppEnv', () => {
  it.each(Object.values(AppEnvironment))('returns %s when POOLMASTER_ENVIRONMENT names it', (value) => {
    expect(readAppEnv({ POOLMASTER_ENVIRONMENT: value })).toBe(value);
  });

  it('accepts surrounding whitespace and any letter case, so a hand-typed value still resolves', () => {
    expect(readAppEnv({ POOLMASTER_ENVIRONMENT: ' QA ' })).toBe(AppEnvironment.QA);
  });

  it('throws when POOLMASTER_ENVIRONMENT is unset, rather than borrowing NODE_ENV', () => {
    const deployedNodeEnvOnly: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    expect(() => readAppEnv(deployedNodeEnvOnly)).toThrow(/POOLMASTER_ENVIRONMENT/);
  });

  it('throws on "production", the NODE_ENV spelling, so the deployed name stays "prod"', () => {
    expect(() => readAppEnv({ POOLMASTER_ENVIRONMENT: 'production' })).toThrow(
      /POOLMASTER_ENVIRONMENT "production" is not a known environment/,
    );
  });

  it('ignores the retired ENVIRONMENT variable entirely', () => {
    const env: NodeJS.ProcessEnv = { ENVIRONMENT: 'prod', POOLMASTER_ENVIRONMENT: 'development' };
    expect(readAppEnv(env)).toBe(AppEnvironment.DEVELOPMENT);
  });

  it('reads process.env when no environment object is passed', () => {
    const original = process.env.POOLMASTER_ENVIRONMENT;
    process.env.POOLMASTER_ENVIRONMENT = 'staging';
    try {
      expect(readAppEnv()).toBe(AppEnvironment.STAGING);
    } finally {
      process.env.POOLMASTER_ENVIRONMENT = original;
    }
  });
});
