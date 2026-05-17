# Order Management System

Backend service for an e-commerce platform with order management capabilities. Built with Express, Drizzle ORM, PostgreSQL + PostGIS, and organized as an Nx monorepo.

## Prerequisites

- **Node.js** v18+
- **Docker** — used to run PostgreSQL with the PostGIS extension in a container. You do **not** need PostgreSQL or PostGIS installed on your machine.

  **What to have ready before the session:**

  1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS/Windows) or Docker Engine (Linux) installed and **running** (the Docker daemon must be up — e.g. Docker Desktop shows “Running”).
  2. Port **5433** free on `localhost` (the database is mapped there; nothing else should be listening on that port).
  3. Enough disk space for the first image pull (~500MB for `postgis/postgis:16-3.4`).

  `npm run sys:init` starts the database container, waits for it to be healthy, enables PostGIS, runs migrations, and seeds data. No manual database setup is required beyond Docker being available.

## Quick Start

```bash
npm install
npm run sys:init
npm start
```

The API server will be available at `http://localhost:3000`.

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
docker compose up -d      # Start the database
docker compose down        # Stop the database
docker compose down -v     # Stop and delete all data (full reset)
```

### Full Reset

```bash
docker compose down -v
rm .env
npm run sys:init
```

## Project Structure

```
apps/
  oms-api/              # Express API entry point
libs/
  orders/               # Orders bounded context
  inventory/            # Inventory bounded context
  payments/             # Payments bounded context
  shared/
    database/           # DB connection, custom types, migrations
    util-errors/        # AppError + global error handler
    util-validation/    # Zod request validation
    request-logger/     # HTTP request logging
tools/
  database/
    setup-db.ts         # DB initialization and seed script
```
