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
- The file records the deployed webapp version, service version, git SHAs, build time, and release-prefix context.
- App code can read the deployed metadata via `getVersionInfo()` from [src/lib/version-info.ts](/Users/DDorazio/Library/CloudStorage/OneDrive-CURRICULUMASSOCIATESLLC/Documents/Claude/pool-master/clients/poolmaster/src/lib/version-info.ts).

## Important

- `clients/_archived/web` is archived reference material only.
- `clients/admin` has been retired and removed.
