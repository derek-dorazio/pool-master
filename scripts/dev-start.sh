#!/bin/bash
# dev-start.sh — starts all Docker infrastructure, runs migrations, seeds, and launches services.
# Usage: npm run dev:start  (or ./scripts/dev-start.sh)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infrastructure/docker/docker-compose.dev.yml"

echo "=== PoolMaster Dev Startup ==="
echo ""

# --- 1. Copy .env if not present ---
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "[1/5] Creating .env from .env.example..."
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
else
  echo "[1/5] .env already exists, skipping"
fi

# --- 2. Start Docker containers ---
echo "[2/5] Starting Docker containers (postgres, redis, dynamodb)..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis dynamodb
echo "  Waiting for PostgreSQL to be ready..."
until docker exec docker-postgres-1 pg_isready -U postgres -q 2>/dev/null; do
  sleep 1
done
echo "  PostgreSQL is ready"

# --- 3. Generate Prisma client + run migrations ---
echo "[3/5] Running Prisma generate + migrate..."
cd "$PROJECT_ROOT/packages/core-api"
npx prisma generate --schema=prisma/schema.prisma 2>/dev/null
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster npx prisma migrate dev --skip-generate 2>&1 | grep -E "applied|already in sync|Your database"
cd "$PROJECT_ROOT"

# --- 4. Seed database ---
echo "[4/5] Seeding database..."
cd "$PROJECT_ROOT/packages/core-api"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/poolmaster npx prisma db seed 2>&1 | tail -2
cd "$PROJECT_ROOT"

# --- 5. Start all services ---
echo "[5/5] Starting all services..."
echo ""
echo "  Core API        → http://localhost:3000"
echo "  Draft Service   → http://localhost:3001"
echo "  Scoring Service → http://localhost:3002"
echo "  Ingestion       → http://localhost:3003"
echo "  Notifications   → http://localhost:3004"
echo "  Webapp          → http://localhost:5173"
echo ""
echo "  PostgreSQL      → localhost:5432"
echo "  Redis           → localhost:6379"
echo "  DynamoDB Local  → localhost:8000"
echo ""

npm run dev
