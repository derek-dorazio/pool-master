# PoolMaster

Fantasy sports pool management platform. Create leagues, configure contests across any sport,
draft squads, and compete on live leaderboards.

Sport-agnostic by design: sports are configured through the domain model rather than
hard-coded sport logic. What is actually supported today is what the `Sport` enum and the
contest-format validity matrices in code say.

## Getting started

Prerequisites: Node.js (the version in `package.json` `engines`) and Docker, which
`dev:start` needs running before it starts.

```bash
npm install
npm run dev:start
```

`npm run dev:start` is the whole setup path. It starts the Docker services, applies
migrations, runs the bootstrap step and both dev servers, and prints every local URL it
started. Copy `.env.example` to `.env` first if you need non-default settings.

This README deliberately does not restate commands, the stack, or the directory layout:
`package.json` scripts are the command reference, the manifests are the stack, and the
filesystem is the layout. A copy of any of those in prose drifts, and the drifted copy is
the one people read.

## Where things are documented

| You want | Read |
|---|---|
| How to work in this repo — agents and humans alike | [`AGENTS.md`](AGENTS.md), which routes to the right file in [`rules/`](rules/) by task |
| Architecture, layers, and what each is forbidden to hold | [`rules/architecture-rules.md`](rules/architecture-rules.md) |
| The gates to run before a push | [`rules/workflow-rules.md`](rules/workflow-rules.md) §3 *Required Local Validation Before Push* |
| Why a durable decision was made | [`docs/adr/`](docs/adr/) |
| What each domain object permits, and to whom | [`docs/DOMAIN-OPERATIONS.md`](docs/DOMAIN-OPERATIONS.md) |
| CI jobs, branch protection, and gate failures | [`docs/CI-AND-QUALITY-GATES.md`](docs/CI-AND-QUALITY-GATES.md) |
| Runtime logs and how to query them | [`docs/LOGGING-OPERATIONS.md`](docs/LOGGING-OPERATIONS.md) |
| Email providers by environment | [`docs/EMAIL-DELIVERY.md`](docs/EMAIL-DELIVERY.md) |
| Sport and contest-format ideas (future, not built) | [`docs/CONTEST-RULES.md`](docs/CONTEST-RULES.md) |
| The backend modules | [`packages/README.md`](packages/README.md) |
| The web app | [`clients/poolmaster/README.md`](clients/poolmaster/README.md) |
| Deploying, and Terraform state hygiene | [`infrastructure/terraform/README.md`](infrastructure/terraform/README.md). The promotion model: QA deploys on every push to `main`; staging and prod are a manual `workflow_dispatch` of `deploy.yml` promoting an immutable QA image tag |
| The live API | `/apidoc` on any running backend |

## License

Private. All rights reserved.
