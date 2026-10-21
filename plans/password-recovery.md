# Password recovery

**Tracking issue:** #843

Written 2026-10-21 for Derek's ask: a person who forgets their password can get back in by
email, without a root admin. Derek answered every question on 2026-10-21; each now reads
**Decided** under its section.

Tickets: epic #843; slice 1 #847 (API, tokens, reset email); slice 2 #848 (screens and the
password changed email); #849 (root admin sends a reset link). Hashing refresh tokens is a
separate ticket, #850, outside this epic.

Two other design threads cover what this plan leans on and does not repeat: the **SES email
delivery** design (how real mail leaves the system, templates, tokens and merge data) and the
**notification catalog** (every email Poolmaster should send, by area). Password reset is one
row in that catalog; this plan owns its behavior.

---

## TL;DR

- **What exists today.** A signed-in user can change their own password, which needs the
  current one (it keeps the caller's session and signs out the rest). A root admin can reset
  somebody else's password to a temporary one, which signs that person out everywhere. There is **no** "Forgot password?" on sign in, no reset
  token, no reset email and no reset screen.
- **What this adds.** "Forgot password?" on sign in, a page that asks for the email or
  username, an email with a one-time link, and a page that sets the new password. A reset
  signs the account out of every device.
- **The link is the only authority.** A random 256-bit token, stored only as a SHA-256 hash,
  usable once, expiring after 10 minutes. A new request cancels any earlier link.
- **No account enumeration.** The request endpoint always answers the same thing, the same
  way, whether or not an account matches.
- **Rate limited** per account (silently) and per client address (with a typed 429).
- **Two slices**: API and email; then screens plus a "your password was changed" email.
  Then the root admin reset switches to sending this link.

---

## 1. Flow

1. On the sign in form, under the password field, a **Forgot password?** link opens
   `/forgot-password`.
2. The person enters their **email or username** and taps **Send reset link**.
3. The page always shows the same confirmation, whatever the answer was:
   *"Check your email. If an account matches, we've sent a link to reset your password. The
   link works once and expires in 10 minutes."* with **Back to sign in**.
4. If an account matches, it gets the reset email (section 4). If nothing matches, the server
   logs a warning (with nothing identifying, see section 3) and does nothing else.
5. The link opens `/reset-password` with the token. The page asks for **New password** and
   **Confirm new password** and has a **Set new password** button.
6. On success: every session for that account is revoked, every other open reset link for it
   is cancelled, and the page shows *"Your password is reset. Sign in with your new password."*
   with a **Sign in** button.
7. If the link is used, expired, cancelled or wrong, the page shows *"This reset link has
   expired or has already been used."* with **Send a new link**, which goes back to step 2.

Inactive accounts may reset, because an inactive account may still sign in (access rule A9
in `docs/DOMAIN-OPERATIONS.md`): reactivating it needs a session.

**Q1.1 Email only, or email or username?** Sign in takes either, and someone who forgot a
password may remember only one. **Decided:** accept either, with the field labelled
"Email or username", and always mail the account's email address. One lookup already does
this (`findByIdentifier`). No match: `log.warn` and no other action.

**Q1.2 Sign in automatically after the reset?** **Decided:** no. Send them to sign in.
It proves the new password works, and a reset link forwarded to the wrong inbox does not
also hand out a live session. It costs one extra screen.

**Q1.3 Check the link before the form shows?** A check-on-load endpoint would tell someone
the link is dead before they type a password. **Decided:** skip it for now. The set
password call already answers "link expired", and the page keeps what they typed so
**Send a new link** is one tap. Easy to add later if it annoys people.

## 2. Reset tokens

A new table, `password_reset_tokens`, owned by the auth module (like `refresh_tokens`):

| Column | Meaning |
|---|---|
| `id` | uuid |
| `user_id` | the account, indexed |
| `token_hash` | SHA-256 of the token, hex, unique |
| `expires_at` | issue time plus 10 minutes |
| `used_at` | set once, when the password is set |
| `cancelled_at` | set when a newer request or a password change replaces it |
| `created_at` | also drives the per-account rate limit |

- **The token** is 32 bytes from `crypto.randomBytes`, base64url. Only the hash is stored, so
  a database read or backup cannot be used to reset anybody. SHA-256 is enough because the
  token has 256 bits of entropy; bcrypt is for low-entropy secrets like passwords.
- **Single use, race-safe.** Confirm runs in one transaction: an `updateMany` on
  `token_hash = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > now()` that
  sets `used_at`. Count 1 means this caller won; count 0 means the link is dead. Two clicks at
  once cannot both set a password.
- **One live link per account.** Issuing a token cancels the account's earlier unused ones.
  A successful reset or an own password change also cancels any open ones.
- **Housekeeping.** Each new request deletes that account's rows older than 30 days. There is
  no scheduler and this needs none.
- **Why not reuse refresh tokens or invite codes?** Both are stored in plain text today, which
  is fine for neither a password reset nor (separately) a refresh token. This table does not
  copy that. Hashing refresh tokens is out of scope here; noted as **Q2.1**.

**Q2.1 Hash refresh tokens too?** They are stored as plain uuids, so a database leak is a set
of live sessions. **Decided:** a separate ticket, #850, outside this epic; it touches login,
refresh, logout and every session revoke. Low priority while QA holds only test users.

**Q2.2 Link lifetime.** **Decided:** 10 minutes. Short enough to limit a forwarded or leaked
link. It means the reset email must leave at once: if the SES design's outbox queues mail,
the reset email goes out immediately rather than waiting behind notification batches.

## 3. API

Both routes sit under `/api/v1/auth`, are public, follow the add-endpoint chain (DTO, schema
registry, route, regenerated client, contract verification) and use typed error codes.

**`POST /auth/password-reset/request`** (`requestPasswordReset`)

- Body: `{ identifier: string }` (1-255, trimmed, lower-cased like login).
- Always `202` with `SuccessResponse` and the same message, whether an account matched,
  was rate limited, or had no email.
- `429` `PASSWORD_RESET_RATE_LIMITED` only for the per-address limit (section 5), which says
  nothing about any account.
- `400` for a malformed body only.

**`POST /auth/password-reset/confirm`** (`confirmPasswordReset`)

- Body: `{ token, newPassword, confirmNewPassword }`, with the same 8-128 password rule as
  register and change password (one shared schema, not a third copy).
- `200` `SuccessResponse`.
- `400` `PASSWORD_RESET_LINK_INVALID` for unknown, used, cancelled or expired, all one code.
  Telling "expired" from "used" helps nobody and leaks a little.
- `400` `PASSWORD_CONFIRMATION_MISMATCH` (existing code).
- `429` `PASSWORD_RESET_RATE_LIMITED` for the per-address limit.

On success, in one transaction: set the new bcrypt hash, mark the token used, cancel the
account's other open tokens, and revoke every refresh token (`revokeUserSessions` with no
token kept). Access tokens are 15-minute JWTs and are not revocable, so another device can
keep working for up to 15 minutes; that is the same window an admin reset has today.

**Enumeration and timing.** The request handler answers `202` first and does the lookup, token
write and email send after the reply, so a matching account is not measurably slower. Send
failures are logged (ids only) and never reach the caller. Honest caveat: register already
answers `ACCOUNT_EMAIL_TAKEN`, so whether an email has an account is discoverable there; this
endpoint just must not add a second, easier way.

**Access rules.** `docs/DOMAIN-OPERATIONS.md` gains a short entry: the confirm route writes a
user with no session, and the token is its whole authority. It sits next to A6 (only the
user or a root admin writes a user) as the one unauthenticated user write.

**Logging** (`rules/service-rules.md` §11): `authService.passwordReset.requested` with
`userId` when matched; at warn level and with nothing identifying when nothing matched, `.rateLimited`, `.confirmed`,
`.linkInvalid`. Never the token, the link, the identifier typed, or the email body.

## 4. The email

New template key `PASSWORD_RESET` in `system-email-templates.ts`, built with the same shared
layout as the invite emails. Data: `firstName`, `username`, `resetUrl`, `expiresInMinutes`.

- **Subject:** Reset your Poolmaster password
- **Body:**
  > Hi {firstName},
  >
  > We got a request to reset the password for your Poolmaster account ({username}).
  >
  > **[Choose a new password]**
  >
  > This link works once and expires in {expiresInMinutes} minutes. If you didn't ask for
  > this, you can ignore this email. Your password won't change.
- **Plain text** version with the same words and the bare link.
- **The link** is `{appBaseUrl}/reset-password#token={token}`. The token goes in the URL
  fragment, which browsers never send to a server, so it stays out of CloudFront and API
  logs and out of `Referer` headers. The page reads it, then clears it from the address bar.
- The brand name comes from the existing `BRAND_NAME` constant, so the open app-name
  question changes it in one place.
- How templates are stored, edited and merged (code today, maybe SES templates later) is the
  SES design's call; this template moves with whatever it decides.

**Q4.1 Can a root admin switch this email off?** `EMAIL_CONFIG` lists every template with an
on/off switch. Switching off the reset email silently breaks recovery. **Decided:** keep
`PASSWORD_RESET` out of the per-template switches (always on), but still obey the global
"send email" switch, which is what keeps QA quiet today.

**QA note.** QA's `EMAIL_CONFIG` defaults to sending nothing until real delivery is set up
(the SES design). The feature can merge before that; the reset email just will not arrive in
QA until delivery is on. API tests read the message from the test mail provider instead.

## 5. Rate limiting

There is no shared rate limiter, and production runs two core-api tasks, so the limits are:

- **Per account, in the database:** at most 3 reset emails per account per hour, counted from
  `password_reset_tokens.created_at`. Over the limit the request still answers `202` and
  sends nothing, so the limit reveals nothing.
- **Per client address, in memory per task:** 5 requests and 10 confirms per minute, using
  the same sliding-window shape as the client-logs limiter. With two tasks the real ceiling is
  double, which is fine: the token's entropy, not the limiter, is what stops guessing.

**Q5.1 Also send a "your password was changed" email?** It tells a person whose account was
taken over that something happened. **Decided:** yes, in slice 2, after a reset and after
an own password change (not after an admin reset, which already involves a person). Subject
*"Your Poolmaster password was changed"*, body says when, and *"If this wasn't you, reset your
password now"* with a link to `/forgot-password`.

## 6. Screens

All copy is product copy (`rules/ux-rules.md`), built per `rules/react-ui-rules.md` with the
generated client and TanStack Query mutations.

- **Sign in form** (`auth-home-page.tsx`): a **Forgot password?** link under the password
  field. Not shown on the create account tab.
- **`/forgot-password`**, public: title *Reset your password*, one field *Email or username*,
  **Send reset link**, then the confirmation in section 1 step 3. A 429 shows *"Too many
  tries. Wait a minute and try again."*
- **`/reset-password`**, public: title *Choose a new password*, two password fields, **Set new
  password**. Success and dead-link states as in section 1. A missing token shows the
  dead-link state. A signed-in person who opens a link still gets the form; on success their
  own session ends too, and the page sends them to sign in.
- **My account** keeps its existing change password section unchanged.

**Q6.1 Should a root admin send a reset link instead of a temporary password?** The admin
reset makes the admin read a password to someone. **Decided:** yes, this becomes the way an
admin resets a password, deferred to its own ticket, #849. Once slices 1 and 2 ship it is a
small change: the admin action calls the same request service for that user, and the
temporary password path goes away.

## 7. Slices

1. **API and email (#847).** Migration for `password_reset_tokens`; the two routes, DTOs, error
   codes `PASSWORD_RESET_LINK_INVALID` and `PASSWORD_RESET_RATE_LIMITED`; the `PASSWORD_RESET`
   template; limits; regenerated client; `docs/DOMAIN-OPERATIONS.md` and
   `docs/EMAIL-DELIVERY.md` updates. Tests: unit for token issue, hash, expiry and cancel;
   integration for the single-use race and session revoke; an API scenario that requests,
   reads the link from the test mail provider, confirms, and shows the old refresh token is
   dead and the new password signs in; the not-found path answers identically.
2. **Screens and password changed email (#848).** The link on sign in, the two pages,
   MSW-backed component tests, and a browser test of the whole flow. Plus the
   `PASSWORD_CHANGED` template, sent from
   the reset and own-change paths, after the password write commits; a send failure is logged
   and does not undo the change.
3. **Root admin sends a reset link (#849).** After 1 and 2.

Slices 1 and 2 could share one PR; the screens are small.
