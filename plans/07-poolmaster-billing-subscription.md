# PoolMaster — Platform Billing & Subscription Management Plan

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

This document defines the monetisation engine for PoolMaster as a multi-tenant SaaS platform. The billing system manages plan tiers, entitlements, Stripe integration, subscription lifecycle, and revenue analytics. Every feature in the platform that is plan-gated depends on the entitlement service designed here. This system handles **platform subscription billing** (tenant pays PoolMaster) — it is entirely separate from **member entry fees and prize pools** (member-to-member money within a league).

---

## 1. Plan Tiers

> **Launch Strategy:** The platform launches as **fully free**. The tier structure below is retained primarily for future packaging and for marketing surfaces that say paid tiers are "coming soon." Operational billing, Stripe lifecycle management, and monetisation enforcement are deferred until after the core web/service product is mature.

## Current MVP Interpretation

Active MVP billing scope is intentionally small:

- keep free access working
- keep future plan/tier copy available for marketing or signup messaging
- avoid shipping paid-plan operational complexity in the first reviewable product

Treat subscription lifecycle, invoices, dunning, proration, and revenue analytics as deferred follow-up work even if partial contracts or scaffolding exist.

### Tier Structure

| Feature | Free (Launch) | Starter ($9/mo) | Pro ($29/mo) | League+ ($79/mo) |
|---|---|---|---|---|
| Leagues | **Unlimited** | 3 | 10 | Unlimited |
| Members per league | **Unlimited** | 20 | 50 | 100 |
| Contests per season | **Unlimited** | 10 | Unlimited | Unlimited |
| Sports available | **All sports** | Golf, NFL | All sports | All sports |
| Draft types | **All types** | Snake, Tiered | All types | All types |
| Draft modes | **All modes** | Async + Live | Async + Live | Async + Live |
| Real-time leaderboard | **✓** | ✓ | ✓ | ✓ |
| Scoring templates | **Full custom** | Standard + Custom | Full custom | Full custom |
| History depth | **Unlimited** | 2 seasons | 5 seasons | Unlimited |
| Analytics (luck/power) | **Full** | Basic | Full | Full |
| Custom branding | **✗** | ✗ | Logo only | Full white-label |
| Intermediate prizes | **✓** | ✗ | ✓ | ✓ |
| API access | **✓** | ✗ | ✗ | ✓ |
| Priority support | **Community** | Email | Email + Chat | Dedicated |

### Pricing

```typescript
interface PlanTier {
  id: string;
  name: string;
  slug: string;                        // "free", "starter", "pro", "league_plus"
  display_order: number;
  monthly_price_cents: number;         // 0, 900, 2900, 7900
  annual_price_cents: number;          // 0, 8600, 27800, 75600 (≈10% discount)
  trial_days: number;                  // 0 for free, 14 for paid tiers
  stripe_monthly_price_id: string;     // Stripe Price ID
  stripe_annual_price_id: string;
  entitlements: PlanEntitlements;
  is_public: boolean;                  // false for enterprise/custom
  created_at: Date;
  updated_at: Date;
}

interface PlanEntitlements {
  max_leagues: number;                 // -1 = unlimited
  max_members_per_league: number;      // -1 = unlimited
  max_contests_per_season: number;     // -1 = unlimited
  allowed_sports: Sport[] | 'ALL';
  allowed_draft_types: DraftType[] | 'ALL';
  allowed_draft_modes: DraftMode[] | 'ALL';
  real_time_leaderboard: boolean;
  custom_scoring: boolean;
  history_seasons: number;             // -1 = unlimited
  analytics_tier: 'NONE' | 'BASIC' | 'FULL';
  branding: 'NONE' | 'LOGO' | 'FULL';
  intermediate_prizes: boolean;
  api_access: boolean;
  support_tier: 'COMMUNITY' | 'EMAIL' | 'EMAIL_CHAT' | 'DEDICATED';
}

// Launch Free tier — everything unlocked, no limits
const FREE_LAUNCH_ENTITLEMENTS: PlanEntitlements = {
  max_leagues: -1,
  max_members_per_league: -1,
  max_contests_per_season: -1,
  allowed_sports: 'ALL',
  allowed_draft_types: 'ALL',
  allowed_draft_modes: 'ALL',
  real_time_leaderboard: true,
  custom_scoring: true,
  history_seasons: -1,
  analytics_tier: 'FULL',
  branding: 'NONE',
  intermediate_prizes: true,
  api_access: true,
  support_tier: 'COMMUNITY',
};
```

---

## 2. Entitlement Service

The entitlement service is the single source of truth for "can this tenant do X?" Every service queries it instead of checking plan tier directly. This decouples feature access from billing logic.

### Entitlement Interface

```typescript
interface EntitlementService {
  // Core check — used in middleware and service logic
  check(tenantId: string, entitlement: EntitlementKey): Promise<EntitlementResult>;

  // Batch check — for UI rendering (show/hide features)
  checkMultiple(tenantId: string, entitlements: EntitlementKey[]): Promise<EntitlementResult[]>;

  // Usage queries — for limit enforcement
  getUsage(tenantId: string, resource: UsageResource): Promise<UsageResult>;

  // Admin overrides
  setOverride(tenantId: string, entitlement: EntitlementKey, value: any, reason: string): Promise<void>;
  clearOverride(tenantId: string, entitlement: EntitlementKey): Promise<void>;
}

type EntitlementKey =
  | 'league.create'
  | 'league.member.add'
  | 'contest.create'
  | 'sport.access'
  | 'draft.type'
  | 'draft.mode'
  | 'leaderboard.realtime'
  | 'scoring.custom'
  | 'history.access'
  | 'analytics.access'
  | 'branding.custom'
  | 'prizes.intermediate'
  | 'api.access';

interface EntitlementResult {
  entitled: boolean;
  reason?: string;                     // "Plan limit reached: 3/3 leagues"
  current_usage?: number;
  limit?: number;
  upgrade_plan?: string;               // slug of the plan that unlocks this
}

type UsageResource = 'LEAGUES' | 'MEMBERS' | 'CONTESTS';

interface UsageResult {
  resource: UsageResource;
  current: number;
  limit: number;                       // -1 = unlimited
  percentage: number;                  // 0-100
}
```

### Entitlement Resolution Order

```
1. Check admin override for this tenant + entitlement
   → If override exists, return override value
2. Check feature flag override (for beta features)
   → If flag exists, return flag value
3. Look up tenant's current plan tier
4. Read entitlement from plan tier definition
5. For usage-limited entitlements, count current usage
6. Return entitled = (usage < limit)
```

### Middleware Integration

```typescript
// Fastify preHandler hook — attach to any route that needs entitlement checking
async function requireEntitlement(
  entitlement: EntitlementKey,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = request.tenantContext.tenantId;
  const result = await entitlementService.check(tenantId, entitlement);

  if (!result.entitled) {
    return reply.status(403).send({
      error: 'PLAN_LIMIT_REACHED',
      message: result.reason,
      upgrade_plan: result.upgrade_plan,
      current_usage: result.current_usage,
      limit: result.limit,
    });
  }
}

// Usage
fastify.post('/leagues', {
  preHandler: (req, reply) => requireEntitlement('league.create', req, reply),
  handler: leagueController.create,
});
```

---

## 3. Stripe Integration

### Subscription Lifecycle

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  TRIAL   │───▶│  ACTIVE  │───▶│  PAST    │───▶│ CANCELLED│
│          │    │          │    │  DUE     │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │
     │               │               ▼
     │               │          ┌──────────┐
     │               │          │ UNPAID   │
     │               │          │ (grace)  │
     │               │          └──────────┘
     │               │               │
     │               ▼               ▼
     │          ┌──────────┐    ┌──────────┐
     └─────────▶│ CANCELLED│    │ CANCELLED│
                │ (no card)│    │ (dunning)│
                └──────────┘    └──────────┘
```

### Subscription Model

```typescript
interface TenantSubscription {
  id: string;
  tenant_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan_tier_id: string;
  billing_cycle: 'MONTHLY' | 'ANNUAL';
  status: SubscriptionStatus;

  // Dates
  trial_start?: Date;
  trial_end?: Date;
  current_period_start: Date;
  current_period_end: Date;
  cancelled_at?: Date;
  cancel_at_period_end: boolean;       // true = cancel at end of billing period

  // Payment
  payment_method_last4?: string;
  payment_method_brand?: string;       // "visa", "mastercard"
  next_invoice_amount_cents?: number;
  currency: string;                    // "usd"

  created_at: Date;
  updated_at: Date;
}

type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'CANCELLED'
  | 'INCOMPLETE'
  | 'PAUSED';
```

### Stripe Service

```typescript
interface StripeService {
  // Customer management
  createCustomer(tenant: Tenant, admin: User): Promise<string>;

  // Subscription CRUD
  createSubscription(tenantId: string, planId: string, cycle: 'MONTHLY' | 'ANNUAL'): Promise<TenantSubscription>;
  changePlan(tenantId: string, newPlanId: string): Promise<TenantSubscription>;
  cancelSubscription(tenantId: string, immediate: boolean): Promise<TenantSubscription>;
  resumeSubscription(tenantId: string): Promise<TenantSubscription>;

  // Payment methods
  createSetupIntent(tenantId: string): Promise<string>;  // client secret for Stripe Elements
  setDefaultPaymentMethod(tenantId: string, paymentMethodId: string): Promise<void>;

  // Billing portal
  createPortalSession(tenantId: string): Promise<string>;  // URL to Stripe Customer Portal

  // Invoices
  getUpcomingInvoice(tenantId: string): Promise<Invoice>;
  getInvoiceHistory(tenantId: string): Promise<Invoice[]>;
}
```

### Stripe Webhook Handler

```typescript
// POST /api/v1/internal/webhooks/stripe
// Stripe signs webhooks — verify signature before processing

const HANDLED_EVENTS = {
  'customer.subscription.created': handleSubscriptionCreated,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'customer.subscription.trial_will_end': handleTrialEnding,
  'invoice.payment_succeeded': handlePaymentSuccess,
  'invoice.payment_failed': handlePaymentFailed,
  'invoice.finalized': handleInvoiceFinalized,
  'payment_method.attached': handlePaymentMethodAttached,
  'payment_method.detached': handlePaymentMethodDetached,
};

async function handlePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const tenantId = await getTenantByStripeCustomer(invoice.customer);

  // Update subscription status
  await updateSubscriptionStatus(tenantId, 'PAST_DUE');

  // Notify tenant admin
  await notificationService.send({
    type: 'PAYMENT_FAILED',
    tenant_id: tenantId,
    recipients: 'TENANT_ADMINS',
    data: {
      amount: invoice.amount_due,
      next_retry: invoice.next_payment_attempt,
    },
  });
}
```

---

## 4. Plan Changes (Upgrade / Downgrade)

### Upgrade Flow

```
1. Tenant admin selects new (higher) plan
2. UI shows prorated cost for remainder of current billing period
3. On confirmation:
   a. Stripe updates subscription with proration
   b. Webhook fires → update local subscription record
   c. Entitlement cache invalidated → new features available immediately
   d. Confirmation email sent
4. New features are available instantly upon payment confirmation
```

### Downgrade Flow

```
1. Tenant admin selects new (lower) plan
2. UI shows:
   - Features they will lose
   - Current usage that exceeds new plan limits (e.g. "You have 5 leagues; Starter allows 3")
   - Effective date (end of current billing period)
3. If current usage exceeds new plan limits:
   - Tenant must reduce usage before downgrade takes effect
   - OR: system applies graceful degradation (existing resources remain but no new ones)
4. On confirmation:
   a. Stripe schedules plan change at period end (no immediate proration)
   b. Local record updated with pending_plan_change
   c. At period end: entitlements switch, excess resources enter read-only mode
```

### Graceful Degradation

When a downgrade causes usage to exceed limits, existing resources are not deleted:

```typescript
interface DegradationPolicy {
  // Leagues over limit: oldest leagues become read-only (no new contests)
  leagues: 'READ_ONLY_OLDEST';

  // Members over limit: no new invites; existing members retain access
  members: 'NO_NEW_INVITES';

  // Contests over limit: active contests continue; no new contests
  contests: 'NO_NEW_CREATION';

  // Features removed: features stop working but data is preserved
  features: 'FEATURE_DISABLED_DATA_PRESERVED';
}
```

---

## 5. Trial & Conversion

### Trial Configuration

```typescript
interface TrialConfig {
  duration_days: 14;
  plan_during_trial: 'PRO';           // trial gives full Pro experience
  require_payment_method: false;       // no card required to start trial
  remind_before_end_days: [3, 1];     // send reminder 3 days and 1 day before
  conversion_offer?: {
    discount_percent: 20;
    discount_duration_months: 3;       // 20% off first 3 months
    coupon_code: string;               // Stripe coupon
  };
}
```

### Trial Flow

```
Day 0:   Tenant signs up → trial starts → full Pro features
Day 11:  Email: "Your trial ends in 3 days" + feature summary + upgrade CTA
Day 13:  Email: "Your trial ends tomorrow" + conversion offer
Day 14:  Trial expires:
         - If payment method on file + plan selected: convert to paid
         - If no payment method: downgrade to Free plan
         - All data preserved, features restricted per Free tier
Day 21:  Email: "We miss you" + conversion offer (if not converted)
Day 30:  Final email: "Last chance" + extended offer
```

---

## 6. Dunning (Failed Payment Recovery)

### Retry Schedule

```typescript
interface DunningConfig {
  retry_attempts: [
    { days_after_failure: 1, action: 'RETRY_PAYMENT' },
    { days_after_failure: 3, action: 'RETRY_PAYMENT' },
    { days_after_failure: 5, action: 'RETRY_PAYMENT' },
    { days_after_failure: 7, action: 'RETRY_PAYMENT' },
  ];
  grace_period_days: 7;               // full access during grace period
  degraded_period_days: 14;           // read-only access after grace
  cancellation_days: 21;              // auto-cancel after 21 days unpaid
}
```

### Dunning Communication

```
Day 0:  Payment fails → email: "Payment failed, we'll retry" + update payment CTA
Day 1:  First retry (automatic via Stripe)
Day 3:  Second retry + email: "Still having trouble"
Day 5:  Third retry + email: "Action needed — update payment method"
Day 7:  Fourth retry + enter degraded mode + email: "Features restricted"
        → In-app banner: "Your payment is past due. Update your payment method."
Day 14: Email: "Final warning — account will be cancelled in 7 days"
Day 21: Auto-cancel + email: "Account cancelled — you can reactivate anytime"
```

---

## 7. Commissioner vs Tenant Billing Separation

### Platform Subscription (This System)

- **Who pays:** Tenant admin (the organisation that owns the PoolMaster account)
- **What they pay for:** Access to platform features, number of leagues, member limits, analytics
- **Payment method:** Credit card via Stripe
- **Billing relationship:** Tenant ↔ PoolMaster

### Entry Fees & Prize Pools (NOT This System)

- **Who pays:** Individual league members
- **What they pay for:** Buy-in to a specific contest within a league
- **Payment method:** Handled externally (Venmo, PayPal, cash) OR optionally through a future payments feature
- **Billing relationship:** Member ↔ Commissioner (PoolMaster is not in the money flow)

```
IMPORTANT: PoolMaster v1 does NOT handle member entry fee collection or prize pool
disbursement. The platform tracks entry fee configuration and payout calculations,
but actual money movement between members happens outside the platform.

Future consideration: integrate Stripe Connect to enable in-platform entry fee
collection and prize disbursement, with PoolMaster as the platform (taking a
processing fee). This requires additional legal/regulatory planning.
```

---

## 8. Self-Service Billing Portal

### Portal Features

```typescript
interface BillingPortal {
  // Current plan
  currentPlan: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  nextBillingDate: Date;
  nextInvoiceAmount: number;

  // Actions
  changePlan(newPlanId: string): Promise<void>;
  switchBillingCycle(cycle: 'MONTHLY' | 'ANNUAL'): Promise<void>;
  cancelSubscription(reason: string, feedback?: string): Promise<void>;
  resumeSubscription(): Promise<void>;

  // Payment
  updatePaymentMethod(): Promise<string>;  // Stripe Elements setup intent
  viewInvoiceHistory(): Promise<Invoice[]>;
  downloadInvoice(invoiceId: string): Promise<string>;  // PDF URL

  // Usage
  viewUsageDashboard(): Promise<UsageSummary>;
}

interface UsageSummary {
  leagues: { current: number; limit: number };
  members_total: { current: number; limit_per_league: number };
  contests_this_season: { current: number; limit: number };
  sports_used: Sport[];
  storage_used_mb?: number;
}
```

### Cancellation Flow

```
1. Tenant admin clicks "Cancel subscription"
2. Show what they'll lose: feature comparison Free vs current plan
3. Show current usage that exceeds Free limits
4. Optional: offer a discount to retain ("Stay on Pro for 50% off for 3 months?")
5. Collect cancellation reason (dropdown + free text)
6. Confirm: cancel at end of billing period (not immediate)
7. Features remain until period end
8. Data preserved for 90 days after cancellation (can reactivate)
9. After 90 days: data anonymised per retention policy
```

---

## 9. Enterprise & Custom Plans

For large tenants (corporate leagues, media companies, large fantasy communities):

```typescript
interface EnterprisePlan {
  tenant_id: string;
  custom_name: string;                 // "Acme Corp Enterprise"
  base_plan: 'LEAGUE_PLUS';           // starts from highest public tier
  custom_entitlements: Partial<PlanEntitlements>;  // overrides
  custom_monthly_price_cents: number;
  billing_method: 'STRIPE' | 'INVOICE' | 'CONTRACT';
  contract_start: Date;
  contract_end: Date;
  sla_tier: 'STANDARD' | 'PREMIUM';
  white_label: boolean;
  dedicated_support_contact?: string;
  notes: string;
}
```

Enterprise plans are managed manually by PoolMaster's sales/support team via the admin dashboard. They can override any entitlement without code changes.

---

## 10. Revenue Analytics (Internal)

### Metrics Dashboard

```typescript
interface RevenueMetrics {
  // Core SaaS metrics
  mrr: number;                         // Monthly Recurring Revenue
  arr: number;                         // Annual Recurring Revenue
  mrr_growth_rate: number;             // month-over-month % change

  // Subscriber metrics
  total_subscribers: number;
  subscribers_by_plan: Record<string, number>;
  new_subscribers_this_month: number;
  churned_subscribers_this_month: number;
  churn_rate: number;                  // monthly churn %
  net_revenue_retention: number;       // % (>100% means expansion > churn)

  // Trial metrics
  active_trials: number;
  trial_conversion_rate: number;       // % of trials that convert to paid
  avg_trial_to_paid_days: number;

  // Revenue per tier
  revenue_by_plan: Record<string, number>;
  arpu: number;                        // Average Revenue Per User

  // Dunning
  past_due_subscriptions: number;
  recovery_rate: number;               // % of failed payments recovered
  revenue_at_risk: number;             // MRR from past-due subscriptions
}
```

### Data Sources

- Stripe reporting API for payment data
- Local subscription records for plan distribution
- Stripe webhooks for real-time event tracking
- Computed daily via a scheduled analytics job

---

## 11. Database Schema

```sql
-- Plan tier definitions
CREATE TABLE plan_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL UNIQUE,
  display_order INTEGER NOT NULL,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  annual_price_cents INTEGER NOT NULL DEFAULT 0,
  trial_days INTEGER NOT NULL DEFAULT 0,
  stripe_monthly_price_id VARCHAR(255),
  stripe_annual_price_id VARCHAR(255),
  entitlements JSONB NOT NULL,
  is_public BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant subscriptions
CREATE TABLE tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id),
  stripe_customer_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255),
  plan_tier_id UUID NOT NULL REFERENCES plan_tiers(id),
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
  status VARCHAR(50) NOT NULL DEFAULT 'TRIALING',
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  pending_plan_change_id UUID REFERENCES plan_tiers(id),
  payment_method_last4 VARCHAR(4),
  payment_method_brand VARCHAR(50),
  currency VARCHAR(3) DEFAULT 'usd',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Entitlement overrides (admin-set per tenant)
CREATE TABLE entitlement_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entitlement_key VARCHAR(100) NOT NULL,
  override_value JSONB NOT NULL,
  reason VARCHAR(500),
  set_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, entitlement_key)
);

-- Invoice records (synced from Stripe for local queries)
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  stripe_invoice_id VARCHAR(255) NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'usd',
  status VARCHAR(50) NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  invoice_pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage tracking
CREATE TABLE tenant_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  resource VARCHAR(50) NOT NULL,           -- 'LEAGUES', 'CONTESTS', etc.
  current_count INTEGER NOT NULL DEFAULT 0,
  counted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, resource)
);

-- Cancellation feedback
CREATE TABLE cancellation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  reason VARCHAR(100) NOT NULL,
  feedback TEXT,
  plan_at_cancellation VARCHAR(50),
  months_subscribed INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_status ON tenant_subscriptions(status);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id, created_at);
CREATE INDEX idx_usage_tenant ON tenant_usage(tenant_id);
```

---

## 12. Implementation Phases

### Phase 1 — Free Launch (No Limits)
- Plan tier definitions in database (seed Free tier with unlimited entitlements)
- Entitlement service with plan-based resolution (all checks pass for Free)
- Entitlement middleware wired to API routes (ready for future gating)
- All features available to all tenants — no paywalls

### Phase 2 — Entitlement Infrastructure (Deferred)
- Usage tracking tables and counting logic
- Tighten Free tier limits when ready to monetise
- Add paid tier seed data (Starter, Pro, League+)
- Entitlement override tooling for admin

### Phase 3 — Stripe Integration (Deferred)
- Stripe customer creation on tenant signup
- Subscription creation for paid plans
- Webhook handler for subscription events
- Payment method management (Stripe Elements)
- Trial start and conversion flow

### Phase 4 — Self-Service Portal (Deferred)
- Billing portal UI (current plan, invoices, payment method)
- Plan change flow (upgrade with proration, downgrade at period end)
- Cancellation flow with retention offer
- Invoice history and PDF download

### Phase 5 — Dunning, Analytics & Enterprise (Deferred)
- Failed payment webhook handling and retry schedule
- Grace period and feature degradation logic
- Revenue metrics dashboard (MRR, ARR, churn, conversion)
- Trial conversion tracking
- Enterprise plan management in admin dashboard

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 07-001 | 1 | `plan_tiers` table + seed Free tier (unlimited entitlements) | Done | PlanTier model in schema.prisma; seed.ts with Free, Starter, Pro, League+ (paid tiers isPublic=false) |
| 07-002 | 1 | `PlanEntitlements` Zod schema + TypeScript type | Done | packages/shared/domain/entitlements.ts — PlanEntitlementsSchema, EntitlementKey, EntitlementResult, UsageResource, UsageResult; exported from domain/index.ts |
| 07-003 | 1 | EntitlementService — `check()` and `checkMultiple()` (all pass for Free) | Done | packages/core-api/src/modules/billing/entitlement-service.ts — check(), checkMultiple(), getUsage() with 5-min in-memory cache |
| 07-004 | 1 | Entitlement resolution order (override → flag → plan → usage) | Done | Implemented in EntitlementService.check() — steps 1-2 are stubs (fall through), step 3 loads tier, step 4 evaluates usage/boolean/list/tier keys |
| 07-005 | 1 | Fastify entitlement preHandler hook for routes | Done | packages/core-api/src/plugins/entitlement-guard.ts — requireEntitlement() factory returns preHandler hook |
| 07-006 | 1 | Auto-assign Free tier on tenant creation | Done | Auth service already sets planTier='free'; billing routes at /api/v1/billing (plan, entitlements, usage, plans) registered in index.ts |
| 07-007 | 2 | `tenant_usage` table + usage counting | Done | TenantUsage Prisma model; usage-service.ts with trackUsage/getUsage/refreshAllUsage, all gated by billing_enabled flag |
| 07-008 | 2 | Tighten Free tier limits + add paid tier seed data | Done | Free tier: 50 leagues, 100 members, 100 contests; all paid tiers isPublic=true for plan comparison |
| 07-009 | 2 | `entitlement_overrides` table + admin tooling | In Progress | EntitlementOverride Prisma model exists in the schema, but the current override store is still in-memory in entitlement-service.ts, so admin overrides should remain marked as non-durable until persistence replaces it |
| 07-010 | 3 | Stripe customer creation on tenant signup | In Progress | MockStripeClient.customers.create() still backs the current flow; ensureCustomer() in subscription-service.ts auto-creates on first subscription, but this remains a fake provider boundary until real Stripe wiring replaces it |
| 07-011 | 3 | `tenant_subscriptions` table + migrations | Done | TenantSubscription Prisma model with all fields from plan SQL schema |
| 07-012 | 3 | Subscription creation for paid plans | In Progress | subscription-service.ts exposes createSubscription, changePlan, cancelSubscription, resumeSubscription, getSubscription; routes exist, but the paid-plan lifecycle is still not backed by a real provider integration and should not be treated as production-complete |
| 07-013 | 3 | Stripe webhook handler (subscription events) | In Progress | webhook-handler.ts exists at POST /api/v1/internal/webhooks/stripe and handles the expected event set, but it should still be described as an integration seam until the provider-backed lifecycle is fully real |
| 07-014 | 3 | Payment method management (Stripe Elements) | In Progress | POST /billing/payment-method and GET /billing/portal exist, but the current note overstates provider backing; keep this marked as in progress until the Stripe Elements and portal flows are verified against real customer state |
| 07-015 | 3 | Trial start and conversion flow (14-day trial) | In Progress | trial-service.ts provides startTrial, checkTrialStatus, convertTrial, getTrialReminders; the trial state exists, but the conversion flow still needs to be treated as follow-up work until it is tied to the real billing lifecycle |
| 07-016 | 4 | Billing portal UI (current plan, invoices, payment method) | In Progress | Backend routes exist for invoices, upgrade/downgrade preview, and cancellation preview in routes.ts; InvoiceService still uses mock data, so the portal should be described as contract-aligned but not provider-backed |
| 07-017 | 4 | Plan upgrade flow (proration) | In Progress | PlanChangeService.previewUpgrade() and GET /upgrade-preview/:planSlug exist, but the proration flow should be treated as preview-only until the real Stripe change path is confirmed |
| 07-018 | 4 | Plan downgrade flow (at period end + graceful degradation) | In Progress | PlanChangeService.previewDowngrade() and applyDegradation() exist with GET /downgrade-preview/:planSlug, but the downgrade lifecycle still needs to stay documented as staged behavior rather than fully settled persistence |
| 07-019 | 4 | Cancellation flow with retention offer | In Progress | CancellationService exposes previewCancellation(), getRetentionOffer(), and cancel(); POST /cancel and GET /retention-offer exist, but the retention/cancellation record should remain described as a follow-up until it is grounded in persisted execution data |
| 07-020 | 4 | Invoice history and PDF download | In Progress | InvoiceService exposes getInvoiceHistory(), getInvoiceDetail(), getInvoicePdfUrl(), and getUpcomingInvoice(), but the current 4-invoice dataset is mock-backed and must stay labeled as unfinished until invoice sync/storage exists |
| 07-021 | 5 | Failed payment webhook handling + retry schedule | In Progress | DunningService.handlePaymentFailure() and processRetries() exist, but the retry/recovery note still describes mock recovery behavior and should remain explicitly non-production until real provider-backed recovery is implemented |
| 07-022 | 5 | Grace period and feature degradation logic | In Progress | DunningService phase resolution exists (GRACE→DEGRADED→PENDING_CANCEL→CANCELLED), but this should be tracked as policy logic only, not as proof that the billing lifecycle is fully persisted |
| 07-023 | 5 | Dunning email sequence + recovery tracking | In Progress | DunningService.processEscalations() and getRecoveryMetrics() exist with GET /dunning/:tenantId, but the tracking remains an implementation slice rather than a completed recovery system |
| 07-024 | 5 | Revenue metrics dashboard (MRR, ARR, churn, conversion) | In Progress | RevenueAnalyticsService.getMetrics() is still driven by realistic mock data (~200 tenants), so the dashboard must be described as illustrative until the metrics are derived from real billing data |
| 07-025 | 5 | Trial conversion tracking | In Progress | RevenueAnalyticsService.getTrialMetrics() exists, but the conversion numbers are still part of the mock analytics layer and should not be framed as persisted truth |
| 07-026 | 5 | Enterprise plan management in admin dashboard | In Progress | EnterpriseService has CRUD operations and GET/POST /enterprise admin routes, but the in-memory store means this is still not durable enterprise plan management |
| 07-027 | 5 | `cancellation_feedback` table + collection flow | In Progress | CancellationService.cancel() collects reason+feedback and listFeedback() exists, but the note must stay honest that this is still an in-memory Map store and the Prisma model is deferred |

---

> **MVP scope note:** Historical implementation rows in this plan do not change the launch decision: PoolMaster ships as a free site first, with paid billing behavior deferred.

*Generated by Claude — PoolMaster Platform Billing & Subscription Management Plan v1.0*
