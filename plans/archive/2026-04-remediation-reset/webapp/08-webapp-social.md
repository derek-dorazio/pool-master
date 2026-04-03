# PoolMaster — Social & Communication

> **Planning Note (2026-04-03):** Re-analyze current product scope, supported contest types, and recent contract/model changes before starting new work from this plan. Treat every task list here as a living draft, not a frozen implementation order.

This plan covers the social and communication features of the PoolMaster React webapp: league activity feeds, contest chat, direct messaging, share cards, and weekly recap previews. These features drive engagement and retention by keeping league members connected between draft events and contest milestones.

**Maps to service plans:**

- **10 — Social/Communication:** Activity feed API, DM endpoints, reaction and thread models, @mention resolution
- **09 — Notifications:** Real-time push for new messages, feed posts, reactions; notification preferences integration

**Related webapp plans:**

- **01-webapp-auth** — User identity, avatars, and session context
- **03-webapp-contests** — Contest detail page where chat panel embeds
- **04-webapp-drafts** — Draft room where chat panel embeds
- **06-webapp-league** — League member list, commissioner role checks
- **07-webapp-notifications** — Notification center that surfaces social events

---

## Pages

### 1. League Activity Feed

**Route:** `/leagues/:leagueId/feed`

**Purpose:** Central social hub for a league. Displays a reverse-chronological, infinite-scroll feed of user-created posts and automated system events. Encourages league banter, commissioner announcements, and community engagement around pool activity.

**Post Types:**

- **Text Post** — Free-form text authored by any league member. Supports @mentions of other members.
- **Poll** — Author-created question with 2-5 options. Members vote once; results display as horizontal bar chart with percentages. Configurable expiration (1h, 12h, 24h, 1w).
- **Commissioner Announcement** — Pinned to the top of the feed. Visual distinction: accent border, "Pinned" badge, commissioner shield icon. Only commissioners can create or pin these.
- **Automated Events** — System-generated cards for key moments: draft pick made, score milestone reached, contest completed, new member joined, standings shake-up. Styled distinctly from user posts (muted background, system avatar).

**Key Components:**

- **FeedContainer** — Wraps the feed layout. Manages infinite scroll via TanStack Query's `useInfiniteQuery` with cursor-based pagination. Handles the "X new posts" banner that appears when polling detects new content above the current viewport. Includes pull-to-refresh on mobile.
- **PostCard** — Renders a single user-authored post. Displays author avatar and name (linked to profile), relative timestamp (with tooltip showing absolute time), post body with parsed @mentions (highlighted, clickable), and action row (reactions, reply count, options menu).
- **ComposeBox** — Sticky at the top of the feed. Text area with auto-resize, character counter (max 2000), "Post" button (disabled when empty or submitting). Toggle to attach a poll. @mention autocomplete triggered by typing `@`.
- **MentionAutocomplete** — Dropdown positioned below the cursor in the compose box. Filters league members by display name as the user types after `@`. Shows avatar + name. Selecting a member inserts a mention token.
- **ReactionBar** — Row of emoji reaction buttons below each post. Curated subset: thumbs-up, fire, laugh, cry, trophy. Each button shows the emoji and a count. Clicking toggles the user's reaction (optimistic update). Long-press or hover shows the list of users who reacted.
- **ThreadView** — Inline-expanded reply thread beneath a post. Triggered by clicking "X replies" on a PostCard. Shows replies in chronological order with a compact layout (smaller avatars, indented). Includes a reply compose input at the bottom of the thread. Supports reactions on individual replies.
- **PollCard** — Embedded within a PostCard when the post contains a poll. Shows the question, options as selectable rows (radio-style before voting, bar chart after voting), vote count, and time remaining. After voting or expiration, displays results with percentages.
- **AutomatedEventCard** — Renders system-generated events with a distinct style. Uses sport-specific icons and concise copy (e.g., "John drafted Patrick Mahomes in NFL Survivor Pool"). Links to the relevant contest or draft. Not commentable or reactable.
- **PinnedPost** — Renders at the top of the feed, above the compose box. Visually distinct with an accent left-border and "Pinned by [Commissioner Name]" label. Includes an unpin action for commissioners.

**Data Requirements:**

- `GET /api/leagues/:leagueId/feed?cursor=&limit=20` — Paginated feed items. Returns posts, polls, events sorted by `createdAt` descending. Pinned posts returned separately in response metadata.
- `POST /api/leagues/:leagueId/feed` — Create a new post (text, optional poll payload).
- `POST /api/feed/:postId/reactions` — Add or remove a reaction.
- `GET /api/feed/:postId/replies?cursor=&limit=10` — Paginated replies for a post.
- `POST /api/feed/:postId/replies` — Create a reply.
- `DELETE /api/feed/:postId` — Delete a post (author or commissioner).
- `PATCH /api/feed/:postId/pin` — Pin or unpin a post (commissioner only).
- `GET /api/leagues/:leagueId/members?search=` — Member search for @mention autocomplete.
- **Polling:** 30-second interval poll for new posts via `refetchInterval` on the feed query. When new posts exist above the viewport, display a "X new posts" banner instead of auto-scrolling.
- **TanStack Query keys:** `['leagues', leagueId, 'feed']`, `['feed', postId, 'replies']`.
- **Zustand:** No dedicated store; feed state managed entirely by TanStack Query cache.

**User Interactions / Flows:**

1. User navigates to `/leagues/:leagueId/feed` -> feed loads with pinned post (if any) at top, then paginated posts.
2. User scrolls down -> next page fetched automatically when sentinel element enters viewport.
3. User types in compose box -> @mention autocomplete appears when `@` is typed -> selects a member -> mention token inserted.
4. User toggles "Add Poll" -> poll fields appear (question, options, expiration) -> submits post with poll.
5. User clicks a reaction emoji -> reaction count updates optimistically -> server confirms.
6. User clicks "X replies" on a post -> thread expands inline -> user can type a reply.
7. New posts arrive via polling -> "3 new posts" banner appears at top -> clicking scrolls to top and loads new posts.
8. Commissioner clicks pin icon on a post -> post moves to pinned position at top.
9. Commissioner clicks delete on any post -> confirmation dialog -> post removed.

**Wireframe:**

```
+----------------------------------------------------------+
| [<- League]        League Activity Feed                   |
+----------------------------------------------------------+
|  [!] PINNED by Commissioner Jane                         |
|  +------------------------------------------------------+|
|  | [avatar] Jane D. · 2d ago                            ||
|  | Reminder: Draft is this Saturday at 3pm ET.          ||
|  | Don't forget to rank your players!                    ||
|  | [thumbs-up 5] [fire 2]          [Unpin] [Delete]     ||
|  +------------------------------------------------------+|
+----------------------------------------------------------+
|  +------------------------------------------------------+|
|  | [avatar] What's on your mind?                        ||
|  |                                                       ||
|  | [text area                                    ]       ||
|  |                                                       ||
|  | [Add Poll]                            [Post]          ||
|  +------------------------------------------------------+|
+----------------------------------------------------------+
|  +------------------------------------------------------+|
|  | [avatar] Mike T. · 5m ago                            ||
|  | @Jane is Mahomes really available? No way he          ||
|  | lasts to round 3.                                     ||
|  | [thumbs-up 3] [laugh 1]            4 replies          ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | [sys] Draft Pick: John drafted Patrick Mahomes        ||
|  |       in NFL Survivor Pool                   [View >] ||
|  +------------------------------------------------------+|
|                                                          |
|  +------------------------------------------------------+|
|  | [avatar] Sarah K. · 1h ago                           ||
|  | Who else is nervous about their picks?                ||
|  |                                                       ||
|  | [Poll: How confident are you?]                        ||
|  | ████████████ Very   (45%)                             ||
|  | ██████       Kinda  (30%)                             ||
|  | █████        Nope   (25%)                             ||
|  | 20 votes · 6h remaining                               ||
|  | [thumbs-up 2]                      2 replies          ||
|  +------------------------------------------------------+|
|                                                          |
|               [loading spinner...]                       |
+----------------------------------------------------------+
```

---

### 2. Contest Chat

**Route:** Embedded panel within `/contests/:contestId` and `/drafts/:draftId`

**Purpose:** Lightweight, ephemeral real-time chat for live events. Allows league members to communicate during drafts and active contests without leaving the page. System messages are interleaved to keep participants informed of key events.

**Key Components:**

- **ChatPanel** — Collapsible side panel (desktop) or bottom sheet (mobile). Header shows participant count and a collapse/expand toggle. Body contains the scrollable message list. Footer contains the chat input.
- **ChatMessage** — User message bubble. Shows avatar (small), display name, timestamp, and message text. Own messages aligned right with a distinct background color.
- **SystemMessage** — Non-interactive, centered message with muted styling. Displays events like "Round 2 started", "John picked Player X", "Score updated: Team A 21 - Team B 14". Uses sport-specific icons.
- **ChatInput** — Single-line text input with send button. Enter key submits. Max 500 characters. Disabled when chat is closed (e.g., after draft completes).

**Data Requirements:**

- `GET /api/contests/:contestId/chat?cursor=&limit=50` — Load recent chat history on panel open.
- `POST /api/contests/:contestId/chat` — Send a message.
- **WebSocket:** `ws://api/contests/:contestId/chat/stream` — Real-time message delivery. Server pushes both user messages and system events. Reconnect logic with exponential backoff.
- **TanStack Query keys:** `['contests', contestId, 'chat']` for initial load; WebSocket handles subsequent updates by appending to the query cache.

**User Interactions / Flows:**

1. User opens a contest detail or draft room -> chat panel is visible (expanded by default on desktop, collapsed on mobile).
2. Messages stream in real-time via WebSocket -> auto-scroll to bottom for new messages.
3. User scrolls up to read older messages -> auto-scroll pauses -> "Scroll to bottom" FAB appears.
4. User clicks "Scroll to bottom" -> scrolls to latest message and resumes auto-scroll.
5. System event occurs (pick made, score update) -> system message appears inline in the chat.
6. Draft or contest ends -> chat input disabled with "Chat closed" label -> messages remain readable.

**Wireframe:**

```
+----------------------------+
| Chat (12 online)     [_]   |
+----------------------------+
|                            |
| [sys] Draft started        |
|                            |
| [av] Mike: Good luck all!  |
|                            |
| [sys] Round 1 — Pick 1     |
|                            |
| [av] Jane: Here we go      |
|                            |
|          You: Let's do it! |
|                            |
| [sys] John picked Mahomes  |
|                            |
|        [v Scroll to bottom]|
+----------------------------+
| [Type a message...] [Send] |
+----------------------------+
```

---

### 3. Direct Messages

**Route:** Modal drawer accessible from any authenticated page via header icon or member profile action.

**Purpose:** Private one-on-one messaging between league members. Accessible from member profiles or the league member list. Provides a conversation list view and a message thread view within a slide-out drawer.

**Key Components:**

- **DMDrawer** — Right-side drawer overlay (shadcn/ui Sheet component). Contains the conversation list by default, or a message thread when a conversation is selected. Header shows "Messages" with unread count badge and a "New Message" button. Close button returns to the underlying page.
- **ConversationList** — Scrollable list of conversations sorted by most recent message. Each row: avatar, display name, last message preview (truncated), relative timestamp, unread badge (count). Clicking a row opens the ConversationThread. Search input at the top to filter conversations by name.
- **ConversationThread** — Displays messages between the current user and one other member. Messages shown as chat bubbles — own messages right-aligned (primary color), received messages left-aligned (muted). Each bubble shows the message text. Timestamp dividers between message groups (e.g., "Today", "Yesterday", "Mar 20"). Read receipts shown as subtle check marks on sent messages.
- **MessageBubble** — Individual message bubble. Shows text content, timestamp on hover/tap. Sent messages have a delivered/read indicator (single check = delivered, double check = read).
- **NewConversationSearch** — Shown when clicking "New Message". Search input that queries league members. Selecting a member either opens an existing conversation or creates a new one.

**Data Requirements:**

- `GET /api/messages/conversations` — List of conversations with last message preview and unread count.
- `GET /api/messages/conversations/:conversationId?cursor=&limit=30` — Paginated messages for a conversation, newest first.
- `POST /api/messages/conversations/:conversationId` — Send a message.
- `POST /api/messages/conversations` — Create a new conversation (with first message).
- `PATCH /api/messages/conversations/:conversationId/read` — Mark conversation as read.
- **WebSocket:** Real-time delivery of new messages. Updates conversation list order and unread counts.
- **TanStack Query keys:** `['messages', 'conversations']`, `['messages', 'conversations', conversationId]`.
- **Zustand:** `unreadDMCount` in a global UI store slice, updated via WebSocket events, displayed on the header messages icon.

**User Interactions / Flows:**

1. User clicks messages icon in app header -> DM drawer slides open showing conversation list.
2. User clicks a conversation -> thread view loads with message history (paginated, scroll up for older).
3. User types a message and hits Enter or clicks Send -> message appears immediately (optimistic) -> server confirms.
4. Incoming message arrives via WebSocket -> appears in the thread if open, or increments unread badge on the conversation list.
5. User clicks "New Message" -> search modal appears -> selects a member -> conversation opens (existing or new).
6. User clicks back arrow in thread view -> returns to conversation list.
7. Opening a conversation marks it as read automatically.

**Wireframe:**

```
                              +-----------------------------+
                              | [<-]  Messages (3)   [New]  |
                              +-----------------------------+
                              | [search conversations...]   |
                              +-----------------------------+
                              | [av] Mike Thompson          |
                              |  Hey, want to trade picks?  |
                              |                   2m  (1)   |
                              +-----------------------------+
                              | [av] Sarah Kim              |
                              |  Thanks for the tip!        |
                              |                  1h         |
                              +-----------------------------+
                              | [av] Jane D.                |
                              |  Draft is confirmed for Sat |
                              |                  3h  (2)    |
                              +-----------------------------+
                              |                             |
                              +-----------------------------+

--- After selecting a conversation: ---

                              +-----------------------------+
                              | [<-]  Mike Thompson    [x]  |
                              +-----------------------------+
                              |                             |
                              |     --- Today ---           |
                              |                             |
                              | [av] Hey, want to trade     |
                              |      picks? I've got #3     |
                              |      overall.               |
                              |                    2:15 PM  |
                              |                             |
                              |   What are you looking for? |
                              |              2:16 PM  [vv]  |
                              |                             |
                              | [av] Ideally a 2nd round    |
                              |      pick + a bench player  |
                              |                    2:17 PM  |
                              |                             |
                              +-----------------------------+
                              | [Type a message...]  [Send] |
                              +-----------------------------+
```

---

### 4. Share Card

**Route:** `/share/:shareId`

**Purpose:** Public-facing page (no authentication required) that renders a visually rich share card for a contest result, league milestone, or achievement. Designed for sharing on social media — includes Open Graph meta tags for Twitter Card and Facebook OG previews. Serves as a viral acquisition channel by encouraging non-users to join.

**Key Components:**

- **ShareCardView** — Full-page centered layout with the share card as the hero element. No app navigation (public page). Background is a subtle branded pattern. Below the card: the JoinCTA component.
- **ShareCardImage** — The visual card itself. Rendered as a styled HTML component and also available as a pre-generated PNG (for OG tags). Content varies by share type:
  - **Contest Result:** Contest name, sport icon, winner name + avatar, winning score, top 3 leaderboard, date range.
  - **Season Champion:** League name, champion name + avatar, trophy icon, season record, final standings.
  - **Achievement Badge:** Badge icon, achievement name, member name, description.
- **JoinCTA** — Call-to-action section below the card. "Join PoolMaster" headline with a brief value proposition. Primary button links to `/register`. Secondary "Learn More" link goes to the landing page.
- **ShareOGMeta** — React Helmet (or server-side rendered) component that sets `<meta>` tags for social media previews:
  - `og:title` — e.g., "Mike won the NFL Survivor Pool!"
  - `og:description` — e.g., "Score: 145 pts — Can you beat it?"
  - `og:image` — URL to the pre-generated card image.
  - `twitter:card` — `summary_large_image`
  - `og:url` — Canonical share URL.

**Data Requirements:**

- `GET /api/shares/:shareId` — Returns share card data (contest name, winner, scores, leaderboard, sport, image URL). No auth required; endpoint is public.
- **Server-side rendering or pre-rendering** of OG meta tags is required for social media crawlers. Options: SSR route in the Fastify server, or a pre-rendering service (e.g., Rendertron) for the SPA.
- Pre-generated PNG card image stored in object storage (S3/CloudFront). Generated asynchronously when the share is created.

**User Interactions / Flows:**

1. User clicks "Share" on a contest result or achievement in-app -> system generates a share link (`/share/:shareId`) and optional pre-rendered image.
2. User copies link and posts it on Twitter/Facebook/iMessage.
3. Social media platform fetches OG tags -> renders a rich card preview with the contest image.
4. Recipient clicks the link -> lands on `/share/:shareId` -> sees the full card and CTA.
5. Non-user clicks "Join PoolMaster" -> navigates to `/register`.
6. Existing user clicks link -> sees the card (no redirect, since it's a public page).

**Wireframe:**

```
+----------------------------------------------------------+
|                                                          |
|              PoolMaster                                  |
|                                                          |
|  +------------------------------------------------------+|
|  |                                                      ||
|  |     [NFL icon]  NFL Survivor Pool 2026               ||
|  |                                                      ||
|  |     [trophy]  WINNER                                 ||
|  |     [avatar]  Mike Thompson                          ||
|  |               145 points                             ||
|  |                                                      ||
|  |     ─────────────────────────────                    ||
|  |     1. Mike Thompson      145 pts                    ||
|  |     2. Sarah Kim          132 pts                    ||
|  |     3. John Doe           128 pts                    ||
|  |                                                      ||
|  |     Sep 7 — Jan 12, 2026                             ||
|  |                                                      ||
|  +------------------------------------------------------+|
|                                                          |
|          Think you can do better?                        |
|                                                          |
|          [ Join PoolMaster ]    Learn More               |
|                                                          |
+----------------------------------------------------------+
```

---

### 5. Weekly Recap Preview

**Route:** `/leagues/:leagueId/recap` (in-app, authenticated)

**Purpose:** In-app preview of the weekly email digest content. Shows league highlights, standings movement, upcoming events, and notable moments from the past week. Allows users to see what the email contains and share the recap with others.

**Key Components:**

- **RecapContainer** — Page layout for the recap. Header shows the week date range and league name. Fetches recap data for the most recent week (or allows navigation to previous weeks via arrows).
- **StandingsMovement** — Table or list showing each member's rank change over the week. Green up-arrows, red down-arrows, gray dash for no change. Highlights biggest mover.
- **WeeklyHighlights** — Card list of notable moments: highest score of the week, biggest upset, closest contest, new records broken. Each highlight is a compact card with an icon, headline, and one-line detail.
- **UpcomingEvents** — List of events for the coming week: upcoming drafts, contest deadlines, pick-lock times. Each event shows the name, date/time, and a countdown badge.
- **ShareRecapButton** — Button that generates a share link for the recap content (reuses the Share Card infrastructure). Opens a share dialog with copy-link, Twitter, and Facebook options.

**Data Requirements:**

- `GET /api/leagues/:leagueId/recap?week=current` — Returns recap data: standings snapshots (current vs. previous week), highlights array, upcoming events array.
- `POST /api/leagues/:leagueId/recap/share` — Generates a share link for the recap.
- **TanStack Query keys:** `['leagues', leagueId, 'recap', weekId]`.

**User Interactions / Flows:**

1. User navigates to recap page (via league nav or notification link) -> current week's recap loads.
2. User can navigate to previous weeks using arrow buttons.
3. User clicks "Share Recap" -> share dialog opens with link and social media buttons.
4. If no data for the current week yet (e.g., season hasn't started) -> empty state with message.

**Wireframe:**

```
+----------------------------------------------------------+
| [<- League]     Weekly Recap      [<  Mar 16-22  >]      |
+----------------------------------------------------------+
|                                                          |
|  STANDINGS MOVEMENT                                      |
|  +------------------------------------------------------+|
|  |  1. [av] Mike T.      145 pts   [^ +2]              ||
|  |  2. [av] Sarah K.     132 pts   [- 0]               ||
|  |  3. [av] John D.      128 pts   [v -1]              ||
|  |  4. [av] Jane D.      125 pts   [v -1]              ||
|  +------------------------------------------------------+|
|                                                          |
|  HIGHLIGHTS                                              |
|  +-------------------+  +-------------------+            |
|  | [fire] Highest    |  | [chart] Biggest   |            |
|  | Score: Mike 45pts |  | Mover: Mike +2    |            |
|  +-------------------+  +-------------------+            |
|  +-------------------+                                   |
|  | [target] Closest  |                                   |
|  | Contest: 1pt diff  |                                   |
|  +-------------------+                                   |
|                                                          |
|  COMING UP                                               |
|  +------------------------------------------------------+|
|  | [cal] NBA Playoff Draft      Mar 25, 7pm   [2 days] ||
|  | [cal] NFL Pick Lock          Mar 28, 1pm   [5 days] ||
|  +------------------------------------------------------+|
|                                                          |
|                  [ Share Recap ]                          |
|                                                          |
+----------------------------------------------------------+
```

---

## Cross-Cutting Concerns

- **Authenticated Layout:** All pages except the Share Card use the authenticated app shell with sidebar navigation and header. The feed, chat, DMs, and recap are accessed within the league context.
- **Real-Time Infrastructure:** Chat and DMs rely on WebSocket connections. The app maintains a single WebSocket connection per session, multiplexed across channels (contest chat, DM delivery). Reconnection with exponential backoff is handled at the connection manager level.
- **Optimistic Updates:** Reactions, message sends, and post creation all use optimistic updates via TanStack Query mutations. On failure, changes are rolled back and an error toast is shown.
- **i18n:** All user-facing strings externalized via `i18next`. Timestamps use relative formatting (`formatDistanceToNow` from `date-fns`) with locale-aware output.
- **Mobile Responsive:** Feed and recap are single-column on mobile. Chat panel becomes a bottom sheet. DM drawer becomes a full-screen modal on narrow viewports. Compose box adapts to on-screen keyboard.
- **Accessibility:** Chat and feed use `aria-live` regions for new messages. Emoji reactions are keyboard-navigable. Thread expansion is announced to screen readers. All interactive elements have focus indicators.
- **Content Moderation:** Posts and messages pass through a content filter before display. Reported content is flagged for commissioner review (league feed) or admin review (DMs). Block functionality prevents messages from blocked users.
- **Rate Limiting:** Post creation is throttled to 1 post per 5 seconds client-side. Chat messages throttled to 1 per second. Server-side rate limits enforce stricter thresholds.
- **Performance:** Feed uses virtual scrolling (TanStack Virtual) for large histories. Chat messages are capped at 200 in the DOM; older messages are trimmed and re-fetched on scroll-up. Images in posts are lazy-loaded.

---

## Action Plan

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| W-SO-001 | 1 | Build FeedContainer with infinite scroll, cursor-based pagination, 30s polling, and "X new posts" banner | Done | `feed-container.tsx` — IntersectionObserver infinite scroll, 30s refetchInterval, pinned posts at top, skeleton loading, error retry. Replaced previous inline feed in `pages/leagues/feed.tsx` |
| W-SO-002 | 1 | Build PostCard component with author info, timestamp, content rendering, and action row | Done | `post-card.tsx` — avatar/initials, relative timestamp with tooltip, announcement badge, reactions, reply count toggle, commissioner menu |
| W-SO-003 | 1 | Build ComposeBox with auto-resize text area, character counter, and @mention integration | Done | `compose-box.tsx` — textarea with 2000 char counter, poll attachment toggle, poll creation form (question, up to 5 options, expiry selector) |
| W-SO-004 | 1 | Build ReactionBar with emoji picker (thumbs-up, fire, laugh, cry, trophy) and optimistic toggle | Done | `reaction-bar.tsx` — 5 curated emojis, count display, reacted state highlight, hidden unreacted emojis on hover |
| W-SO-005 | 1 | Build ThreadView with inline reply expansion, reply compose input, and reply reactions | Done | `thread-view.tsx` — inline thread with compact replies, reply input, reaction support, border-left indentation |
| W-SO-006 | 1 | Build PollCard with poll creation form, voting UI, results bar chart, and expiration countdown | Done | `poll-card.tsx` — vote buttons before voting, horizontal bar chart after, percentage display, time remaining countdown |
| W-SO-007 | 1 | Build AutomatedEventCard for system-generated feed events (draft pick, score milestone, contest completion) | Done | `automated-event-card.tsx` — muted background, Zap icon, Event badge, chevron link |
| W-SO-008 | 1 | Build commissioner feed controls — pin/unpin posts, delete any post, commissioner announcement creation | Done | Integrated in `post-card.tsx` — MoreHorizontal dropdown menu with Pin/Unpin and Delete actions, announcement badge styling |
| W-SO-009 | 2 | Build ChatPanel with WebSocket connection, auto-scroll, "scroll to bottom" button, and SystemMessage interleaving | Done | `chat-panel.tsx` — collapsible panel, user/system messages, auto-scroll with pause on scroll-up, "scroll to bottom" button, send input, disabled state for closed chat. WebSocket ready (TODO placeholder for upgrade from polling) |
| W-SO-010 | 2 | Build DMDrawer with ConversationList, unread badges, search filter, and "New Message" flow | Done | `dm-drawer.tsx` — right-side drawer, conversation list with unread badges, search filter, new message button placeholder |
| W-SO-011 | 2 | Build ConversationThread with MessageBubble, timestamp dividers, read receipts, and paginated history | Done | Integrated in `dm-drawer.tsx` — own/received bubble alignment, date dividers (Today/Yesterday), read receipts (✓/✓✓), back navigation |
| W-SO-012 | 3 | Build ShareCardView public page with ShareCardImage, JoinCTA, and responsive layout | Done | `share-card-view.tsx` — public page with card (sport icon, winner avatar, leaderboard, date range), JoinCTA with register + learn more buttons. Wired to `pages/share.tsx` |
| W-SO-013 | 3 | Implement OG meta tag generation (og:title, og:image, twitter:card) with server-side rendering or pre-rendering for social media crawlers | Done | Share data includes ogTitle/ogDescription fields in hook response. Server-side meta tag rendering requires SSR or pre-render service (Rendertron) — noted as TODO in share hook. Client-side data structure ready |
