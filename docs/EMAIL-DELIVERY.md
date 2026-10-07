# Email Delivery

PoolMaster sends system emails through the core-api mail-delivery abstraction.
The message body is rendered by the source-controlled Prime Time Commissioner
template registry in `packages/core-api/src/modules/email`.

## Providers

`EMAIL_PROVIDER=smtp` is the local default. It sends through Mailpit in the
developer stack:

- `SMTP_HOST=localhost`
- `SMTP_PORT=1025`
- `SMTP_FROM=noreply@poolmaster.local`

`EMAIL_PROVIDER=ses` is used in deployed environments. The provider sends the
same rendered subject, text, and HTML through AWS SES:

- `AWS_REGION` selects the SES region.
- `SES_FROM_EMAIL` is the verified sender address.
- `SES_CONFIGURATION_SET` is optional for SES event tracking.
- `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are supported
  for LocalStack/dev overrides.

## Switching Email Off

Whether email is sent is the `EMAIL_CONFIG` app setting, which a root admin changes on the
Email card of `/manage/settings`; every core-api task picks a save up within 30 seconds. It
holds:

- `enabled`: whether any system email is sent. It defaults to off when `ENVIRONMENT=qa` (until
  real delivery is set up, #120) and on everywhere else.
- `templates`: one switch per system email, all on by default.
- `replyTo`: the Reply-To address, or none (the default), so replies go to the sender.

An email that is switched off is skipped, and the send still reports success, so invite by
email still creates the invitation and the request succeeds. Each skip is logged as
`mailDelivery.skip` with the reason (`emailDisabled` or `templateDisabled`), the template key and
ids, never the body or an address. The transport (`EMAIL_PROVIDER`) and the sender address stay
in env, because they describe how the deployment is wired.

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
`APP_BASE_URL` so links are exact. Functional tests read the sink through
`tests/functional/mail.ts`. `tests/integration/core-api/email-settings.integration.ts`
covers switching email, and one email, off.

## SES Infrastructure

Terraform sets the core-api ECS task's `EMAIL_PROVIDER` to `ses` in every
environment; QA's "send nothing yet" is the `EMAIL_CONFIG` default above. Terraform also configures
`APP_BASE_URL`, `AWS_REGION`, `SES_FROM_EMAIL`, and `ENVIRONMENT`. It also
grants the ECS task role `ses:SendEmail` and `ses:SendRawEmail` for the managed
SES identity.

When `domain_name` is configured, Terraform creates an SES domain identity for
that domain and DKIM tokens. If `route53_zone_id` is also configured, Terraform
creates the DKIM CNAME records. When no domain is configured, Terraform creates
an email identity for the configured sender address; that address must be
verified in SES before deployed delivery can succeed.

SES sandbox accounts can send only to verified recipients. Move the account out
of sandbox before production-style invitations are sent to arbitrary member
emails.

## Success Semantics

League invite-by-email returns success only after PoolMaster creates the
invitation record and submits the rendered email to the configured provider.
If provider submission fails, the API returns
`LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED` and logs provider, template, league,
and invitation identifiers without logging email body content.

Contest entry confirmation emails are best-effort receipts. The saved entry is
not rolled back when provider submission fails; PoolMaster logs the template,
league, contest, and entry identifiers for follow-up.

Contest started summary emails are sent when a sport event moves to
`IN_PROGRESS` (a root admin's transition, or the lifecycle scheduler) and first
moves its contests from `OPEN` or `LOCKED` to `ACTIVE`. They go to the league's
commissioners and each entrant's team members, once each. An already-active
contest is not told again. Delivery is best effort; the transition still
succeeds if the provider rejects the email,
and PoolMaster logs the template, league, contest, and user identifiers.
