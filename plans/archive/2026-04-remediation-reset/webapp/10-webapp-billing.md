# PoolMaster — Billing & Subscription

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

**Routes:** `/billing`, `/billing/plans`, `/billing/invoices`
**Layout:** Authenticated (sidebar + top nav)
**Maps to:** 07 (Billing & Subscription)

Billing pages allow users to view their current plan, compare available tiers, and see truthful free-only placeholders for payment and invoice surfaces. Phase 1 launches as free-only — the billing UI is scaffolded but most features are deferred until Stripe integration. Components render gracefully in free-only mode: plan cards show "Free" with no payment details, upgrade CTAs are visible but link to a "coming soon" state, and invoice/payment sections remain hidden or unavailable until the real provider-backed flows exist.

---

## Components

### 1. Billing Overview (`/billing`)

The primary billing page showing the user's current subscription status, usage against plan limits, and payment information.

**Component:** `BillingOverviewPage`
**File:** `clients/web/src/features/billing/billing-overview-page.tsx`

#### Current Plan Card

**Component:** `PlanCard`
**File:** `clients/web/src/features/billing/plan-card.tsx`

**Data displayed:**
- Plan name (e.g. "Free", "Starter", "Pro", "League+")
- Tier badge with colour coding (grey for Free, blue for Starter, purple for Pro, gold for League+)
- Renewal date (e.g. "Renews Apr 26, 2026") — hidden for Free tier
- Price per billing cycle (e.g. "$9.99/mo") — shows "Free" for free tier
- "Change Plan" button navigating to `/billing/plans`

**Behaviour:**
- On Free tier: shows plan name and badge only, no renewal date or price, "Upgrade" button instead of "Change Plan"
- On paid tier: shows full details with renewal date and price
- Badge uses shadcn/ui `Badge` component with tier-specific variant

**API:** `GET /billing/subscription`

---

#### Usage Summary

**Component:** `UsageMeter`
**File:** `clients/web/src/features/billing/usage-meter.tsx`

**Data displayed per limit:**
- Leagues created vs plan limit (e.g. "2 of 3 leagues")
- Contests created vs plan limit (e.g. "5 of 10 contests")
- Members across all leagues vs plan limit (e.g. "24 of 50 members")
- Progress bar for each metric (green under 75%, amber 75-90%, red over 90%)

**Behaviour:**
- Each meter rendered as a labelled progress bar with count text
- When a limit is reached (100%), the bar turns red and a tooltip explains "Upgrade your plan to create more"
- Free tier shows limits; unlimited tiers show "Unlimited" instead of a progress bar
- Responsive: stacked vertically on mobile, horizontal row on desktop

**API:** `GET /billing/usage`

---

#### Payment Method

**Component:** `PaymentMethodCard`
**File:** `clients/web/src/features/billing/payment-method-card.tsx`

**Data displayed:**
- Card brand icon (Visa, Mastercard, Amex, etc.)
- Last 4 digits of card on file (e.g. "Visa ending in 4242")
- Expiry date (e.g. "Expires 12/2027")
- "Update" button redirecting to Stripe Customer Portal

**Behaviour:**
- Hidden entirely on Free tier (no payment method required)
- Hidden in Phase 1 (free-only launch)
- "Update" button opens Stripe Customer Portal via `POST /billing/portal-session` redirect
- If no card on file: shows "No payment method" with "Add payment method" CTA
- Card brand icon mapped from `card.brand` field

**API:** `GET /billing/payment-method`

---

#### Next Invoice Preview

**Component:** `InvoicePreview`
**File:** `clients/web/src/features/billing/invoice-preview.tsx`

**Data displayed:**
- Next invoice amount (e.g. "$9.99")
- Next invoice date (e.g. "Apr 26, 2026")
- Line items if proration applies (e.g. "Prorated upgrade from Starter to Pro")

**Behaviour:**
- Hidden on Free tier
- Hidden in Phase 1
- Shows upcoming charge amount and date
- If proration credits exist, displayed as line items with amounts
- "View invoice history" link to `/billing/invoices`

**API:** `GET /billing/upcoming-invoice`

---

#### Trial Banner

**Component:** `TrialBanner`
**File:** `clients/web/src/features/billing/trial-banner.tsx`

**Data displayed:**
- Trial days remaining (e.g. "5 days left in your Pro trial")
- Progress bar showing trial elapsed vs total duration
- "Upgrade now" CTA button

**Behaviour:**
- Only rendered when user is on an active trial (`subscription.status === 'trialing'`)
- Countdown updates daily (not real-time)
- When trial has 3 or fewer days remaining, banner colour changes from blue to amber
- When trial has 1 day remaining, banner colour changes to red
- "Upgrade now" navigates to `/billing/plans` with the current trial plan pre-selected
- Dismissible per session (not persisted — reappears on next visit)
- Not rendered in Phase 1

**API:** Derived from `GET /billing/subscription` (trial end date in response)

---

### 2. Plan Comparison (`/billing/plans`)

Side-by-side comparison of all available plan tiers with feature matrix and upgrade/downgrade actions.

**Component:** `PlanComparisonPage`
**File:** `clients/web/src/features/billing/plan-comparison-page.tsx`

#### Plan Tiers

| Feature | Free | Starter | Pro | League+ |
|---|---|---|---|---|
| Leagues | 1 | 3 | 10 | Unlimited |
| Contests per league | 2 | 10 | 50 | Unlimited |
| Members per league | 12 | 25 | 100 | Unlimited |
| Draft types | Snake only | Snake, Auction | All types | All types |
| Scoring templates | Basic only | Standard set | All templates + custom | All templates + custom |
| Support level | Community | Email | Priority email | Dedicated |
| Data history retention | Current season | 2 seasons | 5 seasons | Unlimited |
| Price | Free | $4.99/mo | $9.99/mo | $19.99/mo |

#### Plan Comparison Table

**Component:** `PlanComparisonTable`
**File:** `clients/web/src/features/billing/plan-comparison-table.tsx`

**Sub-components:**
- `PlanColumn` — vertical column for each tier, highlighted if current plan
- `FeatureRow` — horizontal row for each feature with per-tier values
- `PlanCTA` — call-to-action button at the bottom of each column

**Data displayed:**
- Plan name and price at top of each column
- Feature rows with values or check/cross icons
- Current plan column highlighted with a border and "Current Plan" badge
- CTA button per column: "Current Plan" (disabled), "Upgrade", "Downgrade", or "Get Started"

**Behaviour:**
- Current plan column has a highlighted border (primary colour) and "Current Plan" badge
- Upgrade CTAs open the `PlanChangeDialog` modal
- Downgrade CTAs open the `PlanChangeDialog` modal with downgrade warnings
- Free plan column shows "Current Plan" for free users, no CTA for paid users
- On mobile: horizontal scroll with sticky first column (feature names), or accordion per plan
- Phase 1: all CTAs show "Coming Soon" tooltip and are disabled except Free tier

**API:** `GET /billing/plans` (returns available plans with features and pricing)

---

#### Billing FAQ

**Component:** `BillingFAQ`
**File:** `clients/web/src/features/billing/billing-faq.tsx`

**FAQ items (accordion):**
- "How does billing work?" — Monthly or annual billing cycles, charged on the same day each month.
- "Can I cancel anytime?" — Yes, cancellation takes effect at the end of the current billing period. No partial refunds.
- "What happens if I downgrade?" — Downgrade takes effect at the end of the current billing period. Features above the new tier limit become read-only.
- "How does proration work?" — When upgrading mid-cycle, you pay the prorated difference. When downgrading, credit is applied to the next invoice.
- "Do you offer annual billing?" — Yes, annual billing offers a 20% discount. Switch anytime from the plan change dialog.

**Behaviour:**
- Rendered as a shadcn/ui `Accordion` component with `type="multiple"`
- Placed below the plan comparison table
- Each item expands/collapses independently

---

### 3. Invoice History (`/billing/invoices`)

Searchable, filterable table of past invoices with download capability.

**Component:** `InvoiceHistoryPage`
**File:** `clients/web/src/features/billing/invoice-history-page.tsx`

#### Invoice Table

**Component:** `InvoiceTable`
**File:** `clients/web/src/features/billing/invoice-table.tsx`

**Sub-components:**
- `InvoiceRow` — single invoice row with all fields
- `StatusBadge` — coloured badge for invoice status
- `DownloadButton` — PDF download link

**Columns:**
- Date (formatted as "Mar 26, 2026")
- Invoice number (e.g. "INV-2026-0042")
- Amount (e.g. "$9.99")
- Status badge: Paid (green), Pending (amber), Failed (red)
- PDF download button (icon button, downloads invoice PDF)

**Filters:**
- Date range picker (start date, end date) using shadcn/ui `DatePicker`
- Status dropdown: All, Paid, Pending, Failed

**Behaviour:**
- Paginated (20 per page) with "Load more" or pagination controls
- Sorted by date descending (most recent first)
- Filters applied as query parameters: `GET /billing/invoices?from=2026-01-01&to=2026-03-26&status=paid`
- PDF download via `GET /billing/invoices/:invoiceId/pdf` (opens in new tab or triggers download)
- Empty state: "No invoices yet" with explanation that invoices appear after the first paid billing cycle
- Hidden entirely on Free tier and in Phase 1

**API:** `GET /billing/invoices`

---

### 4. Plan Change Flow (Modal)

Modal-based flow for upgrading, downgrading, or cancelling a subscription. Triggered from the plan comparison page or the billing overview.

#### Plan Change Dialog

**Component:** `PlanChangeDialog`
**File:** `clients/web/src/features/billing/plan-change-dialog.tsx`

**Props:**
- `currentPlan` — user's current plan
- `targetPlan` — plan the user wants to switch to
- `changeType` — `'upgrade' | 'downgrade' | 'cancel'`

**Behaviour by change type:**

**Upgrade:**
- Shows target plan name, price, and features gained
- `ProrationPreview` component shows prorated amount for the current billing cycle
- "Confirm Upgrade" button redirects to Stripe Checkout via `POST /billing/checkout-session`
- After successful payment, redirects back to `/billing` with success toast
- Immediate effect: new plan features available right away

**Downgrade:**
- Shows target plan name, price, and features being lost
- `DowngradeWarning` component lists specific impacts (e.g. "3 of your 5 leagues will become read-only")
- Warning explains downgrade takes effect at end of current billing period
- "Confirm Downgrade" button calls `POST /billing/subscription/change`
- Confirmation toast: "Your plan will change to {plan} on {date}"

**Cancel:**
- Shows `CancelConfirmation` component with retention offer (e.g. "Stay on Starter for 50% off for 3 months")
- Lists what the user will lose access to
- Explains cancellation takes effect at end of current billing period
- "Accept Offer" button applies retention discount
- "Cancel Anyway" button calls `DELETE /billing/subscription`
- Confirmation toast: "Your subscription will end on {date}"

**Sub-components:**

**`ProrationPreview`** (`clients/web/src/features/billing/proration-preview.tsx`)
- Shows current plan remaining credit
- Shows new plan prorated charge
- Shows net amount due today
- Data from `POST /billing/preview-proration`

**`DowngradeWarning`** (`clients/web/src/features/billing/downgrade-warning.tsx`)
- Lists features being lost with red cross icons
- Lists specific resource impacts (e.g. leagues/contests that exceed new limits)
- Checkbox: "I understand that features above my new plan limits will become read-only"
- Confirm button disabled until checkbox is checked

**`CancelConfirmation`** (`clients/web/src/features/billing/cancel-confirmation.tsx`)
- Retention offer card (if available from API)
- "Reasons for leaving" optional radio group (feedback collection)
- Two-button footer: "Accept Offer" (primary) and "Cancel Anyway" (destructive variant)

---

## Data Requirements

### API Endpoints

| Endpoint | Method | Purpose | Phase |
|---|---|---|---|
| `GET /billing/subscription` | GET | Current subscription details (plan, status, trial info, renewal date) | 1 (returns free plan) |
| `GET /billing/usage` | GET | Usage counts against plan limits | 1 |
| `GET /billing/plans` | GET | Available plans with features and pricing | 1 (static data) |
| `GET /billing/payment-method` | GET | Card on file details | 2 |
| `GET /billing/upcoming-invoice` | GET | Next invoice preview with proration | 2 |
| `GET /billing/invoices` | GET | Paginated invoice history with filters | 2 |
| `GET /billing/invoices/:id/pdf` | GET | Download invoice PDF | 2 |
| `POST /billing/checkout-session` | POST | Create Stripe Checkout session for upgrade | 2 |
| `POST /billing/portal-session` | POST | Create Stripe Customer Portal session | 2 |
| `POST /billing/preview-proration` | POST | Preview proration for plan change | 2 |
| `POST /billing/subscription/change` | POST | Change plan (downgrade) | 2 |
| `DELETE /billing/subscription` | DELETE | Cancel subscription | 2 |

### TanStack Query Keys

```typescript
const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
  usage: () => [...billingKeys.all, 'usage'] as const,
  plans: () => [...billingKeys.all, 'plans'] as const,
  paymentMethod: () => [...billingKeys.all, 'payment-method'] as const,
  upcomingInvoice: () => [...billingKeys.all, 'upcoming-invoice'] as const,
  invoices: (filters?: InvoiceFilters) =>
    [...billingKeys.all, 'invoices', filters] as const,
};
```

### Query Configuration

```typescript
// Subscription — rarely changes, long stale time
useQuery({
  queryKey: billingKeys.subscription(),
  queryFn: fetchSubscription,
  staleTime: 5 * 60 * 1000, // 5 minutes
});

// Usage — moderate stale time, refetch on window focus
useQuery({
  queryKey: billingKeys.usage(),
  queryFn: fetchUsage,
  staleTime: 2 * 60 * 1000, // 2 minutes
  refetchOnWindowFocus: true,
});

// Plans — essentially static, very long stale time
useQuery({
  queryKey: billingKeys.plans(),
  queryFn: fetchPlans,
  staleTime: 30 * 60 * 1000, // 30 minutes
});

// Invoices — paginated with filters
useQuery({
  queryKey: billingKeys.invoices({ from, to, status, page }),
  queryFn: () => fetchInvoices({ from, to, status, page }),
  keepPreviousData: true,
});
```

---

## State Management

### Server State (TanStack Query)

All billing data is server state managed by TanStack Query. Subscription, usage, plans, invoices, and payment method data are fetched from the API and cached with appropriate stale times.

### Client State (Zustand)

**Store:** `useBillingUIStore`
**File:** `clients/web/src/stores/billing-ui-store.ts`

```typescript
interface BillingUIState {
  planChangeDialogOpen: boolean;
  planChangeTarget: PlanTier | null;
  planChangeType: 'upgrade' | 'downgrade' | 'cancel' | null;
  openPlanChange: (target: PlanTier, type: 'upgrade' | 'downgrade' | 'cancel') => void;
  closePlanChange: () => void;
  trialBannerDismissed: boolean;
  dismissTrialBanner: () => void;
}
```

**Persisted:** `trialBannerDismissed` only, via `sessionStorage` (resets per session).

---

## Entitlement-Gated UI

Several components throughout the app need to check plan entitlements and conditionally render upgrade prompts.

**Component:** `EntitlementGate`
**File:** `clients/web/src/features/billing/entitlement-gate.tsx`

```typescript
interface EntitlementGateProps {
  feature: EntitlementFeature;
  children: React.ReactNode;
  fallback?: React.ReactNode; // defaults to upgrade prompt
}

type EntitlementFeature =
  | 'create-league'
  | 'create-contest'
  | 'draft-type-auction'
  | 'draft-type-salary-cap'
  | 'custom-scoring-template'
  | 'data-history-extended';
```

**Behaviour:**
- Wraps feature-gated UI sections
- If the user's plan includes the feature, renders `children`
- If not, renders `fallback` (defaults to a card with "Upgrade to {required plan} to unlock this feature" and CTA)
- Uses subscription data from TanStack Query cache (no additional API calls)
- In Phase 1 (free-only), all features within the Free tier are available; gated features show "Coming Soon" instead of upgrade prompt

**Hook:** `useEntitlement`
**File:** `clients/web/src/features/billing/hooks/use-entitlement.ts`

```typescript
function useEntitlement(feature: EntitlementFeature): {
  allowed: boolean;
  requiredPlan: PlanTier;
  loading: boolean;
};
```

---

## Interactions

| Interaction | Trigger | Effect |
|---|---|---|
| Click "Change Plan" / "Upgrade" | PlanCard | Navigate to `/billing/plans` |
| Click plan CTA | PlanComparisonTable | Open PlanChangeDialog with selected plan |
| Confirm upgrade | PlanChangeDialog | POST checkout session, redirect to Stripe |
| Confirm downgrade | PlanChangeDialog | POST subscription change, show confirmation toast |
| Confirm cancel | CancelConfirmation | DELETE subscription, show confirmation toast |
| Accept retention offer | CancelConfirmation | POST apply retention offer, close dialog |
| Click "Update" payment | PaymentMethodCard | POST portal session, redirect to Stripe Portal |
| Click invoice PDF | InvoiceTable | Open PDF in new tab |
| Filter invoices | InvoiceHistoryPage | Update query params, refetch with filters |
| Dismiss trial banner | TrialBanner | Set `trialBannerDismissed` in session store |
| Click "Upgrade now" | TrialBanner | Navigate to `/billing/plans` |

---

## Text Wireframe

```
/billing
--------
+----------------------------------------------------------------------+
|  [Logo]  PoolMaster          [Search...]       [Bell 3]  [Avatar v]  |
+----------+-----------------------------------------------------------+
|          |                                                            |
| Dashboard|  Billing & Subscription                                   |
| Leagues  |                                                            |
| Discover |  +-- Trial Banner (conditional) -----------------------+  |
| Settings |  | Your Pro trial ends in 5 days. Upgrade now to keep  |  |
| Billing* |  | all your features.              [Upgrade Now]  [x]  |  |
|          |  +-----------------------------------------------------+  |
|          |                                                            |
|          |  +-- Current Plan ----------+  +-- Payment Method ------+  |
|          |  | FREE            [grey]   |  | (Hidden on Free tier)  |  |
|          |  |                          |  | Visa ending in 4242    |  |
|          |  | Free forever             |  | Expires 12/2027        |  |
|          |  |                          |  |          [Update]      |  |
|          |  | [Upgrade]                |  +------------------------+  |
|          |  +--------------------------+                              |
|          |                                                            |
|          |  +-- Usage Summary -------- ----------------------------+  |
|          |  |                                                      |  |
|          |  | Leagues    [========--]  2 of 3                      |  |
|          |  | Contests   [====------]  5 of 10                    |  |
|          |  | Members    [==========]  12 of 12  ! Limit reached  |  |
|          |  |                                                      |  |
|          |  +------------------------------------------------------+  |
|          |                                                            |
|          |  +-- Next Invoice (hidden on Free) ---------------------+  |
|          |  | Amount: $9.99        Date: Apr 26, 2026              |  |
|          |  | [View invoice history ->]                            |  |
|          |  +------------------------------------------------------+  |
|          |                                                            |
+----------+-----------------------------------------------------------+

/billing/plans
--------------
+----------------------------------------------------------------------+
|  Billing > Plans                                                      |
|                                                                       |
|  Choose the right plan for your league                                |
|                                                                       |
|  +----------+----------+----------+----------+                        |
|  |   Free   | Starter  |   Pro    | League+  |                        |
|  | -------- | -------- | -------- | -------- |                        |
|  |   Free   | $4.99/mo | $9.99/mo |$19.99/mo |                        |
|  | -------- | -------- | -------- | -------- |                        |
|  | 1 league | 3 leagues| 10 league| Unlimitd |                        |
|  | 2 contst | 10 contst| 50 contst| Unlimitd |                        |
|  | 12 membr | 25 membr | 100 membr| Unlimitd |                        |
|  | Snake    | Snake,   | All draft| All draft|                        |
|  |          | Auction  | types    | types    |                        |
|  | Basic    | Standard | All +    | All +    |                        |
|  | scoring  | scoring  | custom   | custom   |                        |
|  | Community| Email    | Priority | Dedicated|                        |
|  | support  | support  | email    | support  |                        |
|  | Current  | 2 seasons| 5 seasons| Unlimitd |                        |
|  | season   |          |          | history  |                        |
|  | -------- | -------- | -------- | -------- |                        |
|  |[Current] |[Upgrade] |[Upgrade] |[Upgrade] |                        |
|  +----------+----------+----------+----------+                        |
|                                                                       |
|  +-- FAQ ---------------------------------------------------------+  |
|  | > How does billing work?                                        |  |
|  | > Can I cancel anytime?                                         |  |
|  | > What happens if I downgrade?                                  |  |
|  | > How does proration work?                                      |  |
|  | > Do you offer annual billing?                                  |  |
|  +----------------------------------------------------------------+  |
|                                                                       |
+----------------------------------------------------------------------+

/billing/invoices
-----------------
+----------------------------------------------------------------------+
|  Billing > Invoices                                                   |
|                                                                       |
|  [Date range: Jan 1 - Mar 26]    [Status: All v]                     |
|                                                                       |
|  +------+----------------+--------+--------+---------+                |
|  | Date | Invoice #      | Amount | Status | Actions |                |
|  +------+----------------+--------+--------+---------+                |
|  | 3/26 | INV-2026-0042  | $9.99  | [Paid] | [PDF]   |                |
|  | 2/26 | INV-2026-0035  | $9.99  | [Paid] | [PDF]   |                |
|  | 1/26 | INV-2026-0021  | $4.99  | [Paid] | [PDF]   |                |
|  | 1/15 | INV-2026-0018  | $5.00  | [Paid] | [PDF]   |                |
|  |      |                |(prorate)|        |         |                |
|  +------+----------------+--------+--------+---------+                |
|                                                                       |
|  [Load more]                                                          |
+----------------------------------------------------------------------+

Plan Change Dialog (modal):
+----------------------------------------------+
|  Upgrade to Pro                         [x]  |
|  ------------------------------------------  |
|  You're upgrading from Starter to Pro.       |
|                                               |
|  New features:                                |
|    + Up to 10 leagues (was 3)                |
|    + All draft types                          |
|    + Custom scoring templates                 |
|    + Priority email support                   |
|                                               |
|  Proration:                                   |
|    Starter credit:  -$2.50                    |
|    Pro charge:      +$9.99                    |
|    Due today:        $7.49                    |
|                                               |
|  [Cancel]              [Confirm Upgrade]      |
+----------------------------------------------+
```

---

## File Structure

```
clients/web/src/
+-- features/billing/
|   +-- billing-overview-page.tsx         # /billing — main billing page
|   +-- plan-comparison-page.tsx          # /billing/plans — tier comparison
|   +-- invoice-history-page.tsx          # /billing/invoices — invoice table
|   +-- plan-card.tsx                     # Current plan display with badge
|   +-- usage-meter.tsx                   # Usage bar per limit (leagues, contests, members)
|   +-- payment-method-card.tsx           # Card on file display + update CTA
|   +-- invoice-preview.tsx              # Next invoice amount and date
|   +-- trial-banner.tsx                  # Trial countdown with upgrade CTA
|   +-- plan-comparison-table.tsx         # Side-by-side plan feature matrix
|   +-- plan-column.tsx                   # Single plan column in comparison
|   +-- feature-row.tsx                   # Single feature row in comparison
|   +-- plan-cta.tsx                      # Upgrade/downgrade/current button per plan
|   +-- billing-faq.tsx                   # FAQ accordion
|   +-- invoice-table.tsx                 # Invoice list with filters
|   +-- invoice-row.tsx                   # Single invoice row
|   +-- status-badge.tsx                  # Paid/pending/failed badge
|   +-- download-button.tsx              # PDF download icon button
|   +-- plan-change-dialog.tsx            # Modal for upgrade/downgrade/cancel
|   +-- proration-preview.tsx             # Proration calculation display
|   +-- downgrade-warning.tsx             # Feature loss warning with checkbox
|   +-- cancel-confirmation.tsx           # Cancellation with retention offer
|   +-- entitlement-gate.tsx              # Conditional render based on plan
|   +-- hooks/
|       +-- use-subscription.ts           # TanStack Query hook for subscription
|       +-- use-usage.ts                  # TanStack Query hook for usage limits
|       +-- use-plans.ts                  # TanStack Query hook for available plans
|       +-- use-payment-method.ts         # TanStack Query hook for card on file
|       +-- use-upcoming-invoice.ts       # TanStack Query hook for next invoice
|       +-- use-invoices.ts              # TanStack Query hook for invoice history
|       +-- use-entitlement.ts            # Entitlement check hook
+-- stores/
    +-- billing-ui-store.ts               # Zustand: dialog state, trial banner dismiss
```

---

## Loading & Error States

| Component | Loading State | Error State | Empty State |
|---|---|---|---|
| PlanCard | Skeleton: plan name and badge placeholder | "Couldn't load plan details" + retry | Shows "Free" (always has a plan) |
| UsageMeter | Skeleton: 3 progress bars with shimmer | "Couldn't load usage data" + retry | Shows 0 of N for all metrics |
| PaymentMethodCard | Skeleton: card icon and digits | "Couldn't load payment info" + retry | "No payment method on file" + add CTA |
| InvoicePreview | Skeleton: amount and date | "Couldn't load invoice preview" + retry | Hidden (no upcoming invoice) |
| TrialBanner | Not shown while loading | Not shown on error | Not shown (no active trial) |
| PlanComparisonTable | Skeleton: 4-column grid with shimmer rows | "Couldn't load plans" + retry | N/A (always has plans) |
| InvoiceTable | Skeleton: 5 table rows with shimmer | "Couldn't load invoices" + retry | "No invoices yet" |
| PlanChangeDialog | Spinner overlay on dialog body | "Something went wrong" + retry in dialog | N/A |

All skeleton screens use the shadcn/ui `Skeleton` component. Error states include a "Try again" button that calls `queryClient.invalidateQueries()` for the relevant query key.

---

## Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| `sm` (< 640px) | Single column. Plan card and usage stacked. Plan comparison switches to accordion (one plan per section). Invoice table becomes card list. |
| `md` (640-1023px) | Single column with wider widgets. Plan comparison shows 2 plans per row. |
| `lg` (1024-1279px) | Two-column layout on billing overview: PlanCard + PaymentMethod side by side, UsageMeter full width below. Plan comparison shows all 4 columns. |
| `xl` (>= 1280px) | Full layout as shown in wireframe. All components at comfortable widths. |

---

## Accessibility

- All plan tier badges have `aria-label` with full tier name (e.g. `aria-label="Current plan: Pro"`)
- Usage meters use `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label`
- Plan comparison table uses proper `<table>` semantics with `<th>` headers for both rows and columns
- PlanChangeDialog uses shadcn/ui `Dialog` with proper focus trap and `aria-describedby`
- Invoice status badges have `aria-label` (e.g. `aria-label="Status: Paid"`) — colour is not the only indicator
- TrialBanner has `role="alert"` for screen reader announcement
- All interactive elements are keyboard accessible with visible focus indicators
- Downgrade confirmation checkbox is properly labelled and associated with its text

---

## Phase 1 Behaviour (Free-Only Launch)

During Phase 1, the billing UI is scaffolded but operates in free-only mode:

- **Billing Overview:** Shows Free plan card and usage meters only. Payment method, invoice preview, and trial banner are hidden.
- **Plan Comparison:** All plans are displayed for visibility. Upgrade CTAs show a "Coming Soon" tooltip and are disabled. Free tier shows "Current Plan".
- **Invoice History:** Page is hidden from navigation (route exists but redirects to `/billing`).
- **Plan Change Dialog:** Not accessible (all CTAs disabled).
- **Entitlement Gate:** Features within Free tier limits render normally. Gated features show "Coming Soon" instead of upgrade prompt.

---

## Action Plan

> **Note:** All billing UI tasks are deferred. The platform launches as free with no SaaS fees or Stripe integration. These tasks will be needed when moving to paid plans (see backend Plan 07 for the tier model and Stripe integration roadmap). The `EntitlementGate` component (W-B-009) was already built in `features/leagues/entitlement-gate.tsx` — it passes all checks on the free tier and is ready to enforce limits when billing is enabled.

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-B-001 | 1 | Billing overview page — page shell, route setup, responsive layout with conditional section visibility based on plan tier | Done | Full billing dashboard with free-tier banner, current plan card, usage meters, conditional payment/invoice sections |
| W-B-002 | 1 | Plan card component — current plan display with tier badge, plan name, renewal date, price, and upgrade/change CTA | Done | Reusable PlanCard in features/billing/plan-card.tsx with tier badges, pricing, feature list, and CTA logic |
| W-B-003 | 1 | Usage meter component — progress bars for leagues, contests, and members against plan limits with colour thresholds | Done | UsageMeter in features/billing/usage-meter.tsx with green/amber/red thresholds and unlimited mode |
| W-B-004 | 1 | Plan comparison table — side-by-side tier matrix with feature rows, current plan highlight, responsive accordion on mobile | Done | Plan comparison page with 4-tier grid, billing cycle toggle, FAQ accordion |
| W-B-005 | 2 | Plan change flow — PlanChangeDialog modal with upgrade (Stripe Checkout redirect), downgrade (warnings + confirmation), and cancel (retention offer) paths | Deferred | Depends on 07-xxx (Stripe integration) |
| W-B-006 | 2 | Invoice history table — paginated table with date/status filters, status badges, PDF download links | In Progress | Invoice history page has the table shell, status badges, and free-tier empty state, but the PDF/download path is still a placeholder until real invoice storage and sync exist |
| W-B-007 | 2 | Payment method management — card on file display, update button redirecting to Stripe Customer Portal | In Progress | Payment method card is wired into the billing overview shell and hidden when billing is disabled or free tier, but the Stripe Customer Portal flow is still not provider-backed end to end |
| W-B-008 | 2 | Trial banner + countdown — conditional banner with days remaining, colour urgency progression, session-dismissible | Deferred | Depends on 07-xxx (trial status in subscription API) |
| W-B-009 | 1 | Entitlement-gated UI components — EntitlementGate wrapper, useEntitlement hook, "Coming Soon" fallback for Phase 1 | Done | Built in features/leagues/entitlement-gate.tsx — free tier always passes |

---

*PoolMaster Billing & Subscription Page Plan v1.1*
