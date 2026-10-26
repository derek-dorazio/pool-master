# PoolMaster Web App

This is the single active React web application for PoolMaster.

## Direction

- Build all new web functionality here.
- Use the generated `hey-api` client and exported shared types.
- Do not mirror backend DTOs locally.
- Do not add mock or fake runtime data to application code.

## Commands

```bash
npm run dev --workspace=@poolmaster/poolmaster
npm run build --workspace=@poolmaster/poolmaster
npm run test --workspace=@poolmaster/poolmaster
npm run test:coverage --workspace=@poolmaster/poolmaster
```

## Build Metadata

- Production builds emit `dist/version-info.json`.
- The file records the deployed webapp version, generated client SDK version, service version, git SHAs, build number, build time, and release-prefix context.
- App code can read the deployed metadata via `getVersionInfo()` from [src/lib/version-info.ts](./src/lib/version-info.ts).

## Event Page Link Previews

- With `POOLMASTER_WEBAPP_URL` set (the QA deploy sets it), the build also writes `dist/play/<sport>/<slug>/index.html` for each event page with copy: the app's `index.html` with that page's Open Graph tags. CloudFront serves these only to link-preview crawlers.
- Each event page needs a preview image in `public/og/`. After adding or changing a page's copy, run `node scripts/render-link-preview-images.mjs` here and commit the image; a unit test fails while one is missing.

## Important

- `clients/_archived/web` is archived reference material only.
- `clients/admin` has been retired and removed.
