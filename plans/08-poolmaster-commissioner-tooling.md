# PoolMaster — Commissioner Tooling (Consolidated) Plan

> **Rules:** All technology and infrastructure choices follow [Architecture Rules](../rules/architecture-rules.md). Testing standards follow [Testing Rules](../rules/testing-rules.md).

## Overview

The commissioner is the primary power user of PoolMaster. They create leagues, configure contests, manage members, run drafts, and resolve disputes. Commissioner capabilities are referenced across every other plan but have never been designed as a coherent experience. This plan consolidates all commissioner-facing features into a unified workflow that gets a commissioner from signup to "first contest ready" as fast as possible, and gives them confidence to manage their league throughout the season.

---

## 1. Commissioner Role & Permissions

### Role Hierarchy

```typescript
interface LeagueMembership {
  user_id: string;
  league_id: string;
  role: 'OWNER' | 'COMMISSIONER' | 'MANAGER' | 'VIEWER';
  permissions: CommissionerPermission[];
  joined_at: Date;
}

// OWNER: the league creator. Full permissions. Can transfer ownership.
// COMMISSIONER: delegated admin. Configurable permissions granted by owner.
// MANAGER: regular player. Can draft, view standings, participate.
// VIEWER: read-only. Can view standings and results but not participate.
```

### Granular Commissioner Permissions

```typescript
type CommissionerPermission =
  // League management
  | 'league.settings.edit'
  | 'league.members.invite'
  | 'league.members.remove'
  | 'league.members.role.change'

  // Contest management
  | 'contest.create'
  | 'contest.edit'
  | 'contest.delete'
  | 'contest.close'
  | 'contest.reopen'

  // Draft management
  | 'draft.start'
  | 'draft.pause'
  | 'draft.undo_pick'
  | 'draft.override_pick'
  | 'draft.extend_clock'

  // Scoring & results
  | 'scoring.override'
  | 'scoring.recalculate'
  | 'results.override'
  | 'payout.confirm'
  | 'payout.recalculate'

  // Communication
  | 'announcement.post'
  | 'announcement.pin'
  | 'message.delete'
  | 'member.mute'

  // Templates
  | 'template.create'
  | 'template.share';

// OWNER has all permissions implicitly
// COMMISSIONER gets a configurable subset granted by OWNER
```

---

## 2. League Setup Wizard

A guided multi-step flow for creating a new league. Designed to complete in under 10 minutes.

### Wizard Steps

```
Step 1: League Identity
  ├── League name
  ├── Description (optional)
  ├── League photo/logo (optional, upload or choose from gallery)
  ├── Visibility: PRIVATE (invite only) | PUBLIC (discoverable)
  └── Invite policy: COMMISSIONER_ONLY | LINK_INVITE | OPEN

Step 2: Sports & Seasons
  ├── Select sports this league will use (multi-select)
  ├── For each sport: create or select season (e.g. "2026 PGA Tour Season")
  └── Pre-populate with current/upcoming seasons from sports data

Step 3: Default Rules (Optional — can skip)
  ├── Default scoring template per sport (from template library)
  ├── Default draft type preference
  ├── Default payout structure preference
  └── These become defaults when creating contests; always overridable

Step 4: Invite Members
  ├── Invite by email (one or multiple)
  ├── Generate shareable invite link
  ├── Copy invite link for SMS/messaging apps
  ├── CSV upload for bulk invites
  └── Set maximum member count

Step 5: Review & Create
  ├── Summary of all settings
  ├── [Create League] button
  └── After creation: redirect to commissioner dashboard with "Create First Contest" CTA
```

### League Settings (Post-Creation)

```typescript
interface LeagueSettings {
  league_id: string;

  // Identity
  name: string;
  description?: string;
  photo_url?: string;
  visibility: 'PRIVATE' | 'PUBLIC';
  invite_policy: 'COMMISSIONER_ONLY' | 'LINK_INVITE' | 'OPEN';
  invite_link_code?: string;

  // Membership
  max_members: number;
  allow_mid_season_join: boolean;
  require_approval: boolean;           // for OPEN visibility

  // Defaults
  default_scoring_template_id?: string;
  default_draft_type?: DraftType;
  default_payout_template_id?: string;

  // Communication
  activity_feed_enabled: boolean;
  weekly_recap_enabled: boolean;
  weekly_recap_day: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

  // Display
  timezone: string;                    // IANA timezone for display
  currency: string;                    // for payout display
}
```

---

## 3. Contest Setup Wizard

The most critical commissioner workflow. Creates a fully configured contest ready for drafting.

### Wizard Steps

```
Step 1: Sport & Event
  ├── Select sport
  ├── Select event(s) from upcoming schedule
  │   ├── Single event: "The Masters 2026"
  │   └── Season-long: "2026 PGA Tour Season" (multiple events)
  ├── Contest name (auto-suggested from event: "Masters Pool 2026")
  └── Contest type: SINGLE_EVENT | SEASON_LONG | BRACKET

Step 2: Participant Pool
  ├── Pool type: EVENT_FIELD | RANKING_CUTOFF | CUSTOM
  ├── Preview pool (show participant count, names)
  ├── Add/remove individual participants
  ├── Set participant count limits if needed
  └── For salary cap: preview auto-generated prices

Step 3: Draft Configuration
  ├── Draft type: SNAKE | SALARY_CAP | TIERED
  ├── Draft mode: LIVE | ASYNC
  ├── Number of rounds / roster size
  ├── Time per pick (with sport-appropriate defaults)
  │   ├── Live: 60s (golf), 90s (NFL), 30s (quick)
  │   └── Async: 4h, 8h, 12h, 24h
  ├── Auto-pick policy: BEST_AVAILABLE | BY_RANKING | RANDOM
  ├── For SALARY_CAP: budget, pricing review
  ├── For TIERED: tier configuration, picks per tier
  ├── Draft start time (for LIVE mode)
  └── Exclusive picks toggle (can two teams draft the same player?)

Step 4: Scoring Rules
  ├── Start from template (recommended): show sport-specific templates
  │   ├── "Standard PGA Scoring"
  │   ├── "DraftKings-style Golf"
  │   └── "Custom" (build from scratch)
  ├── Review/customize stat rules, bonuses, penalties
  ├── Counting method: ALL | BEST_N | DROP_LOWEST_N
  ├── Missed event / DNF handling
  └── Preview: show example scoring for a past event using these rules

Step 5: Payouts & Prizes
  ├── Entry fee amount (display only — collected outside platform)
  ├── Prize pool calculation (auto from entry fee × members, or manual)
  ├── Payout structure: select template or custom
  │   ├── "Winner take all"
  │   ├── "Top 3 (60/25/15)"
  │   ├── "Top 5 (40/25/15/12/8)"
  │   └── Custom percentages
  ├── Intermediate prizes (optional)
  │   ├── Daily/round leader
  │   ├── Best individual performer
  │   └── Custom milestone prizes
  └── Tiebreaker chain configuration

Step 6: Schedule & Lock
  ├── When do picks lock? (auto from event start, or custom)
  ├── When does the contest end? (auto from event end, or custom)
  ├── Draft deadline (for async: must complete by this time)
  └── Reminders: 24h, 1h before lock (auto-enabled)

Step 7: Review & Create
  ├── Full configuration summary
  ├── Estimated experience: "8 managers draft 5 golfers each for The Masters"
  ├── [Create Contest] or [Save as Draft]
  └── After creation: share contest with league + "Start Draft" CTA
```

### Contest Quick-Create

For repeat contests (e.g. weekly NFL pool), offer a streamlined path:

```
1. Select a saved template or last week's contest
2. Auto-populate all settings
3. Update event and dates
4. Review → Create
```

---

## 4. Member Management

### Invitation Flow

```typescript
interface InvitationConfig {
  // Email invitations
  sendEmailInvite(emails: string[], league_id: string, message?: string): Promise<Invitation[]>;

  // Link invitations
  generateInviteLink(league_id: string, expires_in_days?: number, max_uses?: number): Promise<string>;
  revokeInviteLink(link_code: string): Promise<void>;

  // Bulk import
  importFromCSV(csv: File, league_id: string): Promise<BulkImportResult>;
}

interface Invitation {
  id: string;
  league_id: string;
  email?: string;
  invite_code: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  invited_by: string;
  expires_at: Date;
  accepted_at?: Date;
  accepted_by?: string;
}

interface BulkImportResult {
  total: number;
  sent: number;
  failed: { email: string; reason: string }[];
  duplicates: string[];                // already members
}
```

### Member Actions

```
Commissioner can:
  ├── View all members with role, join date, last activity
  ├── Invite new members (email, link, CSV)
  ├── Remove a member
  │   ├── If member has active teams: prompt to reassign or vacate
  │   └── Member's history is preserved (anonymised display name optional)
  ├── Change member role (promote to commissioner, demote to viewer)
  ├── Transfer league ownership (OWNER → another member)
  ├── Mute a member (hide from activity feed, block posting)
  ├── Approve/deny join requests (for leagues with require_approval)
  └── View member activity log (picks made, posts, last login)
```

### Team Reassignment

When a member leaves mid-season:

```typescript
interface TeamReassignment {
  contest_id: string;
  original_member_id: string;
  action: 'REASSIGN' | 'VACATE' | 'AUTO_PILOT';
  new_member_id?: string;              // for REASSIGN

  // REASSIGN: new member takes over the team (all drafted picks preserved)
  // VACATE: team is removed; standings recalculated without them
  // AUTO_PILOT: team stays, auto-pick handles any remaining draft picks, no human manages it
}
```

---

## 5. In-Season Override Tools

The safety valve for commissioners when things go wrong during an active contest.

### Draft Overrides

```typescript
interface DraftOverrides {
  // Undo a draft pick (within configurable window)
  undoPick(contest_id: string, pick_id: string, reason: string): Promise<void>;
  // Window: configurable 0-60 minutes after pick. Default: 5 minutes

  // Override a pick (force a different selection)
  overridePick(contest_id: string, pick_id: string, new_participant_id: string, reason: string): Promise<void>;

  // Extend the clock for a specific pick
  extendPickClock(contest_id: string, member_id: string, additional_seconds: number): Promise<void>;

  // Pause/resume the entire draft
  pauseDraft(contest_id: string, reason: string): Promise<void>;
  resumeDraft(contest_id: string): Promise<void>;

  // Reassign a pick slot (member can't make their pick, commissioner picks for them)
  makePickForMember(contest_id: string, member_id: string, participant_id: string, reason: string): Promise<void>;
}
```

### Scoring Overrides

```typescript
interface ScoringOverrides {
  // Manually adjust a team's score (e.g. data provider error)
  adjustScore(contest_id: string, team_id: string, adjustment: number, reason: string): Promise<void>;

  // Override a participant's stat for this contest
  overrideStat(contest_id: string, participant_id: string, stat_key: string, new_value: number, reason: string): Promise<void>;

  // Force recalculate all standings from raw stat data
  recalculateStandings(contest_id: string): Promise<RecalculationResult>;
}

interface RecalculationResult {
  contest_id: string;
  teams_affected: number;
  standings_changed: boolean;
  changes: StandingsChange[];
}

interface StandingsChange {
  team_id: string;
  team_name: string;
  old_rank: number;
  new_rank: number;
  old_score: number;
  new_score: number;
}
```

### Contest Lifecycle Overrides

```typescript
interface ContestOverrides {
  // Re-open a closed contest (e.g. scoring error discovered)
  reopenContest(contest_id: string, reason: string): Promise<void>;
  // Requires: no payouts have been disbursed

  // Force-close a contest early
  closeContest(contest_id: string, reason: string): Promise<void>;
  // Triggers: final standings calculation and payout computation

  // Extend contest deadline
  extendDeadline(contest_id: string, new_end: Date, reason: string): Promise<void>;

  // Modify lock time (before lock occurs)
  updateLockTime(contest_id: string, new_lock: Date, reason: string): Promise<void>;
}
```

### Payout Overrides

```typescript
interface PayoutOverrides {
  // Confirm calculated payouts (required before marking as "paid")
  confirmPayouts(contest_id: string): Promise<void>;

  // Override a specific payout amount
  overridePayout(contest_id: string, team_id: string, new_amount: number, reason: string): Promise<void>;

  // Force recalculate payouts from current standings
  recalculatePayouts(contest_id: string): Promise<PayoutRecalculation>;

  // Mark a payout as paid (commissioner tracks this manually in v1)
  markPaid(contest_id: string, team_id: string): Promise<void>;
}
```

---

## 6. Commissioner Dashboard

A single home screen giving the commissioner a complete picture of their league.

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  League: Tiger's Golf Crew                    [Settings] [Help] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚡ Action Required (3)                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ • Masters Pool draft starts in 2 hours — 3 members       │  │
│  │   haven't set their queue                                │  │
│  │ • John Smith requested to join the league                │  │
│  │ • Weekly NFL Pool payout pending confirmation             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  📊 Active Contests                                             │
│  ┌────────────────────┬──────────┬─────────┬──────────────┐   │
│  │ Contest            │ Status   │ Members │ Next Action  │   │
│  ├────────────────────┼──────────┼─────────┼──────────────┤   │
│  │ Masters Pool 2026  │ Drafting │ 12/12   │ Draft: 2h    │   │
│  │ PGA Season Long    │ Active   │ 12/12   │ Scoring live │   │
│  │ NFL Week 14        │ Complete │ 8/8     │ Confirm pay  │   │
│  └────────────────────┴──────────┴─────────┴──────────────┘   │
│                                                                 │
│  👥 Members (12)                          [Invite] [Manage]    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Recent activity:                                         │  │
│  │ • Alex made pick #24 in Masters Pool (5 min ago)         │  │
│  │ • Sarah joined the league (2 hours ago)                  │  │
│  │ • Mike posted in activity feed (yesterday)               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  📅 Upcoming                                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ • Mar 28: Masters Pool draft starts (LIVE, 7pm ET)       │  │
│  │ • Apr 10: Masters tournament begins                      │  │
│  │ • Apr 14: PGA Heritage — next season-long event          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [+ Create Contest]                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Dashboard Data Model

```typescript
interface CommissionerDashboard {
  league: LeagueSummary;

  // Action items (sorted by urgency)
  action_items: ActionItem[];

  // Active and recent contests
  contests: ContestSummary[];

  // Member overview
  member_count: number;
  pending_invites: number;
  pending_join_requests: number;
  recent_member_activity: ActivityEvent[];

  // Upcoming events
  upcoming_events: UpcomingEvent[];

  // Unread messages in league feed
  unread_messages: number;
}

interface ActionItem {
  id: string;
  type: 'DRAFT_STARTING' | 'PAYOUT_PENDING' | 'JOIN_REQUEST' | 'SCORE_OVERRIDE_NEEDED'
    | 'MEMBER_INACTIVE' | 'CONTEST_ENDING' | 'DATA_ISSUE';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  action_url: string;                  // deep link to resolve
  created_at: Date;
}
```

---

## 7. Contest Template Library

Commissioners can save contest configurations as reusable templates.

### Template Model

```typescript
interface ContestTemplate {
  id: string;
  league_id: string;
  created_by: string;
  name: string;                        // "Our Standard Masters Pool"
  description?: string;
  sport: Sport;
  contest_type: ContestType;

  // Saved configuration (everything except event-specific data)
  draft_config: Partial<DraftConfiguration>;
  scoring_config: Partial<ScoringConfig>;
  payout_config: Partial<PayoutConfig>;
  pool_config: Partial<ContestParticipantPool>;

  // Sharing
  shared_with_tenant: boolean;         // visible to other commissioners in same tenant
  is_platform_template: boolean;       // curated by PoolMaster (read-only)

  // Usage tracking
  times_used: number;
  last_used_at?: Date;

  created_at: Date;
  updated_at: Date;
}
```

### Platform-Provided Templates

PoolMaster ships with curated templates for common contest formats:

```
Golf Templates:
  ├── "Standard Pick 'Em" — snake draft, 5 picks, cumulative scoring
  ├── "DraftKings-style" — salary cap, stat-based scoring
  ├── "Major Championship" — tiered draft, position-based scoring
  └── "Season Long (Best N)" — snake draft, best 15 of 25 events

NFL Templates:
  ├── "Weekly Pick 'Em" — pick winners against the spread
  ├── "Season Fantasy" — salary cap, full stat scoring
  └── "Survivor Pool" — pick one team per week, can't repeat

NCAA Basketball Templates:
  ├── "March Madness Bracket" — bracket format, upset bonuses
  └── "Tournament Pool" — pick teams, scoring by round reached
```

---

## 8. Bulk Operations

### Season Setup (Multi-Contest Creation)

```typescript
interface SeasonBulkSetup {
  league_id: string;
  sport: Sport;
  season: string;
  template_id: string;                 // base template for all contests

  // Generate one contest per event in the season
  events: SportEvent[];                // selected from upcoming schedule
  naming_pattern: string;              // e.g. "{event_name} Pool" → "Masters Pool"

  // Override per-contest (optional)
  per_contest_overrides?: Record<string, Partial<ContestConfig>>;

  // Draft schedule
  draft_schedule: 'SEQUENTIAL' | 'MANUAL';
  // SEQUENTIAL: auto-schedule drafts with gap between events
  // MANUAL: commissioner sets each draft time individually
}
```

### Copy Last Season

```
1. Commissioner selects "Copy from last season"
2. System loads last season's contests for this sport in this league
3. Presents list with checkboxes: which contests to recreate
4. Auto-maps to this season's equivalent events (by event name matching)
5. Pre-fills all configuration from last season's contests
6. Commissioner reviews, adjusts, and creates in bulk
```

### CSV Member Import

```
Format:
  email,display_name,role
  alex@example.com,Alex Smith,MANAGER
  jordan@example.com,Jordan Lee,MANAGER
  pat@example.com,Pat Chen,COMMISSIONER

Processing:
  1. Parse and validate CSV
  2. Check for existing members (skip duplicates)
  3. Check against league member limit (entitlement)
  4. Send invitations to all new emails
  5. Return summary: sent, skipped, errors
```

---

## 9. Commissioner Audit Trail

Every commissioner action is logged with full context.

### Audit Log Schema

```typescript
interface AuditLogEntry {
  id: string;
  league_id: string;
  contest_id?: string;
  actor_id: string;                    // commissioner who took the action
  actor_name: string;
  action: string;                      // e.g. "draft.pick.undo", "scoring.override"
  category: 'LEAGUE' | 'CONTEST' | 'DRAFT' | 'SCORING' | 'PAYOUT' | 'MEMBER' | 'COMMUNICATION';
  description: string;                 // human-readable: "Undid pick #24 (Tiger Woods by Team Alex)"
  before_state?: Record<string, any>;  // state before the action
  after_state?: Record<string, any>;   // state after the action
  reason?: string;                     // commissioner's stated reason
  ip_address?: string;
  timestamp: Date;
}
```

### Audit Log Visibility

- **Commissioner view:** Accessible from league settings. Shows all commissioner actions in this league. Filterable by category, date, actor.
- **Member view:** Members can view a simplified audit trail showing scoring overrides, payout changes, and member role changes — transparency without full admin detail.
- **Platform admin view:** Full audit trail across all leagues for compliance and support.

---

## 10. Commissioner Help & Onboarding

### First-Time Commissioner Experience

```
1. League created → "Welcome, Commissioner!" overlay
2. Guided tour highlights:
   - Dashboard (your home base)
   - Create Contest button
   - Invite Members
   - Settings
3. Checklist widget (persisted until dismissed):
   □ Invite at least 4 members
   □ Create your first contest
   □ Run your first draft
   □ View live standings
4. Contextual tooltips on first use of each feature
```

### Commissioner Help Center

```
In-app help resources:
  ├── "How do I set up a golf pool?" — step-by-step guide
  ├── "What draft type should I choose?" — comparison table
  ├── "How do scoring overrides work?" — with undo safety net
  ├── "Managing payouts" — best practices
  └── "Resolving disputes" — recommended approaches
```

---

## 11. Database Schema (Commissioner-Specific Tables)

```sql
-- Invitations
CREATE TABLE league_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  email VARCHAR(255),
  invite_code VARCHAR(100) NOT NULL UNIQUE,
  invite_type VARCHAR(20) NOT NULL DEFAULT 'EMAIL',  -- EMAIL, LINK
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  max_uses INTEGER DEFAULT 1,
  current_uses INTEGER DEFAULT 0,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contest templates
CREATE TABLE contest_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  created_by UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sport VARCHAR(50) NOT NULL,
  contest_type VARCHAR(50) NOT NULL,
  draft_config JSONB DEFAULT '{}',
  scoring_config JSONB DEFAULT '{}',
  payout_config JSONB DEFAULT '{}',
  pool_config JSONB DEFAULT '{}',
  shared_with_tenant BOOLEAN DEFAULT FALSE,
  is_platform_template BOOLEAN DEFAULT FALSE,
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commissioner audit log
CREATE TABLE commissioner_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  contest_id UUID,
  actor_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commissioner action items (dashboard)
CREATE TABLE commissioner_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id),
  contest_id UUID,
  type VARCHAR(50) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  title VARCHAR(255) NOT NULL,
  description TEXT,
  action_url VARCHAR(500),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitations_league ON league_invitations(league_id, status);
CREATE INDEX idx_invitations_code ON league_invitations(invite_code);
CREATE INDEX idx_templates_league ON contest_templates(league_id);
CREATE INDEX idx_templates_platform ON contest_templates(is_platform_template) WHERE is_platform_template = TRUE;
CREATE INDEX idx_audit_league ON commissioner_audit_log(league_id, created_at);
CREATE INDEX idx_audit_contest ON commissioner_audit_log(contest_id, created_at);
CREATE INDEX idx_action_items_league ON commissioner_action_items(league_id, resolved, priority);
```

---

## 12. API Endpoints

```
# League setup
POST   /api/v1/leagues                         # Create league (wizard)
PUT    /api/v1/leagues/:id/settings             # Update league settings
GET    /api/v1/leagues/:id/dashboard            # Commissioner dashboard data

# Member management
POST   /api/v1/leagues/:id/invitations          # Send invitations
POST   /api/v1/leagues/:id/invite-link          # Generate invite link
DELETE /api/v1/leagues/:id/invite-link/:code     # Revoke invite link
POST   /api/v1/leagues/:id/members/import       # CSV import
PUT    /api/v1/leagues/:id/members/:uid/role     # Change member role
DELETE /api/v1/leagues/:id/members/:uid          # Remove member
POST   /api/v1/leagues/:id/members/:uid/mute     # Mute member
POST   /api/v1/leagues/:id/transfer-ownership    # Transfer ownership

# Contest setup
POST   /api/v1/leagues/:id/contests             # Create contest (wizard)
POST   /api/v1/leagues/:id/contests/bulk         # Bulk create (season setup)
POST   /api/v1/leagues/:id/contests/copy-season  # Copy from last season

# Templates
GET    /api/v1/templates                         # List templates (league + platform)
POST   /api/v1/templates                         # Save template
PUT    /api/v1/templates/:id                     # Update template
DELETE /api/v1/templates/:id                     # Delete template

# Overrides
POST   /api/v1/contests/:id/draft/undo-pick      # Undo draft pick
POST   /api/v1/contests/:id/draft/pause           # Pause draft
POST   /api/v1/contests/:id/draft/resume          # Resume draft
POST   /api/v1/contests/:id/scoring/adjust        # Adjust team score
POST   /api/v1/contests/:id/scoring/recalculate   # Recalculate standings
POST   /api/v1/contests/:id/reopen                # Re-open closed contest
POST   /api/v1/contests/:id/close                 # Force close contest
POST   /api/v1/contests/:id/payouts/confirm       # Confirm payouts
POST   /api/v1/contests/:id/payouts/recalculate   # Recalculate payouts

# Audit
GET    /api/v1/leagues/:id/audit-log              # Commissioner audit trail
GET    /api/v1/contests/:id/audit-log             # Contest-specific audit trail
```

---

## 13. Implementation Phases

### Phase 1 — League Setup & Members
- League creation wizard
- League settings management
- Member invitation flow (email + link)
- Role management (owner, commissioner, manager, viewer)
- Basic commissioner permissions

### Phase 2 — Contest Setup
- Contest creation wizard (full multi-step flow)
- Scoring template selection
- Payout structure configuration
- Quick-create from template

### Phase 3 — Commissioner Dashboard
- Dashboard home screen with action items
- Active contest summary
- Member activity feed
- Upcoming events calendar

### Phase 4 — Override Tools
- Draft overrides (undo, pause, extend clock)
- Scoring overrides (adjust, recalculate)
- Contest lifecycle overrides (reopen, close, extend)
- Payout confirmation and override

### Phase 5 — Templates & Bulk Operations
- Contest template save/load/share
- Platform template library
- Season bulk setup
- Copy last season
- CSV member import
- Commissioner audit trail

---

*Generated by Claude — PoolMaster Commissioner Tooling (Consolidated) Plan v1.0*
