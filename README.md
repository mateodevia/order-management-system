# Order Management System (OMS)

A production-grade backend service for an e-commerce platform featuring a robust, minimal order management API. Built with Express, Drizzle ORM, PostgreSQL + PostGIS, and strictly organized as an Nx Modulith.

This project implements the core `POST /orders` flow, which handles:
- **Geospatial Fulfillment**: Uses PostGIS to dynamically route orders to the single closest warehouse capable of fulfilling all requested line items.
- **Pessimistic Inventory Locking**: Uses deterministic `SELECT ... FOR UPDATE` sorting to safely handle high-concurrency e-commerce flash sales without deadlocking.
- **Synchronous 3-Phase Execution**: Safely isolates database transactions from network I/O to protect connection pools.
- **Idempotency & Reconciliation**: Leverages database unique constraints to handle duplicate requests and a background reconciliation sweeper to heal from network crashes.

> 📖 **Architecture Deep Dive:** For a comprehensive review of the design patterns, ACID guarantees, crash prevention strategies, and how this architecture achieves Staff-level resilience, please read the [Architecture Decisions Record (ARCHITECTURE.md)](./ARCHITECTURE.md).

---

## Prerequisites

- **Node.js** v18+
- **Docker** — used to run PostgreSQL with the PostGIS extension in a container. You do **not** need PostgreSQL or PostGIS installed on your machine.

**What to have ready before starting:**

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS/Windows) or Docker Engine (Linux) installed and **running** (the Docker daemon must be up — e.g., Docker Desktop shows “Running”).
2. Port **5433** free on `localhost` (the database is mapped there; nothing else should be listening on that port).
3. Enough disk space for the first image pull (~500MB for `postgis/postgis:16-3.4`).

`npm run sys:init` starts the database container, waits for it to be healthy, enables PostGIS, runs migrations, and seeds data. No manual database setup is required beyond Docker being available.

---

## Quick Start

```bash
npm install
npm run sys:init
npm start
```

The API server will be available at `http://localhost:3000`.

For manual functional testing with curl or Postman, see [tools/database/API-TESTING.md](tools/database/API-TESTING.md). After `db:setup`, the seeder prints stable product UUIDs and scenario hints to the console.

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run sys:init` | One-command bootstrap: copies `.env`, starts Docker DB, runs migrations, and seeds data |
| `npm start` | Start the API server (dev mode with hot reload) |
| `npm run build` | Build the API for production |
| `npm run lint` | Lint all projects |
| `npm run db:generate` | Generate Drizzle migrations after schema changes |
| `npm run db:migrate` | Run pending database migrations |
| `npm run db:setup` | Run PostGIS extension setup, migrations, and seed data |

---

## Database

The project uses PostgreSQL with the PostGIS extension, running in Docker.

| Field | Value |
|-------|-------|
| Host | `localhost` |
| Port | `5433` |
| Database | `oms_db` |
| Username | `postgres` |
| Password | `postgres` |

### Docker Commands

```bash
docker compose up -d       # Start the database
docker compose down        # Stop the database
docker compose down -v     # Stop and delete all data (full reset)
```

### Full Reset

```bash
docker compose down -v
rm .env
npm run sys:init
```

---

## Project Structure (Nx Modulith)

The codebase strictly enforces module boundaries to prevent circular dependencies, separating the lightweight API entry point from core domain logic and shared utilities.

```text
apps/
  oms-api/              # Express API entry point & server setup

libs/
  # Bounded Contexts (Domain Logic)
  orders/               # Order orchestration, 3-phase flow, idempotency, reconciliation
  inventory/            # PostGIS warehouse routing, pessimistic inventory locking
  payments/             # Payment Gateway integration & mock client

  # Shared Libraries (Stateless & Cross-Domain Utilities)
  shared/
    database/           # DB connection, schema migrations, transaction helpers
    geocoding/          # Mock geocoding client for address -> lat/lng resolution
    monitoring/         # Custom logger, metrics client, and alerting
    types/              # Global domain types (e.g., LockedInventoryRow)
    util-circuit-breaker/ # Circuit breakers to protect the event loop from failing APIs
    util-errors/        # AppError + global error handler logic
    util-validation/    # Zod-based HTTP request validation
    request-logger/     # Express HTTP request logging middleware
    testing-utils/      # Jest configuration and test setup helpers

tools/
  database/
    setup-db.ts         # DB initialization and data seed script
```