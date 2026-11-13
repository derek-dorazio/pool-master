# iPhone and Android App

**Tracking issue:** #1473 (mobile app epic, deferred)

Written 2026-11-09 at Derek's request, as a plan only. Tickets and estimates come next, from
this plan. Nothing here is built.

## TL;DR

- **One Expo app in `clients/mobile`**, iPhone first, Android from the same code later, per
  ADR-0010 and `rules/mobile-rules.md`. Expo Router for screens, EAS to build and ship. No
  Mac is needed to build: EAS builds iOS in the cloud.
- **Share everything below the screen.** A new package, `@poolmaster/client-core`, takes the
  web app's API client setup, query keys, query and mutation hooks, form schemas and pure
  contest logic. The web app moves onto it piece by piece, so nothing is copied.
- **One theme, two renderers.** The colours move into a typed token file that both apps read:
  the web app's `globals.css` is generated from it, and the phone app gets the same roles,
  light and dark, as plain values. Same fonts, same icons (Lucide), same drawings.
- **Same primitives, same names.** The phone gets its own `Button`, `Tile`, `Heading`,
  `Eyebrow`, `Chip`, `StatusBadge`, `SectionCard`, `SimpleTable`, `QueryState` and friends,
  with the web props wherever they make sense, so a screen reads the same in both apps.
- **Sign-in uses the Bearer path the API already has.** Login already returns the tokens in
  the body and refresh already takes the token in the body; the app keeps the refresh token
  in the phone's keychain. No backend change is needed to sign in.
- **Built member first, Free plan first.** The first release is the member app on the Free
  plan: sign in, leagues, contests, picks for every selection type, live leaderboards, my
  team, account. Paid-plan member screens and commissioner tools come after, if Derek wants
  them; root admin never comes to the phone.
- **Push notifications are the phone's real gain** and the one big backend addition: the
  same notices that send email today also go to the phone.

## 1. Purpose and Governing Rules

Members open Poolmaster on their phones far more than at a desk: to make picks before a
game and to watch standings during it. The web app already works at phone width; an app
adds a home-screen icon, push notifications, a remembered sign-in and native scrolling and
gestures.

What governs this plan:

- `docs/adr/0010-react-native-expo-for-mobile.md`: one React Native app with Expo; screens
  are written again, the client, types, query patterns and validation are reused.
- `rules/mobile-rules.md`: §1 one app, §2 reuse before rewriting, §3 no mock data, §4 testing.
- `rules/react-ui-rules.md` §3 *API Integration*, §4 *TanStack Query*, §5 *State, Effect,
  Form*: they apply to the phone app as written.
- `rules/architecture-rules.md` §2 *Contract-First API Architecture*: the phone calls only
  the generated client.
- `rules/ux-rules.md`: the product's UX rules hold on the phone. The web app's 390-pixel
  layouts, already reviewed by Derek, are the starting design for every phone screen.

## 2. What the First Release Covers

The app is built in slices by **audience** (member, then commissioner) and by **plan** (Free,
then the paid plans), per Derek 2026-11-09: member and Free first, then decide how much more.
What each plan unlocks is `PLAN_CONFIG` (`packages/core-api/src/modules/plans/plan-settings.ts`);
the app reads the league's entitlements from the API like the web does and never keeps its
own list.

Rough size, counted from the web app's pages: about 30 member screens (including 7 pick
screens, one per selection type), about 8 of them paid-plan only, about 20 commissioner
screens, and 31 root admin screens that never come to the phone.

**First release: member, Free plan.**

- Sign up, sign in, sign out, forgot password, and a remembered sign-in.
- League switcher, league home, contests (this year), contest page, rules and How to Play.
- Entries and picks for every selection type: Tiered, Budget, Quick pick, Pick'em (straight
  up and confidence), Bracket, Survivor and Squares. Every type is on Free.
- Live leaderboards for each scoring family and squad standings.
- My team, joining a league or a team from an invite link.
- My account: profile, time zone and display settings, email preferences, appearance, and
  account deletion (an App Store requirement, §13).
- Dark mode (§7) and universal links (§6).
- Push for the Free notices only: contest opened, entry received, results, event changed (§10).

A paid-plan league still works in the first release: its members get everything above. Paid
screens show a short "open on the website" line in their place, never a price (§13).

**Later, decided after the first release:**

- **Member, paid plans.** Championship and cup standings, cup crowning, the trophy case,
  past years (Pro); the all-time summary and record book (Premium); push for the Pro notices
  (entry reminders, contest started, standings, event coming up, member joined).
- **Commissioner, light.** Open and close a contest, run a draw, invite members, manage
  squads.
- **Commissioner, full.** Contest setup, league settings, event emails, championship
  settings. Recommend these stay on the web: long forms, used weekly at most.

**Never on the phone:** root admin (`/manage`), billing and plan purchases (§13), and the
public event pages (`/play/...`), whose job is link previews and search. A universal link to
an event page still opens the app when it is installed.

## 3. Repository Layout

```
clients/
  poolmaster/        web app (unchanged home)
  mobile/            the Expo app: app/ (Expo Router screens), src/features, src/ui
packages/
  shared/            DTOs, domain, generated hey-api client (unchanged)
  client-core/       NEW: what both apps run, below the screen (§4)
  design-tokens/     NEW: the palette and colour roles, light and dark (§7)
```

- npm workspaces already include `clients/*`, so `clients/mobile` joins the install
  automatically. Expo supports monorepos and configures Metro for them.
- The root `lint`, `typecheck` and test scripts, the turbo filters and the CI workflow gain
  `clients/mobile` and the two new packages.
- **One React version across the repo.** Expo pins React and React Native per SDK. The web
  app moves with it rather than running a different React, because two copies of React in
  one install break hooks in subtle ways. If Expo lags behind a React release, the web waits.
- Expo packages are upgraded together with `npx expo install --fix`, not one by one; the
  `dependency-updates` skill gains that step and Dependabot groups Expo packages.

## 4. Shared Code: `@poolmaster/client-core`

`rules/mobile-rules.md` §2 says logic both apps need moves into a shared package. Today it
lives in `clients/poolmaster/src`, mixed with browser-only code. The package takes:

| Moves to `client-core` | Stays per app |
|---|---|
| API client setup as a factory: base URL, trace and request-id headers, the single-flight refresh, error envelope parsing (`lib/api.ts`, `lib/errors.ts`) | How the token travels: web cookie plus CSRF, phone Bearer plus keychain |
| Query keys (`lib/query-keys.ts`), query defaults, mutation invalidation (`lib/mutation-hooks.ts`) | Screens, layout, navigation |
| Query and mutation hooks that features share (`use-leagues-query`, `use-contest-entries`, `use-game-picks`, `sport-events-query`, ...) | Primitives and styling |
| Form schemas (zod) and form-to-request mapping (`create-league-form.ts` and the like) | Gestures, haptics, device APIs |
| Pure contest logic: `contest-status.ts` and its poll interval, `squares-board.ts`, `bracket-layout.ts`, `pick-em-week.ts`, leaderboard column rules, the scoring-family UI registry's data half | |
| Date and time formatting and display preferences (`date-time-format.ts`) | |
| The logger's core and redaction; sinks per platform | The console and network sinks' transport |

How it moves:

- **Move, never copy.** Each piece moves when the first phone screen needs it, and the web
  app imports it from the package in the same PR. The copy detector
  (`rules:check:duplicates`) stays the backstop.
- The package has no DOM and no React Native imports. A lint rule bans both, so a browser
  call cannot sneak in.
- Its tests move with it and keep the per-file coverage floors.
- Product copy stays in the feature that owns it, per `ux-rules.md`; strings both apps show
  (contest rule text, selection type names) already live in `packages/shared/domain`.

## 5. API Client and Sign-In

- **The API already supports the phone.** `auth-guard.ts` reads a `Bearer` header before the
  cookie and skips the CSRF check for Bearer requests. Login and register return
  `accessToken`, `refreshToken` and `expiresIn` in the body, and refresh and logout take
  `refreshToken` in the body.
- **Where tokens live.** The refresh token goes in the keychain through `expo-secure-store`;
  the access token stays in memory only. A cold start refreshes once before the first
  screen loads.
- **One refresh at a time.** The web app's single-flight refresh (rotation refuses a second
  use of a refresh token) moves into `client-core` and serves both apps.
- **Signed out elsewhere.** A refused refresh clears the keychain and returns to sign-in,
  with the screen the member was on kept for after sign-in.
- **Base URL per build.** QA builds call `https://qa.ultimateofficepoolmanager.com`;
  production builds call the production API once it exists (#917 is on hold, so the first
  TestFlight builds point at QA). Set by `EXPO_PUBLIC_API_BASE_URL` per EAS build profile.
- **Logs.** The phone sends its errors to the same client-logs endpoint with the same trace
  and request ids (ADR-0005), so a phone failure appears in the backend logs beside its
  requests.
- **Old app versions.** Unlike the web, an installed app keeps running old code for weeks.
  API changes must stay additive for released app versions (a new field is fine; a renamed
  one is not). The version endpoint gains a minimum supported app version, and the app
  asks the member to update when it is below it. This needs a line in `service-rules.md` §4.

## 6. Screens, Navigation and Links

- **Expo Router** (file-based, built on React Navigation). Screen paths follow the web
  app's URLs (`/league/:code/contests/:id`, ...), so one link means the same page on both.
- **Tabs for the member's day**: Home (league home), Contests, My Team, Account. The league
  switcher sits in the header, as on the web.
- **Universal links.** Emails and shared links point at the website. The site serves
  `/.well-known/apple-app-site-association` (and `assetlinks.json` for Android) so those
  links open the app when it is installed and the website when it is not. Pages the app does
  not have fall back to the website.
- **The web stays a link away.** A commissioner tool opens on the website in the in-app
  browser. That browser has its own cookies, so the member signs in once more there; a
  hand-off sign-in link is possible later and is listed in §15.

## 7. Theme, Dark Mode and the UI Kit

### One source for colours

Today the colours have two homes, kept in step by a test: `globals.css` for the app and
`BRAND_COLORS` in `packages/shared/domain/brand.ts` for email and link previews
(`react-ui-rules.md` §5 *Theme And Styling Discipline*). A phone app would make a third.

Recommendation: a typed token file in `packages/design-tokens` becomes the one source:

- The raw palette (navy, gold, red, graphite, paper, field blue, ...).
- Every colour role (`surface-raised`, `text-label`, `status-active-surface`, ...) for light
  and dark, written as a palette colour or a mix of one (the CSS uses `color-mix`, which
  React Native cannot read, so the tokens say "gold-400 at 16%" and each renderer turns that
  into its own form).
- A generator writes the colour block of `globals.css`; CI fails when the checked-in file
  differs, as `api:check` does for the client. `BRAND_COLORS` reads from the tokens, which
  retires the mirror test.
- The phone app gets a typed `theme.colors.surfaceRaised` per scheme.

Issue: three hand-kept copies of the palette would drift. Benefit: a palette change is one
edit that reaches the site, the emails and the app together.

### Dark mode

- The app follows the phone's setting through `useColorScheme`, as the site follows
  `prefers-color-scheme`. When the Appearance setting (#1471) lands, the app reads the same
  account setting.
- Graphite pages and cards, the navy header and scoreboard, muted gold: the same roles,
  so the app needs no dark-mode design of its own.
- The status bar and the navigation bar follow the scheme.

### Styling approach

Recommendation: React Native `StyleSheet` with a typed `useTheme()` hook, not a Tailwind
layer such as NativeWind.

Issue: the web's class strings do not carry over anyway, since every screen is written again.
NativeWind adds a compile step, its own emulation of CSS variables and dark mode, and ties
the phone to a Tailwind major the web may not be on (the web is on Tailwind 3).
Benefit: typed tokens give autocomplete and a type error for a wrong colour name, and a
lint rule like `poolmaster/no-raw-theme-colors` bans hex literals in feature code, as on the
web.

### The phone UI kit (`clients/mobile/src/ui`)

Same names and, where they make sense, the same props as `features/shared/ui`, so a screen
reads alike in both apps and `shared/ui/README.md` describes both:

- Text: `Heading` (same `variant`s: hero, display, page, section, subtitle, label, eyebrow,
  card), `Eyebrow`, `Text` with the theme's sizes. Caps and italics follow the house type
  style in `react-ui-rules.md` §5.
- Surfaces: `Tile` (default, inverse, inverseDeep), `SectionCard` (with `SectionRows`).
- Actions: `Button` and `LinkButton` (variants and `layout="row"`), `MenuItem`, `CopyButton`
  (the system share sheet as well as copy).
- Status: `Chip`, `StatusBadge`, `Countdown`, `Progress`.
- States: `LoadingState`, `EmptyState`, `ErrorState`, `InlineError`, `QueryState`.
- Data: `SimpleTable` for small tables, a `LeaderboardList` for standings (§8), `FormField`
  wired to react-hook-form.
- Overlays: `Modal` as a bottom sheet, `ConfirmDialog`, `Toast`.

Shared look, native feel: system back gestures, pull to refresh, native pickers for dates
and choices, haptics on a pick.

### Fonts, icons, drawings

- Archivo, Inter and Barlow Condensed are bundled with `expo-font`, not fetched at launch.
- Icons are Lucide on both sides (`lucide-react-native`), with the same names.
- The How to Play and sport drawings (`illustrations.tsx`) are SVG built from React
  elements. They move to `react-native-svg` shapes with the colours from the
  `--illustration-*` roles in the token file. The drawing data (shapes per sport) can be
  shared through `client-core` if each scene is described as data rather than JSX; the
  first ticket decides by trying one sport.
- The app icon and splash come from the existing navy and gold favicon.

## 8. The Hard Screens

Most screens are lists and forms. Four need more thought:

- **Leaderboards.** The web uses `DataGrid` with a scoreboard header. On a phone a wide table
  becomes rows: rank, name and total, tap to expand the detail, the member's own row pinned.
  Long fields use FlashList so a 500-entry contest scrolls smoothly.
- **Squares.** A 10-by-10 grid is too small to tap at phone width. It gets pinch to zoom and
  pan (`react-native-gesture-handler` with Reanimated), and the member's squares stand out.
- **Bracket.** The full tree does not fit. The phone shows one round at a time, swiped left
  and right, with the path of the member's champion highlighted.
- **Ranked lists** (confidence pick'em, the web's `SortableList` on dnd-kit). Long-press to
  drag with Reanimated, plus up and down buttons for screen readers.

## 9. Live Data

- Polling stays as on the web: TanStack Query's `refetchInterval` from `contest-status.ts`
  (30 seconds while a contest is open or live).
- TanStack Query needs two adapters on a phone: `focusManager` wired to `AppState`, so
  polling pauses in the background and refreshes on return, and `onlineManager` wired to
  NetInfo, so the app waits out a lost signal instead of failing.
- Pull to refresh on every list.
- No websockets in the first release. Live standings already come from the leaderboard
  snapshots, and polling keeps the API simple.

## 10. Push Notifications

The one backend addition the app needs.

- **Device registration**: a `devices` table (user, Expo push token, the phone's native
  Apple or Google push token, platform, app version, last seen) and two routes, register and unregister, through the normal DTO, mapper,
  OpenAPI and contract-verification chain (`add-endpoint` skill).
- **Sending**: Expo's push service, which talks to Apple and Google for us, from a
  background job (`rules/architecture-rules.md` §4: no event bus; the notifications module
  calls the push service).
- **Keep the sender swappable** (Derek 2026-11-09). The notifications module sends through one
  small push sender port with an Expo adapter. Because the native token is stored from day
  one, moving to AWS SNS later is a new adapter, Terraform for the SNS platform applications
  (holding the Apple push key and the Firebase key) and pruning dead tokens ourselves, with no
  app release. Whether to move is a later decision; nothing for SNS is built now.
- **Infrastructure now**: one Secrets Manager secret for the Expo access token, passed to the
  API like the JWT secret. The API already reaches the internet through the NAT gateway.
  Outside AWS: the Apple Developer account (its push key is kept by EAS), the Expo project,
  and later a Firebase project for Android.
- **One notice, two channels.** The notices that already queue email (entry reminders, live
  standings, contest summaries, member joined) also queue a push, from the same
  computation, so nothing is worked out twice.
- **Preferences**: email preferences grow a push column per notice; a member turns each one
  off in the app or on the web.
- **Taps open the page**: each push carries the web URL of what it is about, and the router
  opens it.
- Push tokens and preferences are personal data: they are deleted with the account.

## 11. Testing and CI

Per `rules/mobile-rules.md` §4 and `rules/testing-rules.md`:

- **Unit and component**: Jest with the `jest-expo` preset and React Native Testing
  Library; MSW for request mocking, as on the web. The per-file floors (90% lines, 80%
  branches) apply from the first PR. `client-core` keeps its tests where it is.
- **Selectors**: `testID` follows `react-ui-rules.md` §9's naming, so tests read alike.
- **End to end**: Maestro. Flows are short YAML files, it runs on simulators and devices
  against a real API, and it runs in EAS Workflows on macOS machines we do not maintain.
  Detox was considered: more control, but it is wired into the native build and is slower
  to keep green.
- **CI**: lint, typecheck and unit tests for `clients/mobile` and the two packages join the
  existing required checks (they run on Linux). The iOS simulator needs macOS, so the
  Maestro suite runs nightly and before each store release on EAS, not on every PR.
- **Agents' limits**: agent containers cannot run an iPhone simulator or reach QA. Agents
  verify with unit tests in the container and with screenshots from EAS Maestro runs, which
  the PR attaches. Derek checks on his phone through TestFlight.

## 12. Build, Release and Environments

- **EAS Build** makes iOS and Android builds in the cloud; **EAS Submit** uploads them to
  TestFlight and Google Play; **EAS Update** ships JavaScript-only fixes without a store
  review.
- **Profiles**: `development` (a dev build for Derek's phone), `qa` (TestFlight internal,
  QA API) and `production`.
- **Update channels match profiles**, so a QA fix never reaches production phones. A change
  to native code bumps the runtime version, so an update only reaches builds that can run it.
- **Versioning**: EAS manages build numbers; the marketing version follows releases.
- **Secrets** (Apple and Expo credentials) live in EAS and GitHub secrets, never in the repo.
- **Accounts Derek needs**: Apple Developer Program ($99 a year), an Expo account (the free
  plan covers early builds; a paid plan when build minutes run short), and Google Play
  ($25 once) for the Android phase.

## 13. App Store Rules That Shape the Product

- **Account deletion** (guideline 5.1.1(v)): an app that creates accounts must let the member
  start deleting it in the app. The API has self-delete, but it requires the account to be
  deactivated first and no league data left. The app needs one "Delete my account" flow that
  walks through those steps.
- **Payments** (3.1.1): digital upgrades bought inside an iPhone app must use Apple's
  in-app purchase. Nothing is for sale today (Stripe is deferred), so the first release
  shows no prices and no buy buttons, and a league's plan simply shows what it includes.
  How to sell in the app is decided before Stripe ships (§15).
- **Sign in with Apple** is required only when an app offers another company's sign-in.
  Poolmaster has email and password only, so it is not required. Adding it later is an option.
- **Privacy labels and manifest**: the App Store listing declares what is collected (email,
  name, push token, diagnostic logs). The client-logs sink is diagnostics.
- **Review sign-in**: Apple reviewers need a working account on the API the build calls.
- **Gambling questions**: Poolmaster takes no money and pays nothing, which the review notes
  say plainly, since contest apps get asked.

## 14. Phases

Narrative order only; tickets and estimates come next. Phases 1 to 4 are the first release
(member, Free); after it Derek decides which of phases 5 to 8 to build.

1. **Foundations** (about a quarter of the first release). `design-tokens` with the generated
   `globals.css`; `client-core` with the API client factory, query keys, errors and logger
   core; the Expo app skeleton with fonts, theme, dark mode and the first primitives; CI
   checks; a TestFlight build that signs in and shows the member's leagues.
2. **Read** (member, Free). League home, contests, contest page, leaderboards for each
   scoring family, squad standings, my team, account basics, universal links, polling.
3. **Play** (member, Free; the largest phase). Picks for the seven selection types, sign up,
   joining from an invite link.
4. **Store ready.** Push for the Free notices (the devices table, register routes and the
   push sender are built once here), account deletion, minimum app version, privacy labels,
   App Store review.

Decision point: Derek looks at the first release and picks what comes next.

5. **Member, paid plans.** The championship, cup, trophy, past-year, all-time and record book
   screens, and push for the Pro notices (cheap once phase 4 has the sender).
6. **Android.** Same code: Play Console, Android back button and notification channels,
   adaptive icon, a Maestro pass on Android, release. Small, and can go any time after phase 4.
7. **Commissioner, light.** Open and close, run a draw, invites, squad management.
8. **Commissioner, full**, only if Derek wants it (§2 recommends the web).

Phases 2 and 3 split by feature, so several threads can build screens in parallel once
phase 1 has landed the kit.

## 15. Open Questions for Derek

Each has a recommendation; work that does not depend on the answer can start meanwhile.

1. **Colours in one typed file, generating `globals.css`.** Recommend yes (§7). It changes
   `react-ui-rules.md` §5 *Theme And Styling Discipline*, so it lands as its own PR first.
2. **Styling with typed `StyleSheet`, not NativeWind.** Recommend typed `StyleSheet` (§7).
3. **App name and IDs.** Recommend the store name "Primetime Commissioner" and bundle id
   `com.primetimecommissioner.app`; code names stay `poolmaster`.
4. **Where the first builds point.** Recommend QA for TestFlight until the production
   environment (#917) exists; the App Store release waits for production.
5. **Selling in the app, when Stripe ships.** Recommend the app keeps showing no prices and
   commissioners buy on the website, linking out where Apple allows it (US storefront) and
   saying nothing elsewhere. The alternative, Apple in-app purchase, costs 15–30% and a
   second billing path. Decide before Stripe's build.
6. **A hand-off from app to website sign-in** for commissioner tools, so a commissioner
   is not asked to sign in twice. Recommend later, after the first release.

## 16. Rules and Docs This Plan Changes

These land with the code that needs them, not ahead of it:

- `rules/mobile-rules.md`: the end-to-end tool (Maestro), the UI kit's home and naming,
  `client-core` and what may not import into it, the minimum app version.
- `rules/react-ui-rules.md` §5 *Theme And Styling Discipline*: colours come from
  `design-tokens`.
- `rules/service-rules.md` §4: API changes stay additive for released app versions.
- `rules/workflow-rules.md` §3: the mobile gates.
- The `dependency-updates` skill: Expo upgrades as one step.
- `clients/mobile/README.md` and the root `README.md`: setup, scripts, EAS profiles.
