// The environment variables PoolMaster code reads, declared so `process.env.X` is
// a typed property rather than a read through Node's `[key: string]` index
// signature. `noPropertyAccessFromIndexSignature` (tsconfig.base.json) rejects a
// dot read of a name that is not listed here, so a new variable gets declared
// before it gets read. Every entry is `string | undefined`: declaring a variable
// says the code knows its name, not that a deployment sets it.
//
// Loaded into every program through `files` in tsconfig.base.json, and listed in
// clients/poolmaster/tsconfig.e2e.json and tsconfig.node.json, which do not extend the base.

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Which environment this is (#184): read only through readAppEnv().
      POOLMASTER_ENVIRONMENT?: string;
      // Node's and third-party libraries' variable. Our code never reads it
      // (poolmaster/no-node-env-reads); tests set it to prove that.
      NODE_ENV?: string;

      // core-api runtime
      PORT?: string;
      LOG_LEVEL?: string;
      JWT_SECRET?: string;
      APP_BASE_URL?: string;
      AUTO_START_SCHEDULER?: string;
      POOLMASTER_DISABLE_AUTO_START?: string;
      CLIENT_LOGS_RATE_LIMIT_PER_MIN?: string;
      OPENAPI_EXPORT?: string;
      // Where packages/core-api/scripts/export-openapi.ts writes the spec; scripts/check-openapi-fresh.mjs
      // points it at a temp file to compare against the committed one.
      OPENAPI_OUTPUT_PATH?: string;

      // core-api build version. Read by scripts/export-openapi.ts to write a
      // version-info.json, and by the web app build (vite.config.ts) for the service
      // version it reports. The running service reads only that file (#180).
      POOLMASTER_SERVICE_VERSION?: string;

      // core-api email delivery
      EMAIL_PROVIDER?: string;
      SMTP_HOST?: string;
      SMTP_PORT?: string;
      SMTP_SECURE?: string;
      SMTP_USERNAME?: string;
      SMTP_PASSWORD?: string;
      SMTP_FROM?: string;
      SES_FROM_EMAIL?: string;
      SES_CONFIGURATION_SET?: string;
      AWS_REGION?: string;
      AWS_ENDPOINT?: string;
      AWS_ACCESS_KEY_ID?: string;
      AWS_SECRET_ACCESS_KEY?: string;

      // core-api sport-data provider bindings
      SPORT_DATA_DEFAULT_PROVIDER?: string;
      SPORT_DATA_PROVIDER_BINDINGS_JSON?: string;
      SPORT_DATA_ALLOW_MOCK_PROVIDER_IN_STRICT_RUNTIME?: string;
      SPORT_DATA_MOCK_PROVIDER_OVERRIDE_REASON?: string;

      // mock-contest-feed-provider
      SCENARIO_DIR?: string;

      // web app build (clients/poolmaster/vite.config.ts)
      APP_ASSET_BASE?: string;
      GITHUB_RUN_NUMBER?: string;
      GITHUB_SHA?: string;
      POOLMASTER_BUILD_NUMBER?: string;
      POOLMASTER_BUILD_TIME_UTC?: string;
      POOLMASTER_GIT_REF?: string;
      POOLMASTER_RELEASE_PREFIX?: string;
      POOLMASTER_SERVICE_GIT_SHA?: string;
      POOLMASTER_WEBAPP_GIT_SHA?: string;
      POOLMASTER_WEBAPP_VERSION?: string;

      // golf seed CLI (packages/core-api/scripts/seed-golf/cli.ts, the "Seed QA golf data" workflow)
      POOLMASTER_SEED_BASE_URL?: string;
      POOLMASTER_SEED_ADMIN_IDENTIFIER?: string;
      POOLMASTER_SEED_ADMIN_PASSWORD?: string;

      // test harnesses
      CI?: string;
      DATABASE_URL?: string;
      FUNCTIONAL_RUN_ID?: string;
      FUNCTIONAL_INVOCATION_ID?: string;
      FUNCTIONAL_SERVER_STATE_FILE?: string;
      FUNCTIONAL_SPAWNER_PID?: string;
      POOLMASTER_E2E_BASE_URL?: string;
      POOLMASTER_E2E_BROWSER_CHANNEL?: string;
      POOLMASTER_E2E_ADMIN_IDENTIFIER?: string;
      POOLMASTER_E2E_ADMIN_PASSWORD?: string;
    }
  }
}

export {};
