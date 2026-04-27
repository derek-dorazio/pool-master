# SES System Email Integration Plan

Beads story: `pool-master-gs4`

## Purpose

PoolMaster needs real system email delivery so league invitations and contest entry confirmations are not blocked on manual copy/paste workarounds. This plan frames the SES integration before implementation so the service, infrastructure, templates, logging, and tests land as one coherent email lane.

Related stories:

- `pool-master-7ij` - send league invitation emails through a configured mail provider.
- `pool-master-95b` - send contest entry confirmation emails.
- `pool-master-98i` - wire static system email templates for league invite and entry completed emails.

## Current Truth

(Confirmed) The league invitation API creates invitation records and returns invite codes, but it does not submit email to a provider yet.

(Confirmed) The contest entry flow can now save picks and the relative-to-par tiebreaker, but there is no delivery capability for an entry confirmation email.

(Confirmed) Infrastructure already has SES-oriented hints such as sender configuration, but there is no completed service abstraction that both invitation and entry-confirmation flows can call.

## Design Direction

Add a service-owned mail delivery abstraction in `packages/core-api` with SES as the deployed provider and a non-delivering local/dev provider that logs the delivery envelope and rendered template metadata. The application should call the abstraction from domain workflows after the domain record is successfully persisted.

The initial templates should be static source-controlled templates, not database-managed records. Even if the first implementation keeps template source close to the webapp for easy iteration, the service should consume them through a narrow template-rendering interface so template storage can later move to shared package files, database records, or root-admin tooling without rewriting the invitation and contest-entry services.

## Email Types

League invite email:

- Trigger: commissioner invites by email.
- Recipient: invited email address.
- Required data: league name, league code, invite URL, invite code, inviter context when available, expiration when available.
- Behavior: preserve invitation records as the source of truth; email delivery failure must be logged and surfaced according to the chosen API semantics.

Contest entry completed email:

- Trigger: user submits a completed contest entry.
- Recipient: submitting user's email.
- Required data: league name/code when available, contest name, entry name, selected golfers grouped by tier, tiebreaker relative to par, contest lock time.
- Behavior: send after entry details and tiebreaker save succeeds; do not imply the entry is locked or final beyond the saved picks.

## Service Architecture

Create a mail module with these roles:

- `MailProvider`: submits a rendered email envelope.
- `SesMailProvider`: AWS SES implementation for QA/prod.
- `LoggingMailProvider` or `NoopMailProvider`: local/dev implementation that records structured logs without external delivery.
- `EmailTemplateRegistry`: resolves static templates by template id.
- `EmailRenderer`: renders subject, text, and HTML from typed template data.
- `SystemEmailService`: orchestrates render, provider submit, logging, and normalized errors.

The domain services should depend on `SystemEmailService`, not on SES directly.

## Configuration

Expected runtime settings:

- provider mode: `ses`, `log`, or `disabled`
- from email
- reply-to email, optional
- AWS region
- SES configuration set, optional
- application base URL for invite links
- delivery timeout/retry policy

No secrets should appear in template data, logs, API responses, or version metadata.

## Logging And Observability

Log one structured info event for each attempted delivery with:

- template id
- recipient count
- league id / contest id / entry id when applicable
- provider mode
- SES message id on success

Log warn/error events for:

- missing recipient email
- missing template data
- render failure
- SES rejection/throttle
- provider timeout

Do not log full rendered HTML or full email bodies in production logs.

## Testing Plan

Unit tests:

- template rendering for league invite and entry completed emails
- provider selection from config
- service behavior on provider success and failure

Service tests:

- invite-by-email persists invitations and calls `SystemEmailService`
- contest entry submit/save calls confirmation email after completed picks and tiebreaker are present
- failures do not create fake success states

Functional API tests:

- invite endpoint response semantics with mail provider mocked
- entry submit/save response semantics with mail provider mocked

Infrastructure validation:

- Terraform/env wiring for sender and provider mode
- SES sandbox/domain verification notes for QA

## Rollout

1. Land template registry and no-op/log provider behind disabled/log mode.
2. Wire invitation email delivery and tests.
3. Wire contest entry confirmation delivery and tests.
4. Add SES provider and QA/prod configuration.
5. Deploy to QA with debug/info delivery logs enabled.
6. Verify a real invite email and a real entry confirmation email from QA.

## Open Questions

- Should the invite API report record creation only, delivery submission, or both?
- Should entry confirmation email be sent every time a completed entry is edited, or only the first submit after all required picks are present?
- Should commissioners be copied on invite or entry emails?
- Should local/dev render email previews to files, logs, or a lightweight mailbox tool?
