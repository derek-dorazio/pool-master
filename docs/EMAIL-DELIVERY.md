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

`APP_BASE_URL` is required for links in email bodies. Local development uses
`http://localhost:5173`; Terraform sets the deployed webapp URL.

## SES Infrastructure

Terraform configures the core-api ECS task with `EMAIL_PROVIDER=ses`,
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
