import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

// The function CloudFront runs on every web app request (infrastructure/terraform/cloudfront.tf),
// run here as CloudFront runs it: a script defining `handler`, no module system.
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../infrastructure/terraform/cloudfront-functions/spa-rewrite.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);

function rewrite(uri, userAgent) {
  const headers = userAgent === undefined ? {} : { 'user-agent': { value: userAgent } };
  return context.handler({ request: { uri, headers } }).uri;
}

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const FACEBOOK = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const SLACK = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const WHATSAPP = 'WhatsApp/2.23.20.0';

describe('cloudfront spa-rewrite', () => {
  it('serves a file with an extension as-is, to anyone', () => {
    assert.equal(rewrite('/releases/abc/assets/index-1.js', SAFARI), '/releases/abc/assets/index-1.js');
    assert.equal(rewrite('/releases/abc/og/american-football-championship-weekend.png', FACEBOOK), '/releases/abc/og/american-football-championship-weekend.png');
  });

  it('gives a person the app for every route, event pages included', () => {
    assert.equal(rewrite('/league/OFFICE', SAFARI), '/index.html');
    assert.equal(rewrite('/play/american-football/championship-weekend', SAFARI), '/index.html');
    assert.equal(rewrite('/play/american-football/championship-weekend', undefined), '/index.html');
  });

  it('gives a link-preview crawler the event page\'s own shell, with or without a trailing slash', () => {
    assert.equal(rewrite('/play/american-football/championship-weekend', FACEBOOK), '/play/american-football/championship-weekend/index.html');
    assert.equal(rewrite('/play/american-football/championship-weekend/', SLACK), '/play/american-football/championship-weekend/index.html');
    assert.equal(rewrite('/play/american-football/championship-weekend', WHATSAPP), '/play/american-football/championship-weekend/index.html');
  });

  it('gives a crawler the app for any route that is not an event page', () => {
    assert.equal(rewrite('/how-to-play', FACEBOOK), '/index.html');
    assert.equal(rewrite('/play/american-football', FACEBOOK), '/index.html');
    assert.equal(rewrite('/play/american-football/championship-weekend/extra', FACEBOOK), '/index.html');
  });
});
