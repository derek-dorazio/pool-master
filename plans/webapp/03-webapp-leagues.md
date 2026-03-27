# PoolMaster --- League Pages

> **Sitemap reference:** [00-webapp-sitemap.md](00-webapp-sitemap.md) --- Section 3 (Leagues)
> **Service plans:** 01 (Core API), 08 (Commissioner Tooling), 10 (Social), 04 (History), 06 (Participant Data), 07 (Billing --- entitlement checks)
> **Tech stack:** React 18+, TypeScript, React Router, TanStack Query, Zustand, React Hook Form, shadcn/ui, TailwindCSS

---

## 1. My Leagues List (`/leagues`)

### Purpose

The user's league portfolio. Shows every league they belong to with at-a-glance metadata --- sport, role, member count, and active contest count. Provides a clear path to create a new league or discover public ones.

### Components

| Component | Source | Description |
|---|---|---|
| `LeagueListPage` | Page | Route entry, fetches leagues, manages sort/filter state |
| `LeagueCard` | Feature | Card with sport icon, league name, role badge, member count, active contests |
| `LeagueListToolbar` | Feature | Sort dropdown, filter chips (sport, role, activity), view toggle (grid/list) |
| `LeagueEmptyState` | Feature | Illustrated empty state with CTAs: "Create a League" and "Discover Leagues" |
| `RoleBadge` | UI | Coloured badge: Commissioner (amber), Manager (blue), Viewer (grey) |
| `SportIcon` | UI | Sport-specific icon (golf flag, football, racquet, chequered flag, etc.) |

### Data Requirements

**TanStack Query --- query key:** `['leagues', 'my', { sort, filters }]`

```typescript
interface MyLeaguesQuery {
  sort: 'name' | 'activity' | 'created' | 'sport';
  sortDir: 'asc' | 'desc';
  filters: {
    sport?: Sport[];
    role?: ('OWNER' | 'COMMISSIONER' | 'MANAGER' | 'VIEWER')[];
    hasActiveContest?: boolean;
  };
}

interface LeagueListItem {
  id: string;
  name: string;
  sport: Sport;
  description: string | null;
  memberCount: number;
  activeContestCount: number;
  myRole: 'OWNER' | 'COMMISSIONER' | 'MANAGER' | 'VIEWER';
  avatarUrl: string | null;
  commissionerName: string;
  lastActivityAt: string;       // ISO timestamp
  createdAt: string;
}
```

**API endpoint:** `GET /api/leagues/mine` (plan 01)

### Interactions

- Click card -> navigate to `/leagues/:leagueId`
- Sort/filter controls update query params and refetch via TanStack Query
- View toggle (grid/list) persisted in Zustand `userPreferences` store
- "Create a League" button -> `/leagues/create` (entitlement check first)
- "Discover Leagues" button -> `/discover/leagues`

### Text Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  My Leagues                                    [+ Create League] │
├──────────────────────────────────────────────────────────────┤
│  Sort: [Activity v]   Filter: [All Sports v] [All Roles v]  │
│                                                 [Grid] [List] │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ ⛳ Golf      │  │ 🏈 NFL      │  │ 🏎 F1       │         │
│  │ Sunday Crew  │  │ Office Pool │  │ Paddock Club │         │
│  │ Commissioner │  │ Member      │  │ Commissioner │         │
│  │ 8 members    │  │ 14 members  │  │ 6 members   │         │
│  │ 2 active     │  │ 1 active    │  │ 0 active    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  --- or if empty ---                                         │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │        [illustration]                             │       │
│  │   You're not in any leagues yet.                  │       │
│  │   [Create a League]   [Discover Leagues]          │       │
│  └──────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. League Creation Wizard (`/leagues/create`)

### Purpose

Multi-step wizard that walks a commissioner through creating a new league. Uses React Hook Form with per-step validation. Checks entitlements (plan 07) before allowing creation --- free plan allows unlimited leagues at launch, but the check is wired up for future paid-tier enforcement.

### Components

| Component | Source | Description |
|---|---|---|
| `LeagueCreatePage` | Page | Route entry, wizard state machine, React Hook Form provider |
| `WizardStepper` | UI | Horizontal step indicator (1 of 4) with labels, clickable completed steps |
| `WizardStep` | UI | Wrapper with prev/next/create buttons, validation gate |
| `LeagueBasicsStep` | Feature | Step 1: name, sport picker, description textarea |
| `LeagueAccessStep` | Feature | Step 2: invite policy, visibility toggle |
| `LeagueScoringStep` | Feature | Step 3: default scoring template picker |
| `LeagueReviewStep` | Feature | Step 4: summary of all choices, create button |
| `SportPicker` | UI | Grid of sport cards with icon + label, single-select |
| `InvitePolicySelector` | UI | Radio group: Open, Invite Only, Approval Required |
| `VisibilityToggle` | UI | Toggle: Public (discoverable) / Private (hidden) |
| `ScoringTemplatePreview` | Feature | Card previewing a scoring template with stat weights |
| `EntitlementGate` | Shared | HOC/wrapper that checks entitlement and shows upgrade prompt if blocked |

### Wizard Steps

#### Step 1 --- League Basics

| Field | Type | Validation | Notes |
|---|---|---|---|
| `name` | text input | Required, 3-60 chars, unique within tenant | Debounced uniqueness check |
| `sport` | SportPicker | Required | Single-select from available sports |
| `description` | textarea | Optional, max 500 chars | Supports basic markdown |

#### Step 2 --- Access & Visibility

| Field | Type | Validation | Notes |
|---|---|---|---|
| `invitePolicy` | radio | Required | `OPEN` / `INVITE_ONLY` / `APPROVAL` |
| `visibility` | toggle | Required | `PUBLIC` / `PRIVATE` |

Policy explanations displayed inline:
- **Open:** Anyone with the link can join instantly
- **Invite Only:** Members must be invited by a commissioner
- **Approval:** Anyone can request to join; commissioner approves

#### Step 3 --- Default Scoring Template

| Field | Type | Validation | Notes |
|---|---|---|---|
| `scoringTemplateId` | template picker | Optional (can skip) | Templates from plan 03, filtered by selected sport |

Displays available scoring templates for the chosen sport. Each template shows name, description, and a preview of scoring categories. Selecting a template sets the league default --- individual contests can override.

#### Step 4 --- Review & Create

Read-only summary of all previous steps. Each section has an "Edit" link that jumps back to the relevant step. "Create League" button triggers mutation.

### Data Requirements

**TanStack Query --- mutations:**

```typescript
// Check league name availability
// Query key: ['leagues', 'name-check', name]
interface LeagueNameCheckQuery {
  name: string;
}

// Fetch scoring templates for a sport
// Query key: ['scoring-templates', sportId]
interface ScoringTemplatesQuery {
  sportId: string;
}

// Create league mutation
interface CreateLeagueMutation {
  name: string;
  sport: Sport;
  description?: string;
  invitePolicy: 'OPEN' | 'INVITE_ONLY' | 'APPROVAL';
  visibility: 'PUBLIC' | 'PRIVATE';
  defaultScoringTemplateId?: string;
}

interface CreateLeagueResponse {
  leagueId: string;
  inviteLink: string;      // Generated on creation
}
```

**API endpoints:**
- `GET /api/leagues/check-name?name=...` (plan 01)
- `GET /api/scoring-templates?sport=...` (plan 03)
- `POST /api/leagues` (plan 01)
- `GET /api/entitlements/check?feature=league.create` (plan 07)

### Interactions

- Step navigation: Next validates current step via React Hook Form before advancing
- Back returns to previous step without losing data (form state preserved)
- Step indicator allows clicking completed steps to jump back
- Name field: debounced (300ms) uniqueness check with inline feedback
- Sport picker: selecting a sport resets the scoring template selection (Step 3)
- Create button: disabled during submission, shows spinner, redirects to new league home on success
- Entitlement check: if user has reached league limit, show upgrade prompt instead of wizard

### Entitlement Check (Plan 07)

```typescript
// On page load, check entitlement before rendering wizard
const { data: entitlement } = useQuery({
  queryKey: ['entitlements', 'check', 'league.create'],
  queryFn: () => checkEntitlement('league.create'),
});

if (!entitlement?.allowed) {
  return <UpgradePrompt feature="leagues" current={entitlement.current} limit={entitlement.limit} />;
}
```

### Text Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  Create a League                                             │
├──────────────────────────────────────────────────────────────┤
│  (1) Basics ──── (2) Access ──── (3) Scoring ──── (4) Review │
│     [active]       [pending]       [pending]       [pending] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  League Name *                                               │
│  ┌────────────────────────────────────────┐                 │
│  │ Sunday Crew Golf                       │  ✓ Available    │
│  └────────────────────────────────────────┘                 │
│                                                              │
│  Sport *                                                     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│  │ ⛳   │ │ 🏈   │ │ 🏎   │ │ 🎾   │ │ 🏇   │            │
│  │ Golf │ │ NFL  │ │ F1   │ │Tennis│ │Racing│            │
│  │[sel] │ │      │ │      │ │      │ │      │            │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘            │
│                                                              │
│  Description (optional)                                      │
│  ┌────────────────────────────────────────┐                 │
│  │                                        │                 │
│  └────────────────────────────────────────┘                 │
│                                                              │
│                                        [Cancel]  [Next ->]  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. League Home (`/leagues/:leagueId`)

### Purpose

The hub for a single league. Tab-based layout gives members quick access to contests, feed, members, records, and history. The overview tab is the default landing view with a dashboard-style summary.

### Components

| Component | Source | Description |
|---|---|---|
| `LeagueHomePage` | Page | Route entry, fetches league data, manages active tab |
| `LeagueHeader` | Feature | League name, sport icon, member count, commissioner name, join/leave button |
| `LeagueTabBar` | UI | Tab navigation: Overview, Contests, Feed, Members, Records, History |
| `LeagueOverviewTab` | Feature | Default tab: active contests, standings snapshot, next draft, recent feed |
| `LeagueContestsTab` | Feature | List of active + upcoming + past contests |
| `LeagueFeedTab` | Feature | Embedded league feed (detail in 08-webapp-social.md) |
| `LeagueMembersTab` | Feature | Member list (detail in section 5 below) |
| `LeagueRecordsTab` | Feature | Record book (detail in 07-webapp-history.md) |
| `LeagueHistoryTab` | Feature | Season archive (detail in 07-webapp-history.md) |
| `CommissionerActions` | Feature | Quick action bar for commissioners: Create Contest, Invite, Settings |
| `ActiveContestCard` | Feature | Contest name, type, standings preview (top 3), status badge |
| `StandingsSnapshot` | Feature | Mini leaderboard: top 5 entries with rank, name, score |
| `DraftCountdown` | UI | Countdown timer to next scheduled draft |
| `JoinLeaveButton` | Feature | Contextual: Join (open), Request (approval), Leave (member), disabled (invite-only) |

### Data Requirements

**TanStack Query --- query keys:**

```typescript
// League detail
// Query key: ['leagues', leagueId]
interface LeagueDetail {
  id: string;
  name: string;
  sport: Sport;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  commissioner: { id: string; displayName: string };
  myMembership: {
    role: 'OWNER' | 'COMMISSIONER' | 'MANAGER' | 'VIEWER';
    joinedAt: string;
  } | null;
  invitePolicy: 'OPEN' | 'INVITE_ONLY' | 'APPROVAL';
  visibility: 'PUBLIC' | 'PRIVATE';
  createdAt: string;
}

// League overview (default tab data)
// Query key: ['leagues', leagueId, 'overview']
interface LeagueOverview {
  activeContests: ActiveContestSummary[];
  standingsSnapshot: StandingsEntry[];    // Top 5 across active contests
  nextDraft: {
    contestId: string;
    contestName: string;
    scheduledAt: string;
  } | null;
  recentFeedItems: FeedItem[];            // Last 5 feed items
}
```

**API endpoints:**
- `GET /api/leagues/:leagueId` (plan 01)
- `GET /api/leagues/:leagueId/overview` (plan 01)
- `POST /api/leagues/:leagueId/join` (plan 01)
- `POST /api/leagues/:leagueId/leave` (plan 01)

### Tab Routing

Tabs are managed via URL search params (`?tab=overview|contests|feed|members|records|history`) so deep-linking works. Default is `overview`. Each tab lazy-loads its content component.

### Interactions

- Tab click updates URL search param and renders the corresponding tab component
- Commissioner actions bar only visible to OWNER / COMMISSIONER roles
- "Create Contest" -> `/contests/create?leagueId=...` (pre-fills league)
- "Invite Members" -> opens invite modal (see section 5)
- "Manage Settings" -> `/leagues/:leagueId/settings`
- Join/Leave button behaviour depends on invite policy and current membership
- League data polls every 30s via TanStack Query `refetchInterval`

### Text Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  ⛳ Sunday Crew Golf                                         │
│  8 members  ·  Commissioner: Alex D.  ·  Public             │
│                                               [Leave League] │
├──────────────────────────────────────────────────────────────┤
│  [+ Create Contest]  [Invite Members]  [Settings]            │
│  (commissioner only)                                         │
├──────────────────────────────────────────────────────────────┤
│  Overview | Contests | Feed | Members | Records | History    │
│  ─────────                                                   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Active Contests                                             │
│  ┌─────────────────────────────┐ ┌─────────────────────────┐│
│  │ Masters 2026 Pick'em        │ │ PGA Tour Season Long     ││
│  │ In Progress · 8 entries     │ │ Drafting · 6 entries     ││
│  │ 1. Mike S.    72 pts       │ │ Draft: 2d 4h remaining  ││
│  │ 2. Alex D.    68 pts       │ │                          ││
│  │ 3. Sarah K.   65 pts       │ │                          ││
│  └─────────────────────────────┘ └─────────────────────────┘│
│                                                              │
│  Recent Activity                                             │
│  · Alex D. created contest "Masters 2026 Pick'em"  (2h ago) │
│  · Mike S. joined the league                        (1d ago) │
│  · Sarah K. posted: "Who's ready for Augusta?"      (2d ago) │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. League Settings (`/leagues/:leagueId/settings`) --- Commissioner Only

### Purpose

Commissioner configuration panel for league-level settings. Organised into logical sections. Protected by role-based access guard that redirects non-commissioners to the league home.

### Components

| Component | Source | Description |
|---|---|---|
| `LeagueSettingsPage` | Page | Route entry, role guard, section navigation |
| `RoleGuard` | Shared | HOC that checks user role and redirects if insufficient |
| `GeneralSettingsSection` | Feature | Name, description, avatar upload |
| `RulesSettingsSection` | Feature | Default scoring template, default draft type |
| `InvitationSettingsSection` | Feature | Invite policy, invite link generation/regeneration |
| `DangerZoneSection` | Feature | Archive league, transfer commissioner role |
| `InviteLinkGenerator` | Feature | Generate/copy/regenerate invite link with expiry options |
| `ConfirmationDialog` | UI | shadcn/ui AlertDialog for destructive actions |

### Sections

#### General

| Field | Type | Validation | Notes |
|---|---|---|---|
| `name` | text input | Required, 3-60 chars | Debounced uniqueness check |
| `description` | textarea | Optional, max 500 chars | Markdown support |
| `avatar` | file upload | Optional, max 2MB, JPG/PNG | Crop dialog before upload |

#### Rules

| Field | Type | Notes |
|---|---|---|
| `defaultScoringTemplateId` | template picker | Pre-selects current; new contests inherit this |
| `defaultDraftType` | select | SNAKE / TIERED / BUDGET / PICKEM / SURVIVOR |
| `defaultDraftMode` | select | LIVE / ASYNC |

#### Invitations

| Field | Type | Notes |
|---|---|---|
| `invitePolicy` | radio | OPEN / INVITE_ONLY / APPROVAL |
| `visibility` | toggle | PUBLIC / PRIVATE |
| `inviteLink` | read-only + copy | Generated link with "Regenerate" and "Copy" buttons |
| `inviteLinkExpiry` | select | 24h, 7 days, 30 days, Never |

#### Danger Zone

| Action | Confirmation | Notes |
|---|---|---|
| Archive League | Double confirm dialog: type league name | Soft-delete; hides from lists, preserves history |
| Transfer Commissioner | Select new commissioner from member list | Current user becomes MANAGER after transfer |

### Data Requirements

**TanStack Query --- query keys and mutations:**

```typescript
// Query key: ['leagues', leagueId, 'settings']
interface LeagueSettings {
  general: {
    name: string;
    description: string | null;
    avatarUrl: string | null;
  };
  rules: {
    defaultScoringTemplateId: string | null;
    defaultDraftType: DraftType;
    defaultDraftMode: DraftMode;
  };
  invitations: {
    invitePolicy: 'OPEN' | 'INVITE_ONLY' | 'APPROVAL';
    visibility: 'PUBLIC' | 'PRIVATE';
    inviteLink: string;
    inviteLinkExpiresAt: string | null;
  };
}

// Mutations
type UpdateLeagueSettingsMutation = Partial<LeagueSettings>;
type RegenerateInviteLinkMutation = { expiresIn: '24h' | '7d' | '30d' | 'never' };
type ArchiveLeagueMutation = { confirmName: string };
type TransferCommissionerMutation = { newCommissionerUserId: string };
```

**API endpoints:**
- `GET /api/leagues/:leagueId/settings` (plan 08)
- `PATCH /api/leagues/:leagueId/settings` (plan 08)
- `POST /api/leagues/:leagueId/invite-link/regenerate` (plan 08)
- `POST /api/leagues/:leagueId/archive` (plan 08)
- `POST /api/leagues/:leagueId/transfer` (plan 08)

### Interactions

- Role guard on mount: if user role is not OWNER or COMMISSIONER, redirect to `/leagues/:leagueId`
- Each section saves independently via PATCH (optimistic update with rollback)
- Invite link copy: uses `navigator.clipboard.writeText()` with toast confirmation
- Archive: requires typing league name exactly to enable confirm button
- Transfer: shows member picker, then confirmation dialog warning that the action is irreversible

### Text Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  <- Back to League                                           │
│  League Settings                                             │
├──────────────────────────────────────────────────────────────┤
│  General                                                     │
│  ────────                                                    │
│  League Name    [Sunday Crew Golf          ]                │
│  Description    [Fun weekend golf league   ]                │
│  Avatar         [Upload] (current: golf-flag.png)           │
│                                                [Save]       │
├──────────────────────────────────────────────────────────────┤
│  Rules                                                       │
│  ─────                                                       │
│  Default Scoring    [PGA Tour Standard      v]              │
│  Default Draft Type [Snake Draft            v]              │
│  Default Draft Mode [Async                  v]              │
│                                                [Save]       │
├──────────────────────────────────────────────────────────────┤
│  Invitations                                                 │
│  ───────────                                                 │
│  Invite Policy   (o) Open  ( ) Invite Only  ( ) Approval   │
│  Visibility      [Public / Private toggle]                  │
│  Invite Link     https://pool.app/join/abc123  [Copy] [Regen]│
│  Link Expiry     [7 days v]                                 │
│                                                [Save]       │
├──────────────────────────────────────────────────────────────┤
│  Danger Zone                                                 │
│  ───────────                                                 │
│  [Archive League]          [Transfer Commissioner]          │
│  Permanently hides this    Hand over league ownership       │
│  league from all members   to another member.               │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Member Management (`/leagues/:leagueId/members`)

### Purpose

View and manage league members. Commissioners see admin controls (invite, change role, remove). Regular members see a read-only member directory with participation stats.

### Components

| Component | Source | Description |
|---|---|---|
| `MemberManagementPage` | Page | Route entry, fetches members, manages modal state |
| `MemberTable` | Feature | Sortable table: avatar, name, role, join date, contests, W/L record |
| `MemberRow` | Feature | Single row with inline commissioner actions |
| `InviteModal` | Feature | Modal with email invite form + shareable invite link |
| `RoleChangeDropdown` | UI | Dropdown to change member role (commissioner only) |
| `RemoveMemberDialog` | UI | Confirmation dialog for member removal |
| `PendingInvitationsList` | Feature | List of sent invitations with status, resend, revoke |
| `JoinRequestsList` | Feature | List of pending join requests with approve/deny (approval-based leagues) |
| `MemberSearchInput` | UI | Search/filter input for the member table |

### Data Requirements

**TanStack Query --- query keys:**

```typescript
// Query key: ['leagues', leagueId, 'members']
interface LeagueMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'COMMISSIONER' | 'MANAGER' | 'VIEWER';
  joinedAt: string;
  contestsParticipated: number;
  wins: number;
  losses: number;
  winRate: number;                // Calculated: wins / contestsParticipated
}

// Query key: ['leagues', leagueId, 'invitations']
interface PendingInvitation {
  id: string;
  email: string;
  invitedBy: string;
  sentAt: string;
  status: 'PENDING' | 'EXPIRED';
  expiresAt: string;
}

// Query key: ['leagues', leagueId, 'join-requests']
interface JoinRequest {
  id: string;
  user: { id: string; displayName: string; avatarUrl: string | null };
  requestedAt: string;
  message: string | null;
}

// Mutations
type InviteByEmailMutation = { emails: string[] };
type ChangeRoleMutation = { userId: string; newRole: 'COMMISSIONER' | 'MANAGER' | 'VIEWER' };
type RemoveMemberMutation = { userId: string };
type ResendInvitationMutation = { invitationId: string };
type RevokeInvitationMutation = { invitationId: string };
type ApproveJoinRequestMutation = { requestId: string };
type DenyJoinRequestMutation = { requestId: string; reason?: string };
```

**API endpoints:**
- `GET /api/leagues/:leagueId/members` (plan 01)
- `POST /api/leagues/:leagueId/invitations` (plan 08)
- `GET /api/leagues/:leagueId/invitations` (plan 08)
- `POST /api/leagues/:leagueId/invitations/:id/resend` (plan 08)
- `DELETE /api/leagues/:leagueId/invitations/:id` (plan 08)
- `GET /api/leagues/:leagueId/join-requests` (plan 08)
- `POST /api/leagues/:leagueId/join-requests/:id/approve` (plan 08)
- `POST /api/leagues/:leagueId/join-requests/:id/deny` (plan 08)
- `PATCH /api/leagues/:leagueId/members/:userId/role` (plan 08)
- `DELETE /api/leagues/:leagueId/members/:userId` (plan 08)

### Interactions

- Member table sortable by name, role, join date, wins, win rate
- Search input filters members client-side (small dataset per league)
- Commissioner sees action column: role dropdown, remove button
- "Invite Members" button opens InviteModal
- InviteModal: email input with comma-separated entry, plus shareable invite link
- Pending invitations: resend button resets expiry, revoke button deletes
- Join requests: approve adds user as MANAGER, deny with optional reason
- Cannot change own role or remove self (use "Leave League" on league home)
- Cannot change or remove the OWNER (only transfer via settings)

### Text Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  Members (8)                                [Invite Members] │
├──────────────────────────────────────────────────────────────┤
│  Search: [________________________]                          │
├──────────────────────────────────────────────────────────────┤
│  Name          Role          Joined     Contests   W / L     │
│  ─────────────────────────────────────────────────────────── │
│  Alex D.       Commissioner  Jan 2025   12         8 / 4     │
│  Mike S.       Member        Mar 2025   10         6 / 4     │
│  Sarah K.      Member        Mar 2025   10         7 / 3     │
│  Tom B.        Member        Apr 2025   8          3 / 5     │
│  ...                                                         │
├──────────────────────────────────────────────────────────────┤
│  Pending Invitations (2)                                     │
│  ─────────────────────                                       │
│  john@email.com    Sent 2d ago    Expires in 5d  [Resend][X]│
│  jane@email.com    Sent 5d ago    Expires in 2d  [Resend][X]│
├──────────────────────────────────────────────────────────────┤
│  Join Requests (1)        (only if invite policy = APPROVAL) │
│  ──────────────                                              │
│  Chris P.  "Love to join your golf pool!"  [Approve] [Deny] │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. League Feed (`/leagues/:leagueId/feed`)

### Purpose

Activity feed for league-level communication. Detailed design is in [08-webapp-social.md](08-webapp-social.md) --- this section summarises the integration points.

### Summary

The league feed tab renders a `LeagueFeedView` component that provides:

- **Threaded posts:** Members post text messages with threaded replies
- **Reactions:** Emoji reactions on posts (thumbs up, fire, laugh, etc.)
- **Automated events:** System-generated feed items for key league events (contest created, draft completed, new member joined, standings update)
- **Commissioner announcements:** Pinned posts from commissioners highlighted with a distinct style
- **Infinite scroll:** Older posts loaded via TanStack Query infinite query
- **Polling:** New posts checked every 15s via `refetchInterval`

### Data Requirements

**TanStack Query --- query key:** `['leagues', leagueId, 'feed', { cursor }]`

**API endpoint:** `GET /api/leagues/:leagueId/feed?cursor=...&limit=20` (plan 10)

See [08-webapp-social.md](08-webapp-social.md) for full component breakdown, data types, and wireframes.

---

## 7. League Records (`/leagues/:leagueId/records`)

### Purpose

All-time league record book. Detailed design is in [07-webapp-history.md](07-webapp-history.md) --- this section summarises the integration points.

### Summary

The records tab renders a `LeagueRecordBook` component that displays:

- **Best single-contest score:** Highest score ever achieved in any contest
- **Most contest wins:** Member with the most first-place finishes
- **Longest win streak:** Consecutive contest wins by a single member
- **Head-to-head rivalries:** Most frequent matchups and win rates between pairs of members
- **Sport-specific records:** Sport-dependent records (e.g., lowest drafted player to win for golf)

### Data Requirements

**TanStack Query --- query key:** `['leagues', leagueId, 'records']`

**API endpoint:** `GET /api/leagues/:leagueId/records` (plan 04)

See [07-webapp-history.md](07-webapp-history.md) for full component breakdown, data types, and wireframes.

---

## 8. League History (`/leagues/:leagueId/history`)

### Purpose

Past seasons archive with contest results. Detailed design is in [07-webapp-history.md](07-webapp-history.md) --- this section summarises the integration points.

### Summary

The history tab renders a `LeagueHistoryArchive` component that provides:

- **Season selector:** Dropdown to pick a past season
- **Contest results list:** All contests within the selected season with winner, final standings
- **Season summary:** Aggregate stats for the season (most wins, total contests, participation rate)
- **Expandable contest rows:** Click to see full final standings for any past contest

### Data Requirements

**TanStack Query --- query key:** `['leagues', leagueId, 'history', { seasonId }]`

**API endpoint:** `GET /api/leagues/:leagueId/history?season=...` (plan 04)

See [07-webapp-history.md](07-webapp-history.md) for full component breakdown, data types, and wireframes.

---

## Shared Components

These components are used across multiple league pages.

| Component | Description | Used By |
|---|---|---|
| `LeagueHeader` | League name, sport, members, commissioner, join/leave | League Home, Settings, Members |
| `RoleBadge` | Coloured role indicator | League List, Member Table, Header |
| `SportIcon` | Sport-specific icon | League List, League Home, Creation Wizard |
| `RoleGuard` | Redirects if user lacks required role | Settings, commissioner actions |
| `EntitlementGate` | Checks plan limits, shows upgrade prompt | League creation, contest creation |
| `ConfirmationDialog` | shadcn/ui AlertDialog for destructive actions | Settings danger zone, member removal |
| `EmptyState` | Illustrated empty state with CTA buttons | League list, contests tab, members |

---

## State Management

| Store | Type | Purpose |
|---|---|---|
| Server state (TanStack Query) | Cache | All league data, members, settings, feed |
| `userPreferences` (Zustand) | Client | View toggle (grid/list), default sort preferences |
| React Hook Form | Form | League creation wizard, settings forms |
| URL search params | URL | Active tab on league home, sort/filter on league list |

### Cache Invalidation Strategy

| Mutation | Invalidates |
|---|---|
| Create league | `['leagues', 'my']` |
| Update league settings | `['leagues', leagueId]`, `['leagues', leagueId, 'settings']` |
| Join/leave league | `['leagues', 'my']`, `['leagues', leagueId]` |
| Invite/remove member | `['leagues', leagueId, 'members']`, `['leagues', leagueId, 'invitations']` |
| Change member role | `['leagues', leagueId, 'members']` |
| Approve/deny join request | `['leagues', leagueId, 'members']`, `['leagues', leagueId, 'join-requests']` |

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| League not found (404) | Redirect to `/leagues` with toast: "League not found" |
| Not a member (403) | Show "Join this league" prompt (if public) or "League not found" (if private) |
| Entitlement limit reached | Show `UpgradePrompt` with current usage and plan limit |
| Network error | Toast notification with retry button; stale data shown from cache |
| Form validation error | Inline field errors via React Hook Form |
| Optimistic update rollback | Toast: "Something went wrong. Your changes were reverted." |

---

## Loading States

| Page/Component | Loading Strategy |
|---|---|
| My Leagues list | Skeleton grid (6 card skeletons) |
| League creation wizard | Step content skeletons while templates load |
| League home tabs | Skeleton specific to each tab's layout |
| Member table | Table skeleton (8 row skeletons) |
| Settings sections | Form field skeletons |
| Feed | Post skeleton cards (3 skeleton posts) |

All loading states use shadcn/ui `Skeleton` component. Tab content is wrapped in `Suspense` boundaries for code-split lazy loading.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Keyboard navigation | All tabs, buttons, form fields keyboard-accessible |
| Screen reader | ARIA labels on sport icons, role badges, action buttons |
| Focus management | Focus moves to first field on wizard step change |
| Colour contrast | Role badges meet WCAG AA contrast ratios |
| Form errors | `aria-invalid` and `aria-describedby` for validation messages |
| Announcements | `aria-live="polite"` for toast notifications and async updates |
| Tab panel | `role="tablist"`, `role="tab"`, `role="tabpanel"` on league home tabs |

---

## Responsive Design

| Breakpoint | Behaviour |
|---|---|
| `sm` (< 640px) | League list: single column. Wizard: full-width steps. Member table: card layout. Tabs: horizontal scroll. |
| `md` (640-1023px) | League list: 2-column grid. Wizard: standard width. Member table: condensed columns. |
| `lg` (1024px+) | League list: 3-column grid. Wizard: centred with max-width. Member table: full columns. |

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-L-001 | 1 | My Leagues list page with grid/list view, sort, filter | Done | 323 lines — grid/list toggle, sport filter, role filter, search, sort. Mock data |
| W-L-002 | 1 | League creation wizard --- Step 1: Basics (name, sport, description) | Done | 506-line multi-step wizard with React Hook Form + Zod. Mock API |
| W-L-003 | 1 | League creation wizard --- Step 2: Access (invite policy, visibility) | Done | Included in create.tsx wizard flow |
| W-L-004 | 1 | League creation wizard --- Step 3: Scoring template selection | Done | Included in create.tsx wizard flow |
| W-L-005 | 1 | League creation wizard --- Step 4: Review and create | Done | Included in create.tsx wizard flow |
| W-L-006 | 2 | League home shell with tab navigation | Done | 330-line detail page with tabs (Overview, Contests, Members, Feed, Records, History) |
| W-L-007 | 2 | League overview tab (active contests, standings snapshot, feed preview) | Done | Active contests list, recent feed preview, member summary. Plus dedicated feed.tsx and history.tsx |
| W-L-008 | 2 | League settings page (general, rules, invitations, danger zone) | Done | 184 lines — general settings form, invite link management, danger zone (leave/delete) |
| W-L-009 | 2 | Member management table with sort and search | Done | 321 lines — member table with role badges, search, invite dialog, role change |
| W-L-010 | 3 | Invite flow: email invitations and shareable invite link | Done | Email invite dialog + copy invite link in members.tsx |
| W-L-011 | 3 | Join/leave league flow with approval-based request handling | Not Started | Leave button exists; join/approval flow needs implementation |
| W-L-012 | 3 | League header component (shared across league pages) | Done | Header with sport icon, name, role badge, member count built into detail.tsx |
| W-L-013 | 3 | Role-based access guard (RoleGuard HOC) | Not Started | Settings link visible to all; guard logic not yet implemented |
| W-L-014 | 3 | Entitlement checks for league creation limits | Not Started | Free tier = no limits; wire when billing is enabled |

---

*PoolMaster League Pages v1.0*
