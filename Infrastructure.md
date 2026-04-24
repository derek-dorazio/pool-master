# PoolMaster Infrastructure

`Infrastructure.md` is now a thin pointer so we do not keep stale
infrastructure guidance in multiple places.

Current source-of-truth docs:

- [README.md](./README.md)
  Local development quick start, active runtime shape, and deployment overview.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
  System architecture, active infrastructure dependencies, and runtime design.
- [docs/DEVELOPER-SETUP.md](./docs/DEVELOPER-SETUP.md)
  Local developer setup, Docker services, database/test workflow, and commands.
- [infrastructure/terraform/README.md](./infrastructure/terraform/README.md)
  Shared-environment Terraform workflow and environment-state rules.

Current runtime truth:

- PoolMaster uses PostgreSQL as the active system of record.
- PoolMaster uses an in-process event bus.
- PoolMaster does not currently depend on Redis.
- PoolMaster does not currently depend on DynamoDB for local, QA, or production runtime paths.
