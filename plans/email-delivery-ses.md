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
  complaints; preferences and unsubscribe.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| Transports | `packages/core-api/src/modules/email/mail-delivery.ts` | `SmtpMailDeliveryProvider` (nodemailer, Mailpit locally) and `SesMailDeliveryProvider` (`@aws-sdk/client-ses`, the v1 API, `SendEmail` with our own subject, text and HTML). Chosen by `EMAIL_PROVIDER`. |
| Settings switch | `email-settings.ts`, `EMAIL_CONFIG` (#450) | `enabled`, `replyTo`, one switch per template. Off by default on QA. `SettingsAwareMailDeliveryProvider` wraps the transport and skips switched-off sends. |
| Template keys | `EmailTemplateKeySchema` in `packages/shared/dto/config.dto.ts` | A zod enum: `LEAGUE_MEMBER_INVITE`, `LEAGUE_JOIN_SUCCESS`, `CONTEST_ENTRY_COMPLETED`, `CONTEST_STARTED_SUMMARY`. |
| Rendering | `system-email-templates.ts` | One typed renderer per key (`SystemEmailTemplateDataByKey`), a shared branded HTML shell, plain-text twin, HTML escaping. |
| Callers | leagues `invitation-service.ts`, contests `service.ts`, events `event-lifecycle-service.ts` | Each renders, then calls `mailDelivery.send` inline, one recipient at a time. Invites fail the request on a provider error; the others are best effort and log. |
| Terraform | `infrastructure/terraform/main.tf` | SES domain identity and Easy DKIM for `domain_name` (QA: `ultimateofficepoolmanager.com`), DKIM CNAMEs in Route 53, IAM `ses:SendEmail`/`SendRawEmail` for the ECS task, `EMAIL_PROVIDER=ses`, `SES_FROM_EMAIL=noreply@<domain>`. **Never applied to QA** (#120): the DKIM `for_each` needs a two-pass `-target` apply. |
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

> **Q2.1 Templates: in code or in SES?** Recommendation: **in code**, as today, with SES used only to
> deliver. SES templates would trade compile-checked tokens for silent drops and a second deploy path,
> for no feature we lack.

## 3. Typed template IDs

Today's zod enum stays the one list of emails, and every new email is a new member. Each key gets a
registry entry, checked with `satisfies Record<EmailTemplateKey, …>` so adding a key without a
renderer, a category or a settings switch is a compile error (the `EMAIL_CONFIG.templates` record
already works this way):

```
EMAIL_TEMPLATES = {
  LEAGUE_MEMBER_INVITE: { category: EmailCategory.INVITATION,  render: renderLeagueMemberInvite },
  CONTEST_RELEASED:     { category: EmailCategory.CONTEST_UPDATES, render: renderContestReleased },
  PASSWORD_RESET:       { category: EmailCategory.ACCOUNT,     render: renderPasswordReset },
  …
} satisfies Record<EmailTemplateKey, EmailTemplateDefinition<…>>
```

- `EmailCategory` is a new enum (and a Postgres enum where stored). It decides whether a member can
  turn the email off (§7) and which unsubscribe link it carries.
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
| `idempotencyKey` (unique) | e.g. `CONTEST_RELEASED:<contestId>:<userId>`, so a retried transition or a double click never sends twice |
| `subject`, `textBody`, `htmlBody` | Rendered at queue time: what we send is what we stored. Bodies are cleared after 30 days; the row stays |
| `status` | `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `BOUNCED`, `COMPLAINED`, `FAILED`, `SKIPPED` |
| `skipReason` | `EMAIL_DISABLED`, `TEMPLATE_DISABLED`, `SUPPRESSED`, `OPTED_OUT`, `NOT_ALLOWED_IN_ENVIRONMENT` |
| `attempts`, `nextAttemptAt`, `lastError` | Retry with backoff (1 min, 5 min, 30 min, then `FAILED`) |
| `providerMessageId`, `sentAt` | SES message id, to match bounce events |

**Sender.** An in-process loop, like the event lifecycle scheduler, claims due rows with
`FOR UPDATE SKIP LOCKED` (prod runs two tasks), sends them, and records the outcome. A queue write
also wakes it, so an invite goes out within a second rather than at the next tick. It sends no
faster than a rate held in `EMAIL_CONFIG` (default 10 per second; SES production accounts start at
14), and a throttling error just pushes `nextAttemptAt`.

**What this changes for invites.** Today a provider error fails the invite request with
`LEAGUE_INVITATION_EMAIL_DELIVERY_FAILED`. With the outbox the invite is created and its email
queued; the commissioner's pending invites list shows the email's state ("Sent", "Bounced", "Could
not send") and Resend works as today.

> **Q5.1 Invites through the outbox?** Recommendation: **yes**, every email goes through the outbox, and
> the pending invites list shows each invite's email state. The alternative keeps invites synchronous
> so the commissioner sees an error at once, but leaves two send paths, and SES rarely refuses at
> submit time anyway: a bad address shows up minutes later as a bounce, which only the outbox sees.

## 6. Domain, sender and getting out of the sandbox

Steps, in order (slice 1; Derek runs the Terraform applies and the AWS console request, as today):

1. **Fix the DKIM two-pass apply** (#120): `terraform apply -target=aws_ses_domain_identity.mail
   -target=aws_ses_domain_dkim.mail`, then a full apply. Document it in
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
6. **Account suppression list** (`aws_sesv2_account_suppression_attributes`) for `BOUNCE` and
   `COMPLAINT`, so SES itself refuses addresses that bounced or complained, across environments.
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

> **Q6.1 Sending address per environment.** Today QA would send as `noreply@ultimateofficepoolmanager.com`,
> the same identity prod would use. Recommendation: **each environment sends from its own subdomain
> identity** (QA `noreply@qa.ultimateofficepoolmanager.com`, prod the bare domain later), so QA
> bounces and test complaints never touch prod's sending reputation. The display name follows the
> app-name decision in its own thread.
>
> **Q6.2 Reply-To.** `noreply@` can't take replies. Recommendation: keep `noreply@` as sender and set
> `EMAIL_CONFIG.replyTo` to a real inbox Derek reads (league emails could later reply to the
> commissioner instead; that belongs with the notifications design).

## 7. Unsubscribe and preferences

**Categories.** Every template has a category (§3). A starting set; the notifications thread may
split them:

| Category | Examples | Can be turned off? |
|---|---|---|
| `ACCOUNT` | Password reset, welcome | No |
| `INVITATION` | League invite | No for a member; a non-member can "never email me again", which suppresses the address |
| `ENTRY_RECEIPT` | Entry submitted | Yes |
| `CONTEST_UPDATES` | Contest released, entry reminder, contest live, standings, final results | Yes |
| `COMMISSIONER` | Upcoming events to set up | Yes |

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

> **Q8.1 How events reach core-api.** Recommendation: **SNS → HTTPS webhook** on core-api. It fits "no
> external queue" and needs only signature checking. The alternative, SNS → SQS polled by core-api,
> survives core-api being down longer (SNS retries a webhook for about an hour), but adds a queue the
> architecture rules deliberately avoid. Losing an hour-old delivery event costs little; a bounce is
> also caught by the SES account suppression list.

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

## 10. Slices

1. **Domain and sender** (Terraform + docs; Derek applies): two-pass DKIM apply, custom MAIL FROM,
   DMARC, configuration set, account suppression list, per-environment sender (Q6.1), sandbox exit
   request, QA recipient guard in `EMAIL_CONFIG`. Done when a QA invite reaches Gmail with DKIM, SPF
   and DMARC passing. Closes #120.
2. **Email service and registry**: `EmailCategory`, template registry, `emailService.send`, typed
   `templateKey`, SES v2 transport, the three callers moved over, preview script. No behaviour change.
3. **Outbox**: `email_message` table and enums, sender loop with retries, rate limit and
   idempotency, invites through it with their email state on the pending invites list (Q5.1).
4. **Bounces and complaints**: SNS topic and subscription in Terraform, the webhook, status updates,
   `email_suppression`, the invite and member warnings.
5. **Preferences and unsubscribe**: preference table and account-page switches, unsubscribe token,
   page and one-click endpoint, footer link and `List-Unsubscribe` headers.

The notification emails from the other design can start after slice 3; they need slice 5 before
they go to real leagues.
