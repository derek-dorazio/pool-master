# Email Delivery

PoolMaster sends every system email through one call, `EmailService.send(templateKey, input)`
in `packages/core-api/src/modules/email`. It checks `EMAIL_CONFIG` and who may be emailed,
renders the template for the recipient, picks the sender, and records one email to one person
in the outbox; the sender sends it a moment later. Callers never render or call a transport
themselves.

## Outbox

Every email is a row in `email_messages` (#844 slice 3), one per recipient:

- **Queued** (`QUEUED`) with its subject and bodies rendered at queue time, so what is sent is
  what was stored; or **skipped** (`SKIPPED`) with the reason and no content.
- **Once per key.** Each caller passes what the email is about (an invitation and its code, an
  entry's submission, a contest's start); with the template and the recipient (their user id,
  or the address for an invite) it makes `idempotency_key`, which is unique. A retried action,
  a second sweep or a double click records nothing new. A resend is a new invite code, so a
  new email.
- **The sender** (`EmailSender`) runs in every core-api task. It claims due rows with
  `FOR UPDATE SKIP LOCKED`, so two tasks never send the same email, and sends no faster than
  `EMAIL_CONFIG.sendRatePerSecond` per task. A queued email wakes it; a 15-second tick picks up
  retries and anything a wake missed.
- **Retries.** A failed send is tried again 1, 5 and 30 minutes later, then marked `FAILED`
  with its last error and logged. An SES throttle (`TooManyRequestsException`) is tried again 10
  seconds later without counting the try. A claim lapses after 5 minutes, so an email a stopped
  task held is sent by another.
- **Send-by window.** A template may say how long after it is queued it may still go out
  (`sendWithinMs` in the registry). The password reset's is its link's 10 minutes: a reset that
  would be sent or retried later is marked `FAILED` with its content cleared
  (`email.sender.expired`). Emails with a window are claimed ahead of the rest, so a reset never
  waits behind a large send.
- **Content is cleared after 30 days**; the row stays, so "why didn't I get it?" still has an
  answer.
- **After it is sent**, SES reports what happened, and the row moves on from `SENT` to
  `DELIVERED`, `BOUNCED` or `COMPLAINED`, or to `FAILED` when SES rejected it (*Bounces and
  Complaints* below).

The logs (`email.send.queued`, `email.send.skip`, `email.sender.sent`, `email.sender.retry`,
`email.sender.failed`, `email.sender.expired`, `email.deliveryEvent.*`) carry the template key and
ids, never the body or an address.

## Bounces and Complaints

SES publishes a delivery, bounce, complaint or reject event for each email sent through the
configuration set to the environment's SNS topic, and SNS posts it to
`POST /api/v1/email/ses-events` (#844 slice 4). The route is public: its authority is the SNS
signature, checked against a certificate from an `sns.<region>.amazonaws.com` URL, and the topic,
which must be `SES_EVENTS_TOPIC_ARN`. Anything else gets 403 `EMAIL_EVENT_UNVERIFIED`; with the
variable unset (local, tests) every message does. The first message is the subscription
confirmation, which core-api confirms.

Each event finds its email by the SES message id the sender stored:

- a **delivery** marks it `DELIVERED`;
- a **permanent bounce** marks it `BOUNCED` and a **complaint** (marked as spam) `COMPLAINED`, and
  both put the address on `email_suppressions`; from then on `EmailService.send` records any email
  to that address as `SKIPPED` with the reason `SUPPRESSED`, and the commissioner's invites list
  says "We can't email this address". It never says why: the list is platform-wide, and the
  bounce or complaint may have come from another league's email (leagues are tenants). The SES account suppression list does the same inside SES; this table
  is the one the app can read and show;
- a **transient bounce** is only logged, since SES retries it itself;
- a **reject** marks it `FAILED`.

An event never moves an email backwards (a late delivery after a bounce changes nothing). An event
for an email this environment didn't send changes no email's status, though a permanent bounce or
complaint still suppresses the address; it is logged and answered 200 so SNS doesn't retry it.
That also covers an event that arrives before the sender has stored the SES message id: the email
then stays `SENT`, and a bounce still suppresses the address.

The route believes a message only when it is from `SES_EVENTS_TOPIC_ARN`, signed with a
certificate under `/SimpleNotificationService-` on the `sns.<region>.amazonaws.com` host of the
topic's region, and at most an hour old (SNS retries within minutes, so anything older is a
replay). Fetching a certificate or confirming the subscription times out after 5 seconds.

## Preferences and Unsubscribe

A member turns categories of email off on their profile (*Email notifications*), one switch per
category, the same for all their leagues (#844 slice 5, Q7.1). The switchable categories are
`COMMISSIONER_UPDATES`, `CONTEST_UPDATES`, `LIVE_STANDINGS`, `RESULTS` and `RECEIPTS`
(`OptionalEmailCategory`); account and membership emails have no switch. A row in
`email_opt_outs` means off; no row means on. `EmailService.send` checks it after the
suppression list and records an email in a category the recipient turned off as `SKIPPED` with
the reason `OPTED_OUT`.

Every email in a switchable category, to someone with an account, carries:

- a footer link, *Stop these emails*, to `${APP_BASE_URL}/email/unsubscribe?token=…`: a page that
  asks before it turns the category off, so a link scanner opening it unsubscribes nobody, and
  then links to the profile's switches;
- `List-Unsubscribe: <${APP_BASE_URL}/api/v1/email/unsubscribe?token=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), which mail apps show as an
  Unsubscribe button. The URL is stored on the outbox row (`list_unsubscribe_url`, cleared with
  the bodies) and sent as headers through SES and SMTP alike.

The token names one user and one category and never expires, so it can do one thing only: turn
that category off for that user. It is an HMAC-SHA256 over both, keyed by a key derived from
`JWT_SECRET` for this purpose alone (`UnsubscribeTokens`). It is deliberately not a JWT: access
tokens are JWTs signed with `JWT_SECRET`, and a token that verified as one would sign its holder
in. `POST /api/v1/email/unsubscribe` takes it with no session; a token this app did not issue,
or one for a deleted account, is 400 `EMAIL_UNSUBSCRIBE_LINK_INVALID`. The request log records the
URL with `token=[REDACTED]`.

When the member's address is on the suppression list, the profile and the *Email notifications*
dialog say no email reaches them and that changing their email starts it again (a new address
is not suppressed).

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
- `SES_EVENTS_TOPIC_ARN` is the SNS topic the configuration set publishes delivery events to; the
  events route accepts messages from it only. Terraform sets it.
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
- `sendRatePerSecond` ("Emails a second"): the most emails each core-api task sends a second,
  10 by default. Production runs two tasks; keep the total within the SES account's rate
  (14 a second when production access is granted).
- `entryReminderHours` ("Entry reminders"): how many hours before a contest's picks close each
  entry reminder goes, `[48, 24, 3]` by default, one to five whole numbers from 1 to 168.

Through SES, an address at a domain reserved by RFC 2606 and RFC 6761 (`.invalid`, `.test`,
`.example`, `.localhost`, `example.com`, `example.net`, `example.org`) is always skipped: no mail
server answers for them, so a send would only hard-bounce. The e2e smoke users are
`@e2e.invalid`, so smoke runs on QA never send. Mailpit and the test SMTP sink catch every
address, so SMTP sends to them.

An email that is skipped is recorded as skipped, and invite by email still creates the invitation
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
`tests/functional/mail.ts`, whose `awaitSentMailTo` waits for the sender to send.
`tests/integration/core-api/email-settings.integration.ts` covers switching email, and one
email, off, and the allow list; `email-outbox.integration.ts` covers each outbox query;
`email-preferences.integration.ts` covers the preference routes and the one-click unsubscribe.
The sink also records each message's `List-Unsubscribe` headers, and the functional lane follows
one back. Unit
tests run the real service and sender over an in-memory outbox (`tests/support/email-service.ts`).

## SES Infrastructure

Terraform sets the core-api ECS task's `EMAIL_PROVIDER` to `ses` in every
environment; QA's "send nothing yet" is the `EMAIL_CONFIG` default above. Terraform also configures
`APP_BASE_URL`, `AWS_REGION`, `SES_FROM_EMAIL`, `SES_CONFIGURATION_SET`, `SES_EVENTS_TOPIC_ARN` and
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
  complaints suppressed through the SES account suppression list;
- the SNS topic `<project>-<environment>-ses-events`, which only that configuration set may
  publish to, the event destination that publishes delivery, bounce, complaint and reject events
  to it, and (once `ses_events_subscribed` is true) core-api's https subscription.

When no domain is configured, Terraform creates an email identity for the configured sender
address; that address must be verified in SES before deployed delivery can succeed.

The one-time AWS steps (applying, and requesting production access to leave the SES sandbox) are
in `infrastructure/terraform/README.md`, *System email (SES)*.

## Success Semantics

No request waits for an email to be sent, and none fails because the mail provider refused
one: the email is queued, and the outbox retries it.

League invite by email returns success once the invitation exists and its email is recorded.
Each sent invitation carries `emailStatus`, and the commissioner's pending invites list
(Commissioner tools › Invites) shows where each invite's latest email stands: sending, sent,
delivered, bounced, marked as spam, could not be sent (`FAILED`), or not sent (`SKIPPED`, with
email switched off or the address not allowed here; `emailSkipReason` `SUPPRESSED` means the
address is on the suppression list, which the screen shows only as "We can't email this
address"; `OPTED_OUT` means the member turned that category off), when the commissioner copies the link and shares it
another way. Resend gives
the invitation a new invite code and a fresh seven-day expiry and queues a new email, so the
old link stops working.

Contest entry confirmation emails ("Entry submitted") are receipts, queued when a member
submits an entry (#481), not when its picks or tiebreaker are saved. They go to every active
owner of the entry's squad, and say until when the picks can still change (#845). A repeat
submit of an already submitted entry sends nothing. Each entry type has its own receipt (#867):
a roster lists its picks by tier, with the salary spent against the cap in a budget contest and
the to-par tiebreaker in golf; a pick'em week lists each game's pick, with its spread against
the spread and its value in a confidence pool, and the tiebreaker as the total score of its
game; a bracket lists its last three rounds, the final first; a survivor week names the team and
its game. A pick'em, bracket or survivor week that goes back to draft and is submitted again
sends a new receipt.

"New contest open" emails (#845) are queued when a commissioner opens a contest (`DRAFT` to
`OPEN`), to every active league member: the contest's events, its rules in the same sentence
its page shows, the entry limit and when picks close. The contest records when it was opened
(`opened_at`), and no entry reminder goes within 6 hours of it. A failure to queue one is
logged and never undoes the open.

Password reset emails (#847) are queued like every other email, from the app's `noreply@`
address. Queuing wakes the sender, so the email goes out at once; the link expires 10 minutes
after it is issued. They have no switch in EMAIL_CONFIG (only the overall one), and because the
email carries the link, the outbox clears its subject and bodies the moment it is sent or given
up on instead of keeping them for 30 days. The request route has already answered 202 by then,
the same answer it gives when no account matches, so a failure is only logged (user id, never
the address, token or link) and the person asks again.

Password changed emails (#848) are queued after a reset by link and after a person changes their
own password, not after a root admin's reset, once the password write commits. Like the reset,
they have no switch in EMAIL_CONFIG. A failure to queue one is logged and never undoes the change.

"Contest is live" emails (`CONTEST_STARTED_SUMMARY`) are queued when a sport event moves to
`IN_PROGRESS` (a root admin's transition, or the lifecycle scheduler) and first moves its
contests from `OPEN` to `ACTIVE`. They go to every active league member, once each: "Good luck,
everyone", the event, the contest's rules, the number of entries and a link to the leaderboard,
with a line telling a member without an entry they can still follow it. They list no entries.
An already-active contest is not told again.

Entry reminders ("Picks close soon", #845) are the first email sent on the clock rather than
on an action. Each lifecycle scheduler sweep (every 5 minutes) ends with a "notifications due"
step, which queues the reminder whose time has come, at the `entryReminderHours` offsets before
each event's cutoff (the event's start, a second-chance bracket's starting round, a squares
game's kickoff). Everyone gets a reminder at the same moment, one email per person however many
squads they own. Only the latest reminder whose time has passed is sent, and none more than an
hour late, so a contest opened after a reminder's time skips it, and none within 6 hours of the
contest opening. The idempotency key (contest, event, offset, person) keeps a second sweep or
task from sending one twice.

Who is told depends on the format:

- **Tiered, budget, pick'em, bracket and survivor:** while a contest takes entries, every active
  league member with nothing submitted for the event; once it is live (week 7 of a pick'em
  season), only the owners of entries whose week is still a draft. A survivor entry that is
  already out doesn't count. A member with one draft is told how far along it is ("a draft with
  4 of 6 picked": a roster's picks of its size, a pick'em week's or bracket's picks of its
  games); a member with several drafts is told how many.
- **Random draw** ("Entries close soon"): members not in it yet, while it takes entries. The
  draw deals the picks, so entrants have nothing to do.
- **Squares** ("Boxes close soon"): members holding no box, until the game starts or the numbers are drawn, and nobody once the grid is full.

If the outbox cannot record a welcome, a receipt, a new contest or a contest-started email, the action that
sends it still succeeds and PoolMaster logs the template and ids.
