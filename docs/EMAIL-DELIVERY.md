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

An email whose `PlanFeature` the league's plan lacks (*Plans* in `plans/monetization-strategy.md`)
is recorded as `SKIPPED` with the reason `NOT_IN_PLAN` (#948), checked after the template switch;
account and membership emails have no feature and always go.

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
HTML-escaped. Dates are shown in the recipient's time zone (their account setting, captured
from the browser at signup), or in US Eastern when they have none (#1039). An email sent days
ahead gives only the day ("Thu, Apr 9, 2026"); a time, with its zone named, appears only when it
matters that day: the entry reminder sent less than a day before picks close, the commissioner's
"contest isn't open yet" email, an event moved within its own day, and account emails that
record when something happened.

### Previewing Emails

`npm run email:preview` renders every template with the examples in
`tests/support/email-template-fixtures.ts` into `tmp/email-preview/` (HTML and plain text).
Options:

- `-- --send` also sends each one to local Mailpit.
- `-- --to you@example.com` sends each one to that address through the provider the
  environment configures (`EMAIL_PROVIDER`, `SES_*`, `AWS_*`). Each subject starts with the
  template key, such as `[CONTEST_OPENED]`.
- `-- --category RESULTS` keeps only one category's emails (`ALL` keeps every one).

The **Send email previews** workflow (Actions, manual) runs it with `--to` through QA's SES, so
the previews land in a real inbox. It sends straight through SES with the repository's AWS
credentials: the "Send system email" switch and "Only send to" don't apply, and nothing goes
into QA's outbox. While the account is in the SES sandbox, the address must be verified in SES.
The credentials' IAM user (`poolmaster-github-deploy`, created by hand, not in Terraform) needs
`ses:SendEmail` on `identity/*` with the condition `ses:FromAddress` like
`*@qa.ultimateofficepoolmanager.com`, plus on the `poolmaster-qa` configuration set. `identity/*`
matters while in the sandbox: SES also checks the send against the recipient's identity, so a
grant on the sending domain alone fails with AccessDenied on `identity/<recipient>`. It is the
same grant the ECS task role gets in `infrastructure/terraform/main.tf`.

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
- `standingsBufferMinutes` ("Standings email delay"): how many minutes after a round, event or
  week finishes its live standings email goes, 30 by default, from 0 to 240, so a late score
  correction lands first.
- `weeklyDigestHour` ("Weekly event digest hour"): the hour on Monday, in US Eastern time, every
  league's weekly event digest goes, 3 by default (3:00 AM, so it is waiting in the morning),
  from 0 to 23.

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

## Sending a Test Email

The Email card of `/manage/settings` has **Send a test email to**: a root admin types an address
and presses Send. `POST /api/v1/platform/email/test` records one `EMAIL_TEST` email (a fixed
subject and body naming the environment and the admin; category Root admin, no settings switch)
and sends it like every other: the overall switch, "Only send to" and the suppression list all
apply, and it goes through the outbox and the configured provider. The request wakes the sender
and waits up to about eight seconds for this email's first try (never for the rest of the queue),
so the page says what happened: sent, being sent (another task claimed it), not sent and why, or
the provider's error (an address SES won't take in the sandbox, for example). It checks the
setup, not the templates; the **Send email previews** workflow is for those.

Each core-api task re-reads the settings every 30 seconds, so a test pressed right after saving
can still run on the old settings on another task; the skip reason shows it. Wait half a minute
after a save, or press again.

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

Co-owner emails (#845 B4, B5) are queued when a commissioner or squad owner invites a co-owner,
or replaces an owner. An address with no account gets the invitation (`SQUAD_OWNER_INVITE`): who
invited them, the squad, the league and its code, the expiry and an Accept invitation button to
`/team-invite/:code`. An account that is seated on the squad straight away is told it was added
(`SQUAD_OWNER_ADDED`), with an Open league button, and gets no invitation. Both come from the
league. A replacement for a squad's only owner is invited to own it, or told they now own it,
with no mention of other owners. A failure to queue either is logged and never undoes the
invitation, whose link the squad's owners panel still shows.

Contest entry confirmation emails ("Entry submitted") are receipts, queued when a member
submits an entry (#481), not when its picks or tiebreaker are saved. They go to every active
owner of the entry's squad, and say until when the picks can still change (#845). A repeat
submit of an already submitted entry sends nothing. Each entry type has its own receipt (#867):
a roster lists its picks by tier, with the salary spent against the cap in a budget contest and
the to-par tiebreaker in golf; a pick'em week lists each game's pick, with its spread against
the spread and its value in a confidence pool, and the tiebreaker as the total score of its
game; a bracket lists its last three rounds, the final first; a survivor week names the team and
its game. A pick'em, bracket or survivor week that goes back to draft and is submitted again
sends a new receipt. The two formats nobody submits get theirs when their draw runs: a quick pick
contest's draw sends every entry its dealt picks ("Your quick picks"), and a squares draw sends
every entry holding a box its boxes with their numbers, the away team's digit for the row and
the home team's for the column ("Your numbers"). Claiming a box sends nothing.

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

Email changed emails (`EMAIL_CHANGED`, #903 A5) go to the account's **old** address whenever its
email changes, by its owner or by a root admin, once the write commits. They say the new address
and when, and carry a "Put my address back" link (`/undo-email-change#token=...`, live 7 days,
stored only as its SHA-256 in `email_change_undo_tokens`). A password reset can't be that link,
as a reset goes to the account's new address. The link opens a page whose button calls
`POST /api/v1/auth/email-change/undo`, which puts the old address back, cancels the links from
any later change and the open reset links, replaces the password with a random one nobody knows
(whoever changed the address knew the old one), and signs the account out everywhere; the person then
resets their password. Like the reset, the email has no switch in EMAIL_CONFIG, the outbox keeps
no copy of it once sent, and it is never sent after its link is dead. A failure to queue one is
logged and never undoes the change.

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

Live standings emails (`CONTEST_STANDINGS`, #877) are the same step's second kind. While a
roster, pick'em, survivor or bracket contest is `ACTIVE`, one goes after each moment it can report on, once that moment is
`standingsBufferMinutes` old, and none more than an hour after that:

- **After a round** ("After round 2: Masters Pick 6"): a stroke-play round is finished when every
  golfer still in the event (cut, withdrawn and removed golfers left out) has played it to the
  end, at the latest of their rounds' `completed_at`, or when the score was last written for a
  round with none. Not after the event's last round, and not for an event with no round count or
  only one round.
- **After an event of a season contest** ("After The Masters: Majors Pool"): the event's
  standings settled and another event of the contest remains to play. It shows each entry's
  result in that event and the next event, with when its picks close. Not after the last event:
  the final results cover it.
- **After a pick'em or survivor week** ("After Week 3: NFL Pick'em"): the week's standings
  settled and another week remains to play, with next week's first kickoff. Pick'em names the
  week's winners and lists the week's top 10 by its points above the season's; survivor says how
  many entries are still in and marks the ones out, and tells a reader whose entry went out that
  week which team it picked, or that it had no pick. It links to the contest to make next week's
  picks for readers with an entry (in survivor, an entry still in).
- **After a bracket round** ("After Sweet 16: March Madness"): every game of the round has its
  result or was cancelled, at the latest time any of them was written (a game records no result
  time of its own). Not after the final, and not for rounds before a second-chance bracket's
  starting round. It names the round in the sport league's words, lists the leaders by points,
  tells each reader whether their entries' champion picks are still alive and how many points
  each entry can still reach, and gives the next round's first game time. A playoff
  that a survivor contest plays a week per round settles, and is reported, once, as the event.

It goes to the league's active commissioners and every active member who owns an entry on the
board, once each. It lists the top 10, and anyone tied with the 10th, then the reader's entries
placed below them, each with its total as the leaderboard shows it and its movement since the
contest's last standings email. Each standings email records every entry's place
(`contest_entries.last_standings_email_position`) after it is queued, for the next one to measure
from. After a round it also names the reader's golfers who missed the cut in it. The
idempotency key (contest, event, round, event, week or bracket round, person) keeps a second sweep or task from
sending one twice.

Final results emails (`CONTEST_RESULTS`, #845 slice 4) are queued by contest settlement the
moment it moves a contest to `COMPLETED`, whatever its format. A contest with frozen places tells
every active league member, once each: who won (every entry placed first when they tie), the
final top 10 and anyone tied with the 10th, then the reader's entries placed below them, each
total as the contest scores it. The owners of a winning entry are congratulated at the top. A
contest that completes with no places (every event cancelled, a squares game never played)
instead tells its commissioners and the members with an entry that it ended with no scores. The
idempotency key (contest, person) sends it once, even to a contest settled again after being
moved back out of `COMPLETED`. Prizes are not in it yet (catalog row F4). When every event was
cancelled it says so, naming the event of a one-event contest ("The Masters was cancelled, so
Masters Pick 6 ends with no scores"). A contest whose last event to play is cancelled gets no
event cancelled email, so a member
who turned off Contest updates still hears it ended.

Event changed emails (`CONTEST_EVENT_CHANGED`, #845 C6 and C7) are queued when an event goes
`POSTPONED` or `CANCELLED` (a root admin's transition, or the lifecycle scheduler), and when a
root admin moves the start of a released (`SCHEDULED` or `POSTPONED`) event. Each open or live
contest on the event (not a draft one) tells its league's active commissioners and the
members owning an entry submitted for any of its events, one email per contest. When the
event's picks are still open (the contest takes picks, isn't drawn, and the event hasn't reached
its start), a postponed or moved event's email says they stay open until it starts; an event
postponed after its start says the contest carries on when it resumes. A moved event's email
gives its old and new start. A cancelled event counts for nothing; a contest it leaves with no
event to play (its only one, or the last not already cancelled) is not told, since it ends with
no scores and its final results email says why. The
cancellation is told before the event's contests settle. The
idempotency key names the change and the start it leaves (a move, both starts), so a second
postponement or a move back to an earlier new date is told again.

Commissioner event emails (#845 C1, C2 and C4) are the "notifications due" step's third kind,
in the Commissioner updates category:

- **Coming up soon** (`EVENT_COMING_UP`): an event of any sport league, released or still a
  draft, starts in 7 to 10 days. It gives the start, says when a draft event isn't open for
  contests yet, names last year's winners of the league's own contests on the event's previous
  edition (same series, the year before), and links to the league's contests page.
- **Ready for contests** (`EVENT_READY_FOR_CONTESTS`): a released event starts within 7 days, at
  the later of its release and 7 days before it starts, and the league has no contest on it. It
  gives the start, the field size and the default contest setups offered on the event, each
  linking to Create contest started on it.
- **Your contest isn't open yet** (`CONTEST_NOT_OPEN`): a draft contest's picks close within 48
  hours. Not for a contest created in the last 6 hours. It goes to the contest's league's
  commissioners and links to the contest's commissioner page.

C1 and C2 go to every active commissioner of every active league, each league sending its own; a
league that joins after the others were told is told on the next sweep. A league hears about
every sport league unless its commissioners mute one (#851): the league's `mutedSportLeagueIds`,
set with `PUT /api/v1/leagues/{id}/event-email-settings` from Commissioner tools › League
settings › Event emails, and a league muting an event's sport league is not told of it. A sport
league added later is heard about until muted. A sport league whose events are weeks (each NFL
week its own event) is told of its season's first week only. The idempotency key (event, league,
person; for C4, contest, person) sends each once, and a league or contest already told is skipped
before its email is built.

The same settings choose the delivery (`eventEmailDelivery`): `PER_EVENT`, C1 and C2 as above
(the default), or `WEEKLY_DIGEST`, which gets neither. A digest league's commissioners get
**Coming up** (`EVENT_WEEKLY_DIGEST`, category Commissioner updates) on Monday from
`weeklyDigestHour` US Eastern, every league at the same moment. It lists the events of the
league's heard sport leagues starting in the next 14 days, under This week (the first 7 days)
and Next week, with the same first-week rule for weeks: "Contest set up" when the league has a
contest on it, "Ready for contests" with a Create contest link when released, "Not ready for
contests yet" while a draft. A league with nothing coming up gets no digest that week. It starts
on the plan of `EMAIL_EVENT_COMING_UP`, which it replaces, so the Event emails page offers it
only on that plan. The idempotency key (Monday's date, league, person) sends one a week.

**New member joined** (`LEAGUE_MEMBER_JOINED`, #903 B6, category Commissioner updates, plan
feature `EMAIL_LEAGUE_MEMBER_JOINED`) tells a league's commissioners when someone joins: by
accepting a league invitation, or as a squad's co-owner (added straight away, or accepting a
co-owner invitation). It says who joined, their squad, how many members the league has now, and
links to Members and owners. The first three joins of a league's day (US Eastern) are each told
at once, after the join commits; a failure is logged rather than failing the join. The rest of a
busy day go together in one email the next day once `weeklyDigestHour` (3am Eastern by default)
has come, listing in the order they joined every join of the day with no at-once email in the
outbox, so someone leaving later that day or two joins committing out of order never drops or
repeats anyone. A join is an active MEMBER membership by its `joinedAt`, so the league's creator
never counts. The idempotency key is the membership and its join time at once, and the day and
league the next day, each per person.

**Contest expanded** (`CONTEST_EXPANDED`, #987, category Account, so always sent, on every plan)
tells a league's commissioners when one of its contests is expanded (plans/payments.md §8): the
contest, its new entry cap and who expanded it, that it is in the payment history, and a link to
Manage contest. Whoever expanded it is not told; a root admin's free grant names Poolmaster
rather than the admin and goes to every commissioner. It is queued after the expansion is
written, and a failure is logged rather than failing the expansion; an inactive league sends
none. An expansion only ever raises a contest's cap, so the idempotency key is the contest and
its new cap, per person.

Event still in draft emails (`EVENT_STILL_DRAFT`, #845 G1, category Root admin, which can't be
turned off) are the step's fourth kind. While an event starts within 7 days and is still a draft,
every active root admin is told once a day, from the app rather than a league: when it starts,
what it still needs before release (the release refusal's own list: field, tiers, prices, a
bracket), or that it only needs releasing, with a link to its Manage page. The idempotency key
(event, start, whole days left, person) sends one a day and stops once it is released or starts.

**Premium preview period ending** (`LEAGUE_PLAN_PREVIEW_ENDING`, #986, category Account, which
can't be turned off, and no plan feature) reminds a league's commissioners that its gifted
Premium preview period ends: 30, 7 and 1 days before `planRenewsAt`, counted in US Eastern
dates, once `weeklyDigestHour` has come. It says when the preview period ends (in the reader's
zone), what Free allows (`PLAN_CONFIG`'s Free caps), that nothing is deleted, and links to the
league's Plan page; the last one says it ends tomorrow. Only active leagues not on Free get it. A
league that missed one gets only the most urgent one due, with the days really left. The idempotency key (renewal date,
reminder, league, person) sends each once, and a root admin extending the gift starts them over
for the new date. The same sweep then moves every league whose date has passed to Free
(`docs/DOMAIN-OPERATIONS.md`). No email follows the move itself (`plans/payments.md` Q9).

The year in review (`YEAR_IN_REVIEW`, #872, category Results) is not on a timer: a league's
commissioner sends it from the "ready to send" banner on league home and Championships, from
1 January for the year before. Each active owner of an active squad that placed that year gets
its year: championship place and points (with its trophy once the year is over), its contest
1sts, 2nds and 3rds and contests played, each cup it placed in, and a link to its squad page for
that year. The idempotency key (league, year, person) sends each once; the emails are recorded
before the league's `league_year_reviews` row, so a send that fails partway can be pressed again.

If the outbox cannot record a welcome, a receipt, a new contest, a contest-started, a final results or an event changed email, the action that
sends it still succeeds and PoolMaster logs the template and ids.
