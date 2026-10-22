# Real email through AWS SES

**Tracking issue:** #844 (folds in #120)

Written 2026-10-21 for Derek's ask: the technical design for sending real email from Poolmaster
through AWS SES, including how templates, copy and merge tokens are managed. Which emails to send
(contest released, entry reminders, contest live, standings, winners, new events for
commissioners, password recovery) is designed in a separate thread; this plan is the mechanism
every one of those emails will use. Questions sit under the section they belong to, each with a
recommendation; none blocks slice 1.

---

## TL;DR

- **Most of the plumbing already exists.** Core-api has an SES transport, an SMTP transport for
  Mailpit, typed template keys, four rendered emails, and the `EMAIL_CONFIG` on/off switches. What
  QA lacks is the AWS side: the SES Terraform was never applied (#120), the account is in the SES
  sandbox, and there is no bounce, complaint or unsubscribe handling.
- **Keep templates in code, not in SES.** SES stored templates do support `{{token}}` merging
  (Handlebars style), but a missing token fails silently after the send call has already returned
  success, copy changes would need a Terraform or API deploy outside the app, local Mailpit and the
  test SMTP sink could not render them, and nothing checks the tokens at compile time. Typed
  TypeScript renderers give compile-checked tokens, identical output on every transport, and
  copy changes reviewed in a PR. SES then only delivers.
- **Add an outbox.** The coming notification emails go to whole leagues. Sends are queued in a
  Postgres table and sent in-process by a small sender with retries, a rate limit and an
  idempotency key, so a request never waits on SES and nothing is sent twice. No external queue
  (`rules/architecture-rules.md` §1 *Deliberate absences*).
- **Handle bounces and complaints**, turn on the SES account suppression list, and **give members
  per-category email preferences** with a one-click unsubscribe link and header. Account and invite
  emails can't be turned off; notification emails can.
- **Five slices:** domain and sender; email service and template registry; outbox; bounces and
  complaints; preferences and unsubscribe. They interleave with the notification catalog's slices
  in one order, §10.

## Who owns what

Two plans cover email. This one is the **mechanism**; `plans/email-notifications.md` (#845) is the
**catalog**. Each item has one owner, and the other plan cites it rather than restating it.

| Concern | Owner |
|---|---|
| Which emails exist, their rows, priorities and copy content | Catalog |
| Trigger and conditions for each email (status change, clock time, "round finished" rules) | Catalog |
| Audience for each email (who, in which league) | Catalog |
| Timing: reminder offsets (48/24/3 h, everyone at once), standings buffer (30 min), "too late" skips | Catalog |
| The scheduler's "notifications due" step that finds time-based emails | Catalog |
| The list of opt-out categories and which emails sit in each | Catalog (§2 *Categories*) |
| Resolving an audience to people, one email per person | This plan (§5) |
| Template keys, the typed registry, renderers, the shared layout, escaping, date formatting | This plan (§3, §4) |
| The outbox: the sent record, idempotency keys, queueing, retries, rate limit | This plan (§5) |
| Settings and preference checks before queueing, the QA recipient guard | This plan (§4, §6) |
| Preference switches, unsubscribe token, page, footer link and headers | This plan (§7) |
| SES, domain authentication, sandbox exit, bounces, complaints, suppression | This plan (§6, §8) |

Decisions from the catalog that bind the mechanism (Derek 2026-10-21): **leagues are tenants**, so
an email belongs to one league, links only into it, and nothing combines leagues; one on/off
switch per category for each person, across their leagues, with one-click unsubscribe; no digests;
reminders go to everyone at once with no per-person time zone shifting; standings emails fire on
the actual finish plus a buffer. The reminder offsets and the buffer live in `EMAIL_CONFIG` next to
this plan's settings.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| Transports | `packages/core-api/src/modules/email/mail-delivery.ts` | `SmtpMailDeliveryProvider` (nodemailer, Mailpit locally) and `SesMailDeliveryProvider` (`@aws-sdk/client-ses`, the v1 API, `SendEmail` with our own subject, text and HTML). Chosen by `EMAIL_PROVIDER`. |
| Settings switch | `email-settings.ts`, `EMAIL_CONFIG` (#450) | `enabled`, `replyTo`, one switch per template. Off by default on QA. `SettingsAwareMailDeliveryProvider` wraps the transport and skips switched-off sends. |
| Template keys | `EmailTemplateKeySchema` in `packages/shared/dto/config.dto.ts` | A zod enum: `LEAGUE_MEMBER_INVITE`, `LEAGUE_JOIN_SUCCESS`, `CONTEST_ENTRY_COMPLETED`, `CONTEST_STARTED_SUMMARY`. |
| Rendering | `system-email-templates.ts` | One typed renderer per key (`SystemEmailTemplateDataByKey`), a shared branded HTML shell, plain-text twin, HTML escaping. |
| Callers | leagues `invitation-service.ts`, contests `service.ts`, events `event-lifecycle-service.ts` | Each renders, then calls `mailDelivery.send` inline, one recipient at a time. Invites fail the request on a provider error; the others are best effort and log. |
| Terraform | `infrastructure/terraform/main.tf` | SES domain identity and Easy DKIM for `domain_name` (QA: `ultimateofficepoolmanager.com`), DKIM CNAMEs in Route 53, IAM `ses:SendEmail`/`SendRawEmail` for the ECS task, `EMAIL_PROVIDER=ses`, `SES_FROM_EMAIL=noreply@<domain>`. **Never applied to QA** (#120): the DKIM `for_each` needed a two-pass `-target` apply. Slice 1 makes it `count = 3`, one apply. |
| Local and tests | `infrastructure/docker/docker-compose.dev.yml`, `tests/support/smtp-sink.ts` | Mailpit catches every local email; functional and integration lanes assert against an SMTP sink. |
| Docs | `docs/EMAIL-DELIVERY.md` | Describes all of the above. |

Gaps: no SPF alignment (no custom MAIL FROM), no DMARC record, no configuration set, no bounce or
complaint intake, no suppression, no unsubscribe or preferences, no queue for many recipients,
`metadata.templateKey` typed as `string`, and the render-then-send pattern copied in three places.
E2E smoke users use `@e2e.invalid` addresses, which would hard-bounce the moment QA email is on.

## 2. Templates, copy and tokens: SES templates or our own?

Derek's question: does SES do templates, copy, tokens and merging out of the box, so we build
nothing? **It does do them**, so this is a real choice.

**What SES offers.** You upload a template (`CreateEmailTemplate` in the v2 API, or
`aws_ses_template` in Terraform) holding a subject, HTML and text part with `{{tokens}}`, then
send with `SendEmail` naming the template and passing the data as JSON. The syntax is Handlebars:
`{{name}}`, `{{#if}}`, `{{#each}}` loops over a list such as the top ten standings. `SendBulkEmail`
sends one template to up to 50 recipients with per-recipient data in one call.

**Why we shouldn't use it for the content:**

| | SES stored templates | Our typed renderers (recommended) |
|---|---|---|
| Token mistakes | Found at send time. A missing or misspelt token makes SES drop the email *after* the API call returned success; you only learn of it from a "rendering failure" event, if you subscribed to one | Compile errors. Each template's data is a TypeScript type, so a missing token can't merge |
| Changing copy | Re-upload the template (Terraform apply or an admin API call) outside the app's release; no history beyond what we build | Edit the file, PR, review, merge; QA has it minutes later. History is git |
| Local and tests | Mailpit and the test SMTP sink can't render SES templates; local email would differ from deployed email, or need LocalStack | The same subject, text and HTML go through Mailpit, the sink and SES |
| Logic | Handlebars only: no date formatting, number formatting, pluralising or escaping rules of our own | Full TypeScript: `Intl` dates in the member's time zone, "1 entry"/"3 entries", sport-aware wording |
| Testing | Needs `TestRenderEmailTemplate` against AWS | Plain unit tests on the renderer |
| Environments | Templates are per account and region; QA, stage and prod each need their own copy kept in step | Ships with the image |

Copy then lives in one file per email, next to its typed data and its subject line. Tokens are the
fields of that type; "merging" is the renderer reading them, with HTML escaping always on. Derek
(or an agent) changes wording through a PR like any other product copy (the UI copy rule applies:
product copy, never developer notes).

**Admin-editable copy** (stored in the database, edited on a settings page) is possible later, but
it brings back the token problem in a new place and needs a preview and validation UI. Not
recommended until someone other than us needs to change wording.

**Previewing.** A script, `npm run email:preview`, renders every template with fixture data from
test code into HTML files (and optionally sends them to Mailpit), so copy can be eyeballed without
running a whole flow. Fixtures stay out of application source
(`rules/testing-rules.md` §1B *Forbidden Application-Code Patterns*).

> **Q2.1 Templates: in code or in SES? Decided (Derek 2026-10-21): in code**, as today, with SES
> used only to deliver.

## 3. Typed template IDs

Today's zod enum stays the one list of emails, and every new email is a new member. Each key gets a
registry entry, checked with `satisfies Record<EmailTemplateKey, …>` so adding a key without a
renderer, a category or a settings switch is a compile error (the `EMAIL_CONFIG.templates` record
already works this way):

```
EMAIL_TEMPLATES = {
  LEAGUE_MEMBER_INVITE: { category: EmailCategory.MEMBERSHIP,      render: renderLeagueMemberInvite },
  CONTEST_OPENED:       { category: EmailCategory.CONTEST_UPDATES, render: renderContestOpened },
  PASSWORD_RESET:       { category: EmailCategory.ACCOUNT,         render: renderPasswordReset },
  …
} satisfies Record<EmailTemplateKey, EmailTemplateDefinition<…>>
```

- `EmailCategory` is a new enum (and a Postgres enum where stored), one member per category in the
  catalog's §2 *Categories*. It decides whether a member can turn the email off (§7) and which
  unsubscribe link it carries.
- `MailDeliveryMessage.metadata.templateKey` becomes `EmailTemplateKey`, not `string`.
- Statuses on the outbox row are an enum (§5), per the status-columns-are-enums decision.

## 4. One email service

The three callers that render then send become one call, so the settings check, suppression check,
preference check, outbox write and logging happen in one place
(`rules/architecture-rules.md` §4 *One code path per piece of business logic*):

```
emailService.send(templateKey, { to: user | address, data, refs: { leagueId, contestId, … },
                                 idempotencyKey })
emailService.sendToMany(templateKey, recipients[], dataFor(recipient), refs, keyFor(recipient))
```

It renders, decides to queue or skip (switched off in `EMAIL_CONFIG`, address suppressed, member
opted out, QA recipient guard), and writes outbox rows inside the caller's transaction where there
is one, so an email exists exactly when the thing it reports does. `SettingsAwareMailDeliveryProvider`
folds into it.

Transports stay as they are behind `MailDeliveryProvider`, with one change: the SES transport
moves to the **SES v2 API** (`@aws-sdk/client-sesv2`, `SendEmail` with simple content). v2 is where
the account suppression list and custom headers (`List-Unsubscribe`) live; v1 is in maintenance.
The IAM policy gains the configuration set ARN as a resource.

## 5. Outbox: queue, send, retry

New table `email_message` (one row per recipient per email):

| Column | Notes |
|---|---|
| `id`, `createdAt` | |
| `templateKey`, `category` | Enums |
| `recipientUserId` (nullable), `recipientEmail` | Invites go to addresses with no user yet |
| `leagueId`, `contestId`, `entryId`, `invitationId` (nullable) | Same refs we log today |
| `idempotencyKey` (unique) | e.g. `CONTEST_OPENED:<contestId>:<userId>`: template, the subject it is about (contest, event, round, week or invitation) and the recipient, the catalog's "never twice" rule. A retried transition, a second scheduler sweep or a double click never sends twice; a resend the person asked for is a new subject |
| `subject`, `textBody`, `htmlBody` | Rendered at queue time: what we send is what we stored. Bodies are cleared after 30 days; the row stays |
| `status` | `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `BOUNCED`, `COMPLAINED`, `FAILED`, `SKIPPED` |
| `skipReason` | `EMAIL_DISABLED`, `TEMPLATE_DISABLED`, `SUPPRESSED`, `OPTED_OUT`, `NOT_ALLOWED_IN_ENVIRONMENT` |
| `attempts`, `nextAttemptAt`, `lastError` | Retry with backoff (1 min, 5 min, 30 min, then `FAILED`) |
| `providerMessageId`, `sentAt` | SES message id, to match bounce events |

As built (slice 3): there is no `category` column, because the template registry gives each
template's category. `DELIVERED`, `BOUNCED`, `COMPLAINED` and the skip reasons `SUPPRESSED` and
`OPTED_OUT` arrive with slices 4 and 5. Each template may also set a send-by window: a password
reset is given up (FAILED, content cleared) once its 10-minute link would be dead, and emails with a
window are claimed ahead of the rest.

**Sender.** An in-process loop, like the event lifecycle scheduler, claims due rows with
`FOR UPDATE SKIP LOCKED` (prod runs two tasks), sends them, and records the outcome. A queue write
also wakes it, so an invite goes out within a second rather than at the next tick. It sends no
faster than a rate held in `EMAIL_CONFIG` (default 10 per second; SES production accounts start at
14), and a throttling error just pushes `nextAttemptAt`.

**What this changes for invites.** Before slice 3 a provider error failed the invite request with
`LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED`. With the outbox the invite is created and its email
queued; the commissioner's pending invites list shows the email's state ("Sent", "Bounced", "Could
not send") and Resend works as today.

> **Q5.1 Invites through the outbox? Decided (Derek 2026-10-21): yes**, every email goes through the outbox, and
> the pending invites list shows each invite's email state. The alternative keeps invites synchronous
> so the commissioner sees an error at once, but leaves two send paths, and SES rarely refuses at
> submit time anyway: a bad address shows up minutes later as a bounce, which only the outbox sees.

### Worked example: a "new contest open" email to one league

Every email goes to **one person**. There is no league mailing list or alias address, and no send
with the whole league in `To`. Reasons:

- a shared `To` (or an alias) shows every member's address to everyone, and to anyone a member
  forwards it to;
- each email is personal: the member's name, their own unsubscribe link, later their own row in
  the standings;
- each person's preference and bounce state is checked separately, and a bad address affects only
  that one email;
- SES charges per recipient either way, so batching saves nothing. (SES `SendBulkEmail` can carry
  50 recipients per call, but only with SES stored templates, which Q2.1 ruled out.)

The league is the scope, not the address: recipients are resolved from the league, then each gets
their own email, from that league, linking only into that league (leagues are tenants, §7).

Say the commissioner of *Office League* (24 members) opens the *Masters Pool* contest (catalog row D1).

1. **The open action calls the email service once**, inside the transaction that moves the contest
   `DRAFT` → `OPEN`: `emailService.sendToMany(CONTEST_OPENED, audience: LEAGUE_MEMBERS(leagueId), data, refs: { leagueId, contestId })`.
   Who the audience is comes from the catalog row; this mechanism only resolves it. Time-based emails
   (reminders, standings) make the same call from the catalog's scheduler step.
2. **Resolve the audience to people.** One query: the league's active memberships → users →
   email addresses. 24 rows, one per person even if they own several squads.
3. **Filter, person by person,** and record why anyone is left out:

   | Check | Result in this example |
   |---|---|
   | `EMAIL_CONFIG.enabled` and the template's switch | on, nobody dropped |
   | Address on the suppression list (bounced or complained before) | 1 member → `SKIPPED / SUPPRESSED` |
   | Member turned off this category (`CONTEST_UPDATES`) | 2 members → `SKIPPED / OPTED_OUT` |
   | QA recipient guard (`.invalid` addresses, allow list) | 1 smoke user → `SKIPPED / NOT_ALLOWED_IN_ENVIRONMENT` |
   | Already queued with this idempotency key (`CONTEST_OPENED:<contestId>:<userId>`) | nobody; a second click would stop here |

4. **Render and queue.** For each of the 20 remaining members, render the email with their own
   data (their name, their unsubscribe link) and insert an `email_message` row, `QUEUED`. The 4
   skipped ones get a `SKIPPED` row, so "why didn't I get it?" has an answer. The transaction
   commits; the commissioner's action returns at once, without waiting for SES.
5. **Send.** The sender wakes, claims the 20 due rows and makes 20 SES `SendEmail` calls, each with
   `To` = one address, `From` = the environment's `noreply@` address, the configuration set, and the
   `List-Unsubscribe` headers. At 10 a second that takes two seconds. Each call returns a SES message
   id; the row becomes `SENT` with that id.
6. **If a call fails**: SES throttling or a network error pushes the row's `nextAttemptAt` (1, 5,
   30 minutes); after the last try it is `FAILED` and logged. Other rows carry on.
7. **Minutes later**, SES reports what happened to each one (§8): 19 `DELIVERED`, 1 `BOUNCED`. The
   bounced address goes on the suppression list, so the next league email skips it at step 3, and
   the member sees a "fix your email address" banner.

An invite is the same flow with an audience of one address that has no user yet.

## 6. Domain, sender and getting out of the sandbox

Steps, in order (slice 1; Derek runs the Terraform applies and the AWS console request, as today):

1. **One apply for DKIM** (#120): the DKIM CNAMEs use `count = 3` (Easy DKIM always issues three
   tokens) instead of a `for_each` over tokens unknown until the identity exists, so a single
   apply creates the identity and its records; no two-pass `-target` apply. Documented in
   `infrastructure/terraform/README.md`.
2. **DKIM**: Easy DKIM (already in Terraform), three CNAMEs in Route 53. Signs every message.
3. **SPF via a custom MAIL FROM domain**: `aws_ses_domain_mail_from` with
   `bounce.<sending domain>`, an MX record to `feedback-smtp.<region>.amazonses.com` and a TXT
   `v=spf1 include:amazonses.com ~all`. Without it, SPF passes for `amazonses.com`, not our domain,
   so it doesn't count toward DMARC.
4. **DMARC**: TXT `_dmarc.<domain>` = `v=DMARC1; p=none; rua=mailto:<reports address>` to start,
   moving to `p=quarantine` after a few weeks of clean reports. Gmail and Yahoo require DMARC from
   bulk senders.
5. **Configuration set** (`aws_sesv2_configuration_set`) with reputation metrics on and an event
   destination for bounces, complaints, deliveries and rejects (§8). Every send names it.
6. **Suppression on the configuration set** (`suppression_options` with `BOUNCE` and
   `COMPLAINT`), so SES itself refuses addresses on the account suppression list that bounced or
   complained, across environments. Not `aws_sesv2_account_suppression_attributes`: that is an
   account-wide singleton, and QA, staging and prod, each with its own state, would fight over it.
7. **QA recipient guard** before turning QA email on: never send to reserved domains (`.invalid`,
   `.test`, `.example`, `example.com`), which the smoke users use; and an `EMAIL_CONFIG`
   `allowedRecipients` list (addresses or `@domain`) that, when set, limits who QA can email. A
   blocked send is `SKIPPED` with `NOT_ALLOWED_IN_ENVIRONMENT`. This is environment behaviour
   in a setting, not a test branch.
8. **Sandbox exit.** A new SES account can only send to verified addresses, 200 a day, one a
   second. Derek requests production access in the SES console (Account dashboard → Request
   production access): mail type *Transactional*, the site URL, a short description of who gets
   email and how bounces, complaints and unsubscribes are handled (this plan). AWS usually answers
   within a day. Until then, verify a few tester addresses in SES so QA can be tried.
9. **Turn it on**: `EMAIL_CONFIG.enabled = true` on QA's /manage/settings, send an invite to a Gmail
   address, check "Show original" for DKIM, SPF and DMARC all PASS.

> **Q6.1 Sending address per environment. Decided (Derek 2026-10-21): yes.** Today QA would send as `noreply@ultimateofficepoolmanager.com`,
> the same identity prod would use. Recommendation: **each environment sends from its own subdomain
> identity** (QA `noreply@qa.ultimateofficepoolmanager.com`, prod the bare domain later), so QA
> bounces and test complaints never touch prod's sending reputation. The display name follows the
> app-name decision in its own thread.
>
> **Q6.2 Reply-To. Decided (Derek 2026-10-21): none.** System email has no Reply-To. A reply to
> `noreply@` bounces back to the person who replied, so the footer says "This mailbox isn't
> monitored" and points to the league page. Slice 2 deletes the unused `EMAIL_CONFIG.replyTo`
> setting and the `replyTo` field on the transport message.

## 6a. League From address

Decided (Derek 2026-10-21), built in slice 2: an email about a league comes **from that league's
address**, the way CBS and ESPN league emails do. It is presentation only:

```
From: Office League <officeleague@qa.ultimateofficepoolmanager.com>
```

- **Address**: the league code, lowercased, at the environment's sending domain (Q6.1). League codes
  are `A-Z0-9`, 3 to 16 characters, so every code is a valid address. **Display name**: the league's
  name.
- **No SES work per league.** SES lets any address at a verified domain send, so no per-league
  verification, DKIM or DNS. SPF and DMARC still pass through the shared MAIL FROM domain.
- **Nothing receives mail there.** Like `noreply@`, the address has no mailbox; with no Reply-To
  (Q6.2) a reply bounces back to the sender, and the footer says the mailbox isn't monitored.
  Turning the league address into a real list (mail to it reaches every member) would be a new
  feature, not part of this plan.
- **Emails with no league** (password reset, account changes, root admin emails) come from
  `Poolmaster <noreply@…>`, with the display name from the app-name decision.
- The registry entry says whether a template is league-scoped; league-scoped emails must carry
  their `leagueId`, so the From address can't be forgotten.
- **Reserved codes.** A league can't use a code that is a role address: `NOREPLY`, `POSTMASTER`,
  `ABUSE`, `ADMIN`, `SUPPORT`, `SECURITY`, `BOUNCE`, `HOSTMASTER`, `WEBMASTER`. League creation
  refuses them; slice 2 checks no existing league has one.
- The league code already appears in invite emails and league links, so showing it in the From
  line exposes nothing new; joining still needs an invite.

## 7. Unsubscribe and preferences

**Categories.** Every template has a category (§3). The list, and which emails sit in each, is the
catalog's (§2 *Categories*); the enum mirrors it:

| `EmailCategory` | Catalog category | Can be turned off? |
|---|---|---|
| `ACCOUNT` | Account and security | No |
| `MEMBERSHIP` | Invitations and membership | No |
| `COMMISSIONER_UPDATES` | Commissioner updates | Yes |
| `CONTEST_UPDATES` | Contest updates | Yes |
| `LIVE_STANDINGS` | Live standings | Yes |
| `RESULTS` | Results | Yes |
| `RECEIPTS` | Receipts | Yes |

**Preferences.** A `user_email_preference` row per user per category that can be turned off
(absent = on), shown as switches on the account page. The service checks it before queueing and
records `SKIPPED / OPTED_OUT`.

**One-click unsubscribe.** Every email in an optional category carries:

- a footer link "Stop these emails" to `/email/unsubscribe?token=…`, landing on a page that
  confirms and links to the preferences page;
- `List-Unsubscribe: <https://…/api/email/unsubscribe?token=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058), which Gmail and Yahoo
  show as an Unsubscribe button and require from bulk senders.

The token is a signed, purpose-scoped token (user id + category, its own audience, no expiry)
so it works without signing in and can't be reused for anything else.

**Why not SES list management.** SES v2 has contact lists and topics that add unsubscribe links and
headers for you, but the preference then lives in SES where the app can't show it, there is one
contact list per account (shared by QA and prod), and it only covers SES sends, not Mailpit.

> **Q7.1 Preference granularity. Decided (Derek 2026-10-21):** one on/off switch per category, the
> same for every league, with one-click unsubscribe. No digests.
>
> **Leagues are tenants (Derek 2026-10-21).** Members and commissioners get no cross-league
> features. Each email comes from one league, about that league, with links only into that league;
> nothing combines several leagues into one email or one page. The preference switch is a setting
> on the user's own account, not a league feature, so it doesn't break this rule.

## 8. Bounces and complaints

SES publishes bounce, complaint, delivery and reject events from the configuration set to an SNS
topic. Core-api receives them on `POST /api/email/ses-events`, an SNS HTTPS subscription:

- verify the SNS signature (and confirm the subscription once), reject anything else;
- match `mail.messageId` to `email_message.providerMessageId` and set `DELIVERED`, `BOUNCED` or
  `COMPLAINED`;
- on a permanent bounce or a complaint, add the address to an app-level `email_suppression` table
  (reason, date), so the app stops queueing to it and can say so: the commissioner sees "this
  address bounced" on the invite, and a member sees a banner asking them to fix their email;
- transient bounces are only recorded; SES retries them itself.

The SES account suppression list (§6) is the backstop; our table is what the app can read and show.

> **Q8.1 How events reach core-api.** In plain terms: SES only says "accepted" when we hand it an
> email. Whether it then reached the inbox, bounced, or was marked as spam is known minutes later.
> SES posts each of those reports to an AWS notification topic (SNS), and the topic calls a URL on
> our server. Core-api checks the report really came from AWS (it is signed), finds the email row by
> its SES message id, updates its state, and suppresses the address on a hard bounce or spam
> complaint. **Decided (Derek 2026-10-21): SNS → HTTPS webhook** on core-api. It fits "no
> external queue" and needs only signature checking. The alternative, SNS → SQS polled by core-api,
> survives core-api being down longer (SNS retries a webhook for about an hour), but adds a queue the
> architecture rules deliberately avoid. Losing an hour-old delivery event costs little; a bounce is
> also caught by the SES account suppression list.

## 8a. Scale

Derek (2026-10-21): this design is right for hundreds and thousands of leagues; note what changes
at hundreds of thousands.

Rough size at 100,000 leagues of 20 members, a few league emails a week each: about 6 million
emails a week, around 10 a second on average and a few hundred a second at peaks (standings right
after the NFL Sunday games). The sender is not a thread per email: one loop per core-api task
keeps many SES calls in flight while it waits on the network.

**League addresses don't reduce sending.** CBS and ESPN show a league address
(`<league>@football.cbssports.com`) as the sender, and mail to it reaches every member, like a
mailing list. Their list server still delivers one copy per member, so the work only moves from the
app to the list server. The league From address (§6a) gives the same look, as presentation
only; it is not a scale fix.

What to change when volume calls for it, all inside the email service, so no caller changes:

- ask AWS to raise the SES send rate (it starts around 14 a second in production);
- purge or partition `email_message` by month, since it grows by millions of rows a week;
- move the sender loop to its own service, scaled separately from the API;
- send through SES bulk sending (50 recipients a call), which needs a different template approach
  for those emails.

None of these is built now; #853 (deferred) tracks revisiting them.

## 9. Local and test behaviour

- **Local**: unchanged. `EMAIL_PROVIDER=smtp`, Mailpit at http://localhost:8025 catches everything.
  The outbox and sender run locally too, so local behaves like QA.
- **Unit**: each renderer (escaping, plural and date wording, optional lines), the registry's
  completeness, the email service's queue/skip decisions, the sender's retry and rate limit, the SNS
  signature check and event mapping, the unsubscribe token. SES transport keeps its fake
  `SesClientLike`.
- **Integration**: one test per outbox query (claim with skip-locked, mark sent, mark bounced,
  suppression lookup), per the integration coverage rule.
- **Functional**: `tests/functional/email.functional.ts` keeps asserting the SMTP sink receives each
  email once, now waiting for the sender to drain rather than assuming the send was inline.
  The sender is the real one; no test-mode path.
- **QA**: smoke users stay on `@e2e.invalid`, which the recipient guard skips, so smoke never sends.
- **Manual testing on QA without emailing real people** (Derek 2026-10-22): set
  `EMAIL_CONFIG.allowedRecipients` to your own address(es), and give manual test users
  plus-addresses of your inbox (`derek+alice@gmail.com`, `derek+bob@gmail.com`). Gmail delivers them
  all to you, through real SES, so DKIM, links and layout are tested for real; every other address is
  skipped and logged. Bounces and complaints are tested by sending to the SES mailbox simulator
  (`bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`,
  `success@simulator.amazonses.com`), which is allowed in the list and hurts no reputation. A
  hosted Mailpit for QA was considered and not chosen: it would bypass SES, the one thing QA must
  prove.

## 10. Slices, and the order across both plans

This plan's slices:

1. **Domain and sender** (Terraform + docs; Derek applies): single-apply DKIM (`count = 3`), custom
   MAIL FROM, DMARC, configuration set with set-level suppression, per-environment sender (Q6.1), sandbox exit
   request, QA recipient guard in `EMAIL_CONFIG`. Done when a QA invite reaches Gmail with DKIM, SPF
   and DMARC passing. Closes #120.
2. **Email service and registry**: `EmailCategory` with the catalog's categories, template registry,
   `emailService.send`, typed `templateKey`, recipient time zone in renderers, SES v2 transport, the
   three callers moved over, `replyTo` deleted, the league From address (§6a), preview script. No behaviour change.
3. **Outbox**: `email_message` table and enums, sender loop with retries, rate limit and
   idempotency, invites through it with their email state on the pending invites list (Q5.1).
4. **Bounces and complaints**: SNS topic and subscription in Terraform, the webhook, status updates,
   `email_suppression`, the invite and member warnings. The catalog's G2 delivery-problems email
   follows it.
5. **Preferences and unsubscribe**: preference table and account-page switches, unsubscribe token,
   page and one-click endpoint, footer link and `List-Unsubscribe` headers.

One order across both plans ("SES n" here, "Catalog n" in `plans/email-notifications.md` §5).
Steps on the same line can run in parallel:

| Step | Slices | Why here |
|---|---|---|
| 1 | SES 1 and SES 2 | Terraform and code don't touch each other |
| 2 | SES 3 and Catalog 1 | The outbox, and the scheduler's "notifications due" step with the reminder offsets and the entry reminders, are separate code |
| 3 | SES 4 and SES 5 | Bounce handling and unsubscribe must exist before email goes to many people |
| 4 | Catalog 2, then 3, 4, 5, 6 | Each new email is a registry entry plus a trigger; they all reuse the steps above |

QA email can be switched on after step 2 for the four existing emails, behind the recipient guard.
Password recovery's emails (catalog A1, A2) need SES 3 and arrive with that design.
