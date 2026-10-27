import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// The web app's build is uploaded under releases/<sha>/, and its own script and styles are linked
// there. A file under public/ that is linked by a root path instead, the same on every release,
// must also be copied to the bucket's root, or CloudFront answers S3's AccessDenied for it.
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const deployStep = workflow.slice(workflow.indexOf('id: deploy-webapp'), workflow.indexOf('echo "release_prefix='));

describe('QA web app deploy', () => {
  it('copies public/email/ to the bucket root, because emails and event pages link its photos by /email/ on every release', () => {
    assert.match(deployStep, /aws s3 sync clients\/poolmaster\/dist\/email\/ "s3:\/\/\$\{BUCKET\}\/email\/"/);
  });
});
