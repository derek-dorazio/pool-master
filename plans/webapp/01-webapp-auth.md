# PoolMaster — Authentication & Onboarding Pages

This plan covers the landing page, login, registration, password reset, and auth callback pages for the PoolMaster React webapp. These pages form the unauthenticated entry points and the onboarding flow for new users.

**Related service plans:**

- **01 — Architecture & Auth:** Authentication provider integration (Auth0/Cognito), JWT handling, session management
- **07 — Billing:** Trial activation and plan selection during registration
- **14 — i18n:** All user-facing strings externalized for localization
- **15 — Compliance:** Age verification (COPPA, 13+ requirement), Terms of Service acceptance, Privacy Policy consent

---

## Pages

### 1. Landing Page

**Route:** `/`

**Purpose:** Marketing page shown to unauthenticated visitors. Communicates the product value proposition and drives users toward registration or login. If the user is already authenticated, redirects to `/dashboard`.

**Key Components:**

- **Hero** — Full-width banner with headline, subheadline, and primary CTA button ("Get Started Free"). Background uses subtle sports imagery or animated gradient.
- **FeatureGrid** — 2x3 grid of feature cards (e.g., "Run Any Pool Type", "Live Scoring", "Invite Friends", "Mobile Ready", "Fair Payouts", "League History"). Each card has an icon, title, and short description.
- **SportCarousel** — Horizontal scrollable row of supported sport logos (NFL, NBA, NCAA, Soccer, Golf, NASCAR, Tennis, F1, Horse Racing). Auto-scrolls on desktop, swipeable on mobile.
- **SocialProof** — Testimonial cards or stats bar ("10,000+ pools created", "50+ sports supported").
- **CTASection** — Secondary call-to-action block before the footer. Reinforces the free tier and invites sign-up.
- **Footer** — Links to Terms of Service, Privacy Policy, Contact, and social media.

**Data Requirements:**

- No authenticated API calls required.
- Auth state check on mount: if valid session exists, redirect to `/dashboard`.
- Static content; no server data fetching beyond auth check.

**User Interactions / Flows:**

1. User lands on `/` -> sees marketing content.
2. Clicks "Get Started" CTA -> navigates to `/register`.
3. Clicks "Log In" in the top nav -> navigates to `/login`.
4. If already authenticated -> automatic redirect to `/dashboard`.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                          [Log In]  [Get Started]  |
+----------------------------------------------------------+
|                                                          |
|              Run Your Pool Like a Pro                    |
|       The all-in-one platform for sports pools,          |
|         brackets, and fantasy competitions.              |
|                                                          |
|               [ Get Started Free ]                       |
|                                                          |
+----------------------------------------------------------+
|  [Feature]  [Feature]  [Feature]                         |
|  [Feature]  [Feature]  [Feature]                         |
+----------------------------------------------------------+
|  [ NFL ] [ NBA ] [ NCAA ] [ Soccer ] [ Golf ] [ ... ]   |
+----------------------------------------------------------+
|  "PoolMaster made our office pool so easy." — User       |
|           10,000+ pools  |  50+ sports                   |
+----------------------------------------------------------+
|  Ready to start?        [ Sign Up Free ]                 |
+----------------------------------------------------------+
|  Terms | Privacy | Contact           (c) 2026 PoolMaster |
+----------------------------------------------------------+
```

---

### 2. Login

**Route:** `/login`

**Purpose:** Authenticates returning users via email/password or social login providers. On success, establishes a session and redirects to the dashboard.

**Key Components:**

- **LoginForm** — Email and password fields with client-side validation. Includes "Remember me" checkbox and "Forgot password?" link.
- **SocialLoginButtons** — "Continue with Google" and "Continue with Apple" buttons. Each initiates an OAuth flow via the auth provider.
- **ErrorAlert** — Inline error banner for invalid credentials, locked accounts, or network failures.
- **RegisterLink** — "Don't have an account? Sign up" link below the form.

**Data Requirements:**

- `POST /api/auth/login` — Email/password authentication (or delegated to Auth0/Cognito).
- OAuth redirect initiation for social login providers.
- On success: store JWT access token and refresh token (Zustand auth store + secure cookie).
- Auth state check on mount: if already authenticated, redirect to `/dashboard`.

**User Interactions / Flows:**

1. User enters email and password -> clicks "Log In".
2. On success -> redirect to `/dashboard` (or to the originally requested URL if redirected here).
3. On failure -> display error message, keep form populated.
4. Clicks "Continue with Google" -> redirect to Google OAuth -> returns to `/callback`.
5. Clicks "Continue with Apple" -> redirect to Apple OAuth -> returns to `/callback`.
6. Clicks "Forgot password?" -> navigates to `/forgot-password`.
7. Clicks "Sign up" -> navigates to `/register`.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                                     [Sign Up]     |
+----------------------------------------------------------+
|                                                          |
|                     Welcome Back                         |
|                                                          |
|    +----------------------------------------------+      |
|    | Email                                        |      |
|    +----------------------------------------------+      |
|    | Password                              [Show] |      |
|    +----------------------------------------------+      |
|                                                          |
|    [x] Remember me            Forgot password?           |
|                                                          |
|    [            Log In            ]                       |
|                                                          |
|    ──────────── or ────────────                          |
|                                                          |
|    [ Continue with Google ]                               |
|    [ Continue with Apple  ]                               |
|                                                          |
|    Don't have an account? Sign up                        |
+----------------------------------------------------------+
```

---

### 3. Registration

**Route:** `/register`

**Purpose:** Multi-step onboarding flow for new users. Collects credentials, profile information, age verification, legal consent, and optional plan selection. Uses React Hook Form with per-step validation.

**Key Components:**

- **StepIndicator** — Horizontal progress bar showing steps 1 through 5 with labels. Current step is highlighted; completed steps show a checkmark.
- **RegistrationForm** — Step 1: Email, password, confirm password fields (or social sign-up buttons). Password strength indicator included.
- **ProfileSetup** — Step 2: Display name (required), avatar upload (optional, with preview), timezone auto-detection.
- **AgeVerification** — Step 3: Date of birth picker. Validates user is 13 or older. Displays clear messaging about age requirements. Blocks progression if under 13.
- **TermsAcceptance** — Step 4: Scrollable Terms of Service and Privacy Policy text (or links to full documents). Two separate checkboxes: "I agree to the Terms of Service" and "I agree to the Privacy Policy". Both required.
- **PlanSelector** — Step 5 (optional): Card layout showing Free, Pro, and Premium tiers with feature comparison. Free tier is pre-selected as default. User can skip or select a paid plan. Paid plan selection leads to Stripe checkout after account creation.

**Data Requirements:**

- `POST /api/auth/register` — Creates account with email/password or links social provider.
- `POST /api/users/profile` — Saves display name, avatar, timezone.
- `POST /api/compliance/age-verify` — Submits DOB for age verification record.
- `POST /api/compliance/consent` — Records ToS and Privacy Policy acceptance with timestamps.
- `GET /api/billing/plans` — Fetches available subscription plans for step 5.
- React Hook Form manages all form state across steps; Zustand stores partial registration state for persistence across page refreshes.

**User Interactions / Flows:**

1. Step 1: User enters email + password (with confirmation) or clicks social sign-up -> validated -> next.
2. Step 2: User enters display name, optionally uploads avatar -> validated -> next.
3. Step 3: User enters date of birth -> system validates age >= 13 -> next. If under 13 -> blocked with message.
4. Step 4: User reads and checks both ToS and Privacy Policy checkboxes -> next.
5. Step 5: User sees plan options -> selects Free (default) or a paid plan -> clicks "Create Account".
6. Account is created -> redirect to `/dashboard` with welcome modal.
7. If paid plan selected -> redirect to Stripe checkout -> on success redirect to `/dashboard`.
8. "Already have an account? Log in" link available on step 1.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                                     [Log In]      |
+----------------------------------------------------------+
|                                                          |
|   (1)--------(2)--------(3)--------(4)--------(5)       |
|  Account    Profile     Age       Terms      Plan        |
|    [*]        [ ]       [ ]        [ ]       [ ]         |
|                                                          |
|  +--------------------------------------------------+   |
|  |                                                    |   |
|  |  Step 1: Create Your Account                      |   |
|  |                                                    |   |
|  |  Email:    [________________________]              |   |
|  |  Password: [________________________]              |   |
|  |  Confirm:  [________________________]              |   |
|  |            [Weak -------- Strong]                  |   |
|  |                                                    |   |
|  |  ──────────── or ────────────                     |   |
|  |  [ Sign up with Google ]                           |   |
|  |  [ Sign up with Apple  ]                           |   |
|  |                                                    |   |
|  +--------------------------------------------------+   |
|                                                          |
|                  [Back]   [Next ->]                       |
|                                                          |
|           Already have an account? Log in                |
+----------------------------------------------------------+
```

---

### 4. Forgot Password

**Route:** `/forgot-password`

**Purpose:** Allows users to request a password reset email. Simple single-page flow with email input and confirmation state.

**Key Components:**

- **ForgotPasswordForm** — Single email input field with submit button. Client-side email format validation.
- **ConfirmationMessage** — Shown after submission. Displays "Check your email for a reset link" message with an icon. Includes "Back to login" link.
- **ErrorAlert** — Inline error for network failures (not for "email not found" to prevent enumeration).

**Data Requirements:**

- `POST /api/auth/forgot-password` — Sends reset email. Always returns success (to prevent user enumeration).
- No authenticated state required.

**User Interactions / Flows:**

1. User enters email -> clicks "Send Reset Link".
2. API call fires -> on completion, show confirmation message regardless of whether the email exists.
3. User clicks "Back to login" -> navigates to `/login`.
4. User clicks reset link in email -> handled by auth provider's reset flow -> returns to `/login`.

**Wireframe:**

```
+----------------------------------------------------------+
| [Logo]                                     [Log In]      |
+----------------------------------------------------------+
|                                                          |
|                  Reset Your Password                     |
|                                                          |
|   Enter the email address associated with your           |
|   account and we'll send you a reset link.               |
|                                                          |
|   +----------------------------------------------+      |
|   | Email                                        |      |
|   +----------------------------------------------+      |
|                                                          |
|   [         Send Reset Link          ]                   |
|                                                          |
|   Back to login                                          |
|                                                          |
+----------------------------------------------------------+

--- After submission: ---

+----------------------------------------------------------+
| [Logo]                                     [Log In]      |
+----------------------------------------------------------+
|                                                          |
|                  Check Your Email                        |
|                    [mail icon]                            |
|                                                          |
|   If an account exists for that email, we've sent        |
|   a password reset link. Check your inbox.               |
|                                                          |
|   [         Back to Login            ]                   |
|                                                          |
+----------------------------------------------------------+
```

---

### 5. Auth Callback

**Route:** `/callback`

**Purpose:** Handles OAuth redirect responses from social login providers (Google, Apple). Processes the authorization code or token, establishes the session, and redirects the user.

**Key Components:**

- **CallbackHandler** — Non-visual component that extracts query parameters (code, state, error) from the URL and processes the OAuth exchange.
- **LoadingSpinner** — Full-page centered spinner with "Signing you in..." text. Shown while the token exchange is in progress.
- **ErrorState** — Displayed if the OAuth flow fails. Shows error message and "Try again" button that navigates back to `/login`.

**Data Requirements:**

- `POST /api/auth/callback` — Exchanges authorization code for access/refresh tokens.
- On success: store tokens in Zustand auth store, set secure cookie for refresh token.
- On error: capture error type (denied, expired, invalid_state) for appropriate messaging.

**User Interactions / Flows:**

1. Auth provider redirects to `/callback?code=xxx&state=yyy`.
2. Page shows loading spinner while token exchange occurs.
3. On success -> redirect to `/dashboard` (or to the URL stored in the `state` parameter).
4. On error -> show error message with "Try again" link to `/login`.
5. If user navigates directly to `/callback` without parameters -> redirect to `/login`.

**Wireframe:**

```
+----------------------------------------------------------+
|                                                          |
|                                                          |
|                    [spinner]                              |
|              Signing you in...                           |
|                                                          |
|                                                          |
+----------------------------------------------------------+

--- On error: ---

+----------------------------------------------------------+
|                                                          |
|                                                          |
|                  [error icon]                             |
|            Something went wrong                          |
|                                                          |
|   We couldn't complete the sign-in. Please try again.    |
|                                                          |
|              [ Back to Login ]                            |
|                                                          |
+----------------------------------------------------------+
```

---

## Cross-Cutting Concerns

- **Public Layout:** All pages listed above use the Public layout (no sidebar, no authenticated navigation). The layout includes the top nav bar with the logo, and conditionally shows "Log In" / "Sign Up" buttons.
- **Cookie Consent Banner:** A dismissible banner appears on first visit (before any cookies are set). Consent preference is stored in localStorage. Required for GDPR and general compliance.
- **i18n:** All user-facing strings are externalized via `i18next` and loaded from translation JSON files. Default locale is `en-US`. Language selector is available in the footer.
- **Mobile Responsive:** All pages are fully responsive. The landing page stacks feature cards vertically on small screens. Forms use full-width inputs on mobile. Social login buttons stack vertically. The step indicator on registration collapses to show only the current step label on narrow viewports.
- **Accessibility:** All forms use proper `label` associations, `aria-live` regions for error messages, and keyboard-navigable controls. Color contrast meets WCAG 2.1 AA.
- **Rate Limiting:** Login and forgot-password forms include client-side throttling (disable button for 2 seconds after submission) to complement server-side rate limits.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-A-001 | 1 | Build Landing page with Hero, FeatureGrid, SportCarousel, SocialProof, CTASection, and Footer components | Done | Full implementation with hero, 6-card feature grid, sport badges, social proof bar, secondary CTA. Auth redirect to /dashboard. |
| W-A-002 | 1 | Build Login page with email/password form, social login buttons, error handling, and redirect logic | Done | React Hook Form + zod, show/hide password, remember me, social buttons, error display, API integration. |
| W-A-003 | 1 | Build Registration multi-step form with StepIndicator and step navigation (React Hook Form) | Done | 5-step wizard (Account, Profile, Age, Terms, Plan) with progress bar, per-step validation, shared form context. |
| W-A-004 | 1 | Build AgeVerification component with DOB picker and 13+ validation logic | Done | 3-dropdown DOB picker (month/day/year) with 13+ age calculation and error message. Integrated as Step 3 of registration. |
| W-A-005 | 1 | Build TermsAcceptance component with scrollable legal text and consent checkboxes | Done | Two required checkboxes with links to /terms and /privacy. Integrated as Step 4 of registration. |
| W-A-006 | 1 | Build Forgot Password page with email form and confirmation state | Done | Two-state page: email form and "Check Your Email" confirmation. Prevents enumeration by always showing success. |
| W-A-007 | 1 | Build Auth Callback handler with token exchange, loading state, and error handling | Done | Extracts code/state from URL, shows spinner, calls API, handles errors, redirects to /login if no params. |
| W-A-008 | 1 | Implement auth state management — Zustand store for tokens, user session, and auth status; secure cookie handling for refresh tokens | Done | Auth store already existed. Auth pages integrate with useAuthStore for setUser, localStorage for access_token. |
