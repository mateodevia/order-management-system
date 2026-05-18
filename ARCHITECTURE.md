# Architecture Decisions Record

This document outlines the architectural decisions implemented in the Order Management System (OMS) project, comparing them against the original architectural plan described in the assessment brief. For each decision, we explain why it is a reasonable and optimal choice.

## 1. Decisions that Comply with the Original Architecture

### 1.1 Workspace & Codebase (Nx Modulith)

**Decision**: The project is structured as an Nx workspace with a thin application entry point (`apps/oms-api`) and domain logic encapsulated in bounded contexts (`libs/orders`, `libs/inventory`, `libs/payments`). Cross-domain calls strictly occur via root `index.ts` barrels.
**Reason**: This approach strictly enforces boundaries and prevents circular dependencies. It allows the monolith to remain modular, making it easy to split into microservices in the future if required, while keeping local development fast and cohesive. Furthermore, using separate modules with Nx enables powerful CI/CD optimizations, such as "affected" commands and computation caching, allowing the pipeline to test and build only the modules that actually changed rather than the entire repository.

### 1.2 Database Engine (PostgreSQL) & ACID Guarantees

**Decision**: PostgreSQL is selected as the primary relational database, and Drizzle ORM is used for type-safe schema definitions (`drizzle-kit`).
**Reason**: 
- **ACID Behavior**: E-commerce order fulfillment requires strict ACID properties. When allocating inventory and inserting order records, the database must guarantee atomicity (all or nothing) and isolation (preventing race conditions where multiple orders over-allocate stock). A relational database naturally provides these guarantees without requiring complex application-layer distributed transactions or eventual consistency patterns for the core inventory decrement.
- **Data Access**: Drizzle provides high performance by generating SQL with minimal overhead, while ensuring end-to-end TypeScript safety. It also seamlessly allows native SQL execution via template literals for advanced queries like PostGIS distance functions and row locking, which ORMs typically abstract away poorly.

### 1.3 Geospatial Fulfillment & Inventory Locking

**Decision**: Fulfillment routing aggregates across requested SKUs to find a single warehouse capable of fulfilling the entire order. It selects the closest warehouse using PostGIS `ST_Distance`. Inventory is locked using `SELECT ... FOR UPDATE` (without `SKIP LOCKED`), and rows are fetched deterministically by sorting `productId` alphabetically. A `3000ms` statement timeout is set for the Phase 1 transaction.
**Reason**:

- **PostGIS**: Provides highly accurate spheroidal distance calculations at the database layer (O(log N) with GiST indexes).
- **Deadlock Prevention via Deterministic Sorting**: In `allocateInventoryGeospatially`, order items are lexically sorted by `productId` before lock acquisition. This ensures that concurrent transactions locking overlapping subsets of products always acquire row-level locks in the exact same order, mathematically eliminating the possibility of cyclic deadlocks.
- **Statement Timeouts**: A `3000ms` `statement_timeout` is explicitly set. This prevents rogue queries or sustained lock contention from indefinitely holding database connections, which would eventually exhaust the pool and bring down the API.
- **Pessimistic Locking (`FOR UPDATE`) vs Optimistic Locking**: We use pessimistic locking (`FOR UPDATE`) instead of optimistic locking (e.g., using version numbers). In an e-commerce scenario with high contention (like a flash sale or limited stock event), optimistic locking leads to a high rate of transaction rollbacks, which requires complex application-level retry storms or degrades user experience with immediate failure messages. Pessimistic locking handles high concurrency gracefully by queuing concurrent requests sequentially at the database engine level, ensuring safe, deterministic inventory allocation without excessive rollbacks.
- **No `SKIP LOCKED`**: Ensures that we do not mistakenly "skip" valid inventory simply because another transaction is currently modifying it. Instead, we wait for the lock.
- **Read Committed Retries**: Re-verifies inventory levels if the snapshot becomes stale while waiting for the lock, guaranteeing accuracy.

### 1.4 The 3-Phase State Machine & Synchronous Flow

**Decision**: Order creation strictly separates Database and Network I/O.

- **Phase 1**: Database reservation (creates `PENDING_PAYMENT` order and decrements inventory). Connection is released.
- **Phase 2**: External Payment Gateway charge. No database connection is held.
- **Phase 3**: State resolution (updates to `PAID` or compensates inventory and marks `FAILED`).
  **Reason**: Holding a database connection while waiting for an external HTTP request (like a payment gateway) is a notorious anti-pattern that leads to connection pool exhaustion. Separating these phases ensures high throughput and resilience.

### 1.5 Idempotency via Database Constraints

**Decision**: Idempotency is enforced natively using a `UNIQUE` index on `orders.idempotency_key`. Concurrent duplicate requests result in a `23505` constraint violation, which the application catches to reconstruct the appropriate recovery response.
**Reason**: Eliminates the need for a distributed cache (like Redis) or distributed locking mechanism. The database's ACID properties naturally serialize the race conditions.

### 1.6 Reconciliation Sweeper

**Decision**: A background worker polls for `PENDING_PAYMENT` orders older than 5 minutes (or scheduled for retry), checks their status against the payment gateway, and transitions their state appropriately. It uses `FOR UPDATE SKIP LOCKED` to safely parallelize the cron job if scaled horizontally.
**Reason**: Ensures eventual consistency if the server crashes during Phase 2 or Phase 3. Using `SKIP LOCKED` is perfectly suited here because if another worker is already processing the row, we should just skip it and process the next stale order.

### 1.7 Resilience & Crash Prevention (Node.js)

**Decision**: The system employs strict strategies to prevent Node.js process crashes.
**Reason**:

- **Async Error Handling**: Node.js crashes are often caused by unhandled promise rejections. The project uses `express-async-errors` to automatically catch asynchronous exceptions in Express route handlers and safely forward them to the global error handler (`error-handler.ts`), guaranteeing the server stays alive.
- **Circuit Breakers**: External network calls (Payment Gateway, Geocoding) are wrapped in a Circuit Breaker pattern. In distributed systems, relying directly on synchronous third-party APIs is dangerous; a degraded payment gateway can cause connection timeouts to spike, exhausting the Node.js event loop and connection pools, leading to a cascading failure of our own API. The circuit breaker trips and fails fast when error thresholds are exceeded, allowing the system to degrade gracefully rather than fail catastrophically.

### 1.8 Observability & Monitoring

**Decision**: The system integrates structured logging, metrics, and targeted alerting (e.g., custom logger, `sendMetric`, `sendAlert`).
**Reason**: A staff-level architecture must be built for "Day 2" operations. Visibility into the system's runtime behavior is crucial for triaging issues rapidly in production.
- **Metrics**: Capturing business and operational metrics (e.g., `inventory.allocation.duration_ms`) allows for setting up dashboards to monitor SLA/SLO compliance and detect performance regressions.
- **Structured Logging**: Facilitates log aggregation and searching.
- **Targeted Alerts**: Instead of alerting on every transient failure, the system sends critical alerts for states requiring manual intervention, such as when an order exceeds max reconciliation retries and enters the Dead Letter Queue (DLQ).
