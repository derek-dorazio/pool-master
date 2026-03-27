#!/bin/bash
# dev-start.sh — starts all Docker infrastructure, runs migrations, seeds, and launches services.
# Usage: npm run dev:start  (or ./scripts/dev-start.sh)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker/docker-compose.dev.yml"

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║              PoolMaster — Dev Environment                   ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# --- 1. Copy .env if not present ---
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo -e "${CYAN}[1/5]${RESET} Creating .env from .env.example..."
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
else
  echo -e "${CYAN}[1/5]${RESET} .env exists ${DIM}(skipping)${RESET}"
fi

# --- 2. Start Docker containers ---
echo -e "${CYAN}[2/5]${RESET} Starting Docker containers..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis dynamodb 2>&1 | tail -3
echo -n "       Waiting for PostgreSQL..."
until docker exec docker-postgres-1 pg_isready -U postgres -q 2>/dev/null; do
  sleep 1
done
echo -e " ${GREEN}ready${RESET}"

# --- 3. Generate Prisma client + run migrations ---
echo -e "${CYAN}[3/5]${RESET} Running Prisma migrations..."
cd "$PROJECT_ROOT/packages/core-api"
npx prisma generate --schema=prisma/schema.prisma 2>/dev/null
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster npx prisma migrate dev --skip-generate 2>&1 | grep -E "applied|already in sync|Your database" | head -1
cd "$PROJECT_ROOT"

# --- 4. Seed database ---
echo -e "${CYAN}[4/5]${RESET} Seeding database..."
cd "$PROJECT_ROOT/packages/core-api"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster npx prisma db seed 2>&1 | tail -1
cd "$PROJECT_ROOT"

# --- 5. Print endpoints and start services ---
echo -e "${CYAN}[5/5]${RESET} Launching services..."
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║  SERVICES                                                   ║${RESET}"
echo -e "${BOLD}╟──────────────────────────────────────────────────────────────╢${RESET}"
echo -e "${BOLD}║${RESET}  ${GREEN}Webapp${RESET}            ${BOLD}http://localhost:5173${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${GREEN}Core API${RESET}          ${BOLD}http://localhost:3000${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Draft Service${RESET}     ${DIM}http://localhost:3001${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Scoring Service${RESET}   ${DIM}http://localhost:3002${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Ingestion Worker${RESET}  ${DIM}http://localhost:3003${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Notifications${RESET}     ${DIM}http://localhost:3004${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}╟──────────────────────────────────────────────────────────────╢${RESET}"
echo -e "${BOLD}║  INFRASTRUCTURE                                             ║${RESET}"
echo -e "${BOLD}╟──────────────────────────────────────────────────────────────╢${RESET}"
echo -e "${BOLD}║${RESET}  ${YELLOW}PostgreSQL${RESET}        localhost:${BOLD}5432${RESET}  ${DIM}poolmaster/postgres${RESET}    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${YELLOW}Redis${RESET}             localhost:${BOLD}6379${RESET}                        ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${YELLOW}DynamoDB Local${RESET}    localhost:${BOLD}8000${RESET}                        ${BOLD}║${RESET}"
echo -e "${BOLD}╟──────────────────────────────────────────────────────────────╢${RESET}"
echo -e "${BOLD}║  TOOLS                                                      ║${RESET}"
echo -e "${BOLD}╟──────────────────────────────────────────────────────────────╢${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Prisma Studio${RESET}      ${DIM}npm run db:studio${RESET}                    ${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Mailpit UI${RESET}        ${DIM}http://localhost:8025  (npm run dev:infra:all)${RESET}${BOLD}║${RESET}"
echo -e "${BOLD}║${RESET}  ${DIM}Push Mock Log${RESET}     ${DIM}http://localhost:3099/push-log${RESET}       ${BOLD}║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${DIM}Press Ctrl+C to stop all services${RESET}"
echo ""

npm run dev
