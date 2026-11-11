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
npm run gallery --workspace=@poolmaster/poolmaster        # component gallery on :6006
npm run gallery:build --workspace=@poolmaster/poolmaster  # static copy in storybook-static/
```

## Component Gallery

- Every shared UI component has a Storybook story beside it (`button.stories.tsx` next to
  `button.tsx` and `button.test.tsx`). The toolbar switches Light and Dark and the viewport
  menu Phone 390 and Desktop 1280. The rule is `rules/react-ui-rules.md` *Component Gallery*.
- Dev only: `src` never imports a story, so the app bundle carries none, and stories are left
  out of coverage.
- CI builds the gallery in `poolmaster-build`, so a story that no longer fits its component
  fails there, and keeps the build as the run's `component-gallery` artifact.
- The published copy is a private Artifact,
  https://claude.ai/artifact/6TLWdXH5ggputdaXaxD9BS. To refresh it, run `gallery:build`, then
  `node scripts/prepare-gallery-copy.mjs <out-dir>` here, and publish `<out-dir>/index.html` to
  that URL with `root` `<out-dir>` and the `files` listed in `<out-dir>/files.json`.

## Build Metadata

- Production builds emit `dist/version-info.json`.
- The file records the deployed webapp version, generated client SDK version, service version, git SHAs, build number, build time, and release-prefix context.
- App code reads the same metadata, compiled in at build time, through `getEmbeddedVersionInfo()` in [src/lib/version-info.ts](./src/lib/version-info.ts); the client logger stamps every entry with its webapp version.

## Event Page Link Previews

- With `POOLMASTER_WEBAPP_URL` set (the QA deploy sets it), the build also writes `dist/play/<sport>/<slug>/index.html` for each event page with copy: the app's `index.html` with that page's Open Graph tags. CloudFront serves these only to link-preview crawlers.
- Each event page needs a preview image in `public/og/`. After adding or changing a page's copy, run `node scripts/render-link-preview-images.mjs` here and commit the image; a unit test fails while one is missing.

## Important

- `clients/_archived/web` is archived reference material only.
- `clients/admin` has been retired and removed.
