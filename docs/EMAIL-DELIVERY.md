# Email Delivery

PoolMaster sends every system email through one call, `EmailService.send(templateKey, input)`
in `packages/core-api/src/modules/email`. It checks `EMAIL_CONFIG` and who may be emailed,
renders the template for the recipient, picks the sender, and hands one email to one person to
the transport. Callers never render or call a transport themselves.

## Templates

Templates are typed TypeScript renderers, not SES stored templates (#844, Q2.1).
`EMAIL_TEMPLATES` in `system-email-templates.ts` is the registry: one entry per
`EmailTemplateKey`, each with its `EmailCategory` (`ACCOUNT`, `MEMBERSHIP`,
`COMMISSIONER_UPDATES`, `CONTEST_UPDATES`, `LIVE_STANDINGS`, `RESULTS`, `RECEIPTS`, the
notification catalog's categories) and its renderer. Adding a key without a registry entry, a
scope in `EmailTemplateScopeByKey`, a settings switch or a preview example is a compile error.
Each template's data is a TypeScript type, so a missing token can't merge, and every value is
HTML-escaped. Dates are shown in the recipient's time zone (their account setting), with the
zone named, or in UTC when they have none.

`npm run email:preview` renders every template with the examples in
`tests/support/email-template-fixtures.ts` into `tmp/email-preview/` (HTML and plain text);
`npm run email:preview -- --send` also sends each one to local Mailpit.

## Sender

There is no Reply-To (#844, Q6.2): a reply to the sender bounces.

- **League emails** (every email about one league, which is every email today) come from that
  league's address in its name: `Office League <office24@qa.ultimateofficepoolmanager.com>`, the
  league code lowercased at the sending domain (the domain of `SES_FROM_EMAIL` or
  `SMTP_FROM`). It is presentation only; nothing receives mail there, and SES needs nothing per
  league. A league can't take a code that is a role address (`NOREPLY`, `POSTMASTER`, `ABUSE`,
  `ADMIN`, `SUPPORT`, `SECURITY`, `BOUNCE`, `HOSTMASTER`, `WEBMASTER`):
  creation refuses it with `LEAGUE_CODE_RESERVED`, and a league that has one already sends from
  the `noreply@` address in its name.
- **Platform emails** (account emails, with no league) come from `Prime Time Commissioner
  <noreply@…>`.

## Providers

`EMAIL_PROVIDER=smtp` is the local default. It sends through Mailpit in the
developer stack:

- `SMTP_HOST=localhost`
- `SMTP_PORT=1025`
- `SMTP_FROM=noreply@poolmaster.local`

`EMAIL_PROVIDER=ses` is used in deployed environments. The provider sends the
same rendered subject, text, and HTML through the AWS SES v2 API (`SendEmail` with simple
content):

- `AWS_REGION` selects the SES region.
- `SES_FROM_EMAIL` is the environment's `noreply@` address at the verified sending domain.
- `SES_CONFIGURATION_SET` names the configuration set every send goes through
  (reputation metrics and bounce/complaint suppression). Terraform sets it.
- `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are supported
  for LocalStack/dev overrides.

## Switching Email Off

Whether email is sent is the `EMAIL_CONFIG` app setting, which a root admin changes on the
Email card of `/manage/settings`; every core-api task picks a save up within 30 seconds. It
holds:

- `enabled`: whether any system email is sent. It defaults to off when `POOLMASTER_ENVIRONMENT=qa`
  and on everywhere else.
- `templates`: one switch per system email, all on by default. Account emails (password reset and
  password changed) have no switch: switching one off would silently break password recovery. They still
  obey `enabled` and "Only send to".
- `allowedRecipients` ("Only send to"): when not empty, the only recipients email goes to, each
  a whole address or `@domain`, compared without case. Every other recipient is skipped. Empty
  (the default) means no limit.

Through SES, an address at a domain reserved by RFC 2606 and RFC 6761 (`.invalid`, `.test`,
`.example`, `.localhost`, `example.com`, `example.net`, `example.org`) is always skipped: no mail
server answers for them, so a send would only hard-bounce. The e2e smoke users are
`@e2e.invalid`, so smoke runs on QA never send. Mailpit and the test SMTP sink catch every
address, so SMTP sends to them.

An email that is skipped still reports success, so invite by email still creates the invitation
and the request succeeds. Each skip is logged as `email.send.skip` with the reason
(`EMAIL_DISABLED`, `TEMPLATE_DISABLED` or `NOT_ALLOWED_IN_ENVIRONMENT`), the template key and
ids, never the body or an address. The transport (`EMAIL_PROVIDER`) and the
sender address stay in env, because they describe how the deployment is wired.

## Testing on QA Without Emailing Real People

1. On `/manage/settings`, set "Only send to" to your own address(es), and to
   `@simulator.amazonses.com` for the SES mailbox simulator.
2. Give manual test users plus-addresses of your inbox (`you+alice@gmail.com`,
   `you+bob@gmail.com`); Gmail delivers them all to you, through real SES.
3. Switch "Send system email" on and send an invite to one of them. In Gmail, "Show original"
   should show DKIM, SPF and DMARC all `PASS`.
4. Bounces and complaints are tried by inviting `bounce@simulator.amazonses.com` and
   `complaint@simulator.amazonses.com`, which hurts no sending reputation.

`APP_BASE_URL` is required for links in email bodies. Local development uses
`http://localhost:5173`; Terraform sets the deployed webapp URL.

## Seeing Emails Locally

`npm run dev:infra` starts Mailpit with Postgres. With the local defaults above,
every email the app sends lands in Mailpit's inbox at http://localhost:8025,
whatever the recipient address; nothing reaches a real mailbox.

## Tests

The integration and functional lanes send through a local SMTP sink
(`tests/support/smtp-sink.ts`) that records each message's envelope recipients,
subject and plain-text body. `tests/functional/email.functional.ts` asserts that
each of the four system emails (league invite, league welcome, entry
confirmation, contest started) is sent once, to the right person, with the
right subject and link; the functional server runs with a fixed
`APP_BASE_URL` so links are exact. `tests/functional/password-reset.functional.ts`
reads the reset link out of the reset email and uses it. Functional tests read the sink through
`tests/functional/mail.ts`. `tests/integration/core-api/email-settings.integration.ts`
covers switching email, and one email, off, and the allow list.

## SES Infrastructure

Terraform sets the core-api ECS task's `EMAIL_PROVIDER` to `ses` in every
environment; QA's "send nothing yet" is the `EMAIL_CONFIG` default above. Terraform also configures
`APP_BASE_URL`, `AWS_REGION`, `SES_FROM_EMAIL`, `SES_CONFIGURATION_SET` and
`POOLMASTER_ENVIRONMENT`, and grants the ECS task role `ses:SendEmail` and `ses:SendRawEmail`
for the SES identity and the configuration set.

Each environment sends from its own subdomain, the same one the app is served on
(QA `noreply@qa.<domain_name>`, prod `noreply@<domain_name>`), so QA bounces and test complaints
never touch prod's sending reputation. When `domain_name` is configured, Terraform creates for
that sending domain:

- the SES domain identity with Easy DKIM, and (with `route53_zone_id`) its three DKIM CNAMEs;
- a custom MAIL FROM domain `bounce.<sending domain>` with its MX and SPF TXT records, so SPF
  passes for our domain and counts toward DMARC;
- a DMARC TXT record at `_dmarc.<sending domain>`, starting at `p=none`, with aggregate reports
  to `dmarc_report_email` when set;
- the configuration set `<project>-<environment>`, with reputation metrics on and bounces and
  complaints suppressed through the SES account suppression list.

When no domain is configured, Terraform creates an email identity for the configured sender
address; that address must be verified in SES before deployed delivery can succeed.

The one-time AWS steps (applying, and requesting production access to leave the SES sandbox) are
in `infrastructure/terraform/README.md`, *System email (SES)*.

## Success Semantics

League invite-by-email returns success only after PoolMaster creates the
invitation record and submits the rendered email to the configured provider.
If provider submission fails, the API returns
`LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED` and logs provider, template, league,
and invitation identifiers without logging email body content.

Resend Invite (Commissioner tools › Invites, commissioner only) follows the same rule. It
gives the invitation a new invite code and a fresh seven-day expiry before
sending, so the old link stops working even when the provider then rejects the
email; the commissioner sees `LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED` and can
resend again. When `EMAIL_CONFIG` has the league invite email switched off, a
resend still renews the code and reports success; the email is skipped, so the
commissioner shares the new link another way.

Contest entry confirmation emails ("Entry submitted") are best-effort receipts,
sent when a member submits an entry (#481), not when its picks or tiebreaker
are saved. A repeat submit of an already submitted entry sends nothing. The
submitted entry is not rolled back when provider submission fails; PoolMaster
logs the template, league, contest, and entry identifiers for follow-up.

Password reset emails (#847) go through `EmailService` like every other email, from the app's
`noreply@` address, and are sent at once, inside the request that asked for them, never queued, because the link expires 10 minutes after it is issued. The request route has already
answered 202 by then, the same answer it gives when no account matches, so a provider failure is
only logged (user id, never the address, token or link) and the person asks again.

Password changed emails (#848) go after a reset by link and after a person changes their own
password, not after a root admin's reset. They are sent after the password write commits; a
provider failure is logged and never undoes the change.

Contest started summary emails are sent when a sport event moves to
`IN_PROGRESS` (a root admin's transition, or the lifecycle scheduler) and first
moves its contests from `OPEN` to `ACTIVE`. They go to the league's
commissioners and the team members of each submitted entry, once each. An already-active
contest is not told again. Delivery is best effort; the transition still
succeeds if the provider rejects the email,
and PoolMaster logs the template, league, contest, and user identifiers.
