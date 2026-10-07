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
- `EMAIL_REPLY_TO=noreply@poolmaster.local`

`EMAIL_PROVIDER=ses` is used in deployed environments. The provider sends the
same rendered subject, text, and HTML through AWS SES:

- `AWS_REGION` selects the SES region.
- `SES_FROM_EMAIL` is the verified sender address.
- `EMAIL_REPLY_TO` is optional and defaults to the sender when Terraform owns it.
- `SES_CONFIGURATION_SET` is optional for SES event tracking.
- `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are supported
  for LocalStack/dev overrides.

`EMAIL_PROVIDER=disabled` sends nothing. Every send reports success, so invite
by email still creates the invitation and the request succeeds; each skipped
email is logged as `mailDelivery.disabled.skip` with the template key and ids
(never the body), and startup logs `mailDelivery.startup.disabled` once, as a warning. QA
runs this way until real delivery is set up (#120).

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
`tests/functional/mail.ts`. `tests/integration/core-api/email-disabled.integration.ts`
covers `EMAIL_PROVIDER=disabled`.

## SES Infrastructure

Terraform sets the core-api ECS task's `EMAIL_PROVIDER` from the
`email_provider` variable. Left empty, it is `disabled` on QA (until #120) and
`ses` on staging and prod; Terraform refuses `disabled` on prod. Terraform also configures
`APP_BASE_URL`, `AWS_REGION`, `SES_FROM_EMAIL`, and `EMAIL_REPLY_TO`. It also
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
