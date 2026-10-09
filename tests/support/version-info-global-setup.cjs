/**
 * #180 — core-api reads its build identity from packages/core-api/version-info.json and has no
 * other source, so a test run writes one first, with the same generator a real build uses.
 * Jest `globalSetup` for the unit and integration lanes; the functional lane's global setup
 * calls it too. A version set in the environment (CI passes the commit SHA) wins.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const GENERATOR = path.resolve(__dirname, '../../packages/core-api/scripts/write-version-info.mjs');

function writeTestVersionInfo() {
  execFileSync(process.execPath, [GENERATOR], {
    env: {
      ...process.env,
      POOLMASTER_SERVICE_VERSION: process.env.POOLMASTER_SERVICE_VERSION || '0.0.0-test',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

module.exports = writeTestVersionInfo;
module.exports.writeTestVersionInfo = writeTestVersionInfo;
