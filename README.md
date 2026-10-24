# Affiliate Content OS

Deterministic development foundation, runtime process shells, and architecture boundary enforcement for Affiliate Content OS.

> **Status Notice:** This repository contains the deterministic monorepo foundation, configuration boundary (`@affiliate-content-os/config`), persistence foundation and migration engine (`@affiliate-content-os/infrastructure`), and three minimal runtime process shells (`apps/web`, `apps/api`, `apps/worker`). Application domain workflows, ORM, authentication, AI models, and social platform integrations do not exist yet.

## Prerequisites

- **Node.js**: `24.14.0` (Active LTS pinned in `.nvmrc`, engines range `>=24.14.0 <25.0.0`)
- **pnpm**: `12.4.2` (pinned via `packageManager` and engines in `package.json`)
- **Docker & Docker Compose**: Docker Compose v2+ for running local PostgreSQL 18.6 infrastructure

## Setup & Clean Checkout Sequence

From a fresh checkout without prior build artifacts, run the following exact sequence:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
corepack pnpm infra:up
corepack pnpm db:migrate
```

### Environment Ownership & Remediation

- `.env` is developer-owned and git-ignored. It is never committed to source control.
- If `.env` is missing, running commands requiring environment variables will fail fast with `Run corepack pnpm env:local`.
- Run `corepack pnpm env:local` to generate a fresh `.env` from `.env.example` without overwriting existing `.env` files.
- In CI workflows, job-scoped non-production environment variables are injected directly or generated dynamically.

Verify that local infrastructure and CI container image pins are identical:

```bash
corepack pnpm verify:infrastructure-pins
```

## Local PostgreSQL Infrastructure

Local persistence runs on PostgreSQL `18.6-bookworm` pinned by multi-platform image manifest digest (`sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`).

| Command                     | Description                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `corepack pnpm infra:up`    | Start PostgreSQL container in background, await healthcheck and 5 consecutive authenticated queries |
| `corepack pnpm infra:down`  | Stop and remove container, preserving local database volume (`acos_postgres_data`)                  |
| `corepack pnpm infra:logs`  | View live container logs for PostgreSQL                                                             |
| `corepack pnpm infra:reset` | Stop container and delete local database volume (`acos_postgres_data`)                              |

> [!WARNING]
> `infra:reset` permanently destroys the `acos_postgres_data` volume and all local database state. After running `infra:reset`, you must run `corepack pnpm infra:up` followed by `corepack pnpm db:migrate` to recreate the schema.

### Readiness Behavior

PostgreSQL initialization on empty volumes runs an internal temporary bootstrap server before starting the permanent server. `infra:up` uses a multi-stage readiness check:

1. Docker Compose healthcheck verifies that the process running as PID 1 inside the container is `postgres` (`/proc/1/comm`), ensuring health checks never report ready against the transient bootstrap process.
2. `infra:up` executes 5 consecutive successful authenticated SQL queries (`SELECT 1`) across the loopback network interface with a bounded 30-second timeout before reporting success.

## Database Migrations

Database schema evolution is strictly forward-only and managed via SQL files in `packages/infrastructure/migrations/`.

| Command                             | Description                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `corepack pnpm db:migrate`          | Apply all unapplied forward migrations within a transaction with advisory locking      |
| `corepack pnpm db:migrate:status`   | Display current migration state, recorded checksums, and execution timestamps          |
| `corepack pnpm db:migrate:validate` | Validate migration sequence integrity, gap-freedom, and SHA-256 checksums in isolation |

> [!IMPORTANT]
> The migration engine uses forward-only migrations. Down migrations are prohibited. Rollbacks are performed by creating a new forward migration. Migrations run as explicit pre-deployment CLI steps and are never automatically run on application process startup.

## Runtime Process Shells

The repository defines three independent runtime processes:

1. **Web Application Shell (`apps/web`)**: Next.js App Router application providing the root layout and landing page. It enforces server-only configuration boundaries and contains no application forms, dashboards, or external client-side calls.
2. **API Server Shell (`apps/api`)**: Fastify-based HTTP application exposing an operational `GET /health/live` liveness endpoint. It provides an import-safe application factory (`createApp`), loads validated configuration before binding, probes database connectivity on startup, and enforces genuinely bounded graceful shutdown via `SIGINT` and `SIGTERM` with deadline enforcement, error logging, and forced nonzero termination on close failure or timeout.
3. **Worker Runtime Shell (`apps/worker`)**: Pure event-driven Node.js worker runtime. It initializes with validated configuration, probes database connectivity on startup, and remains in an idle state using a real referenced runtime handle without polling, timers, or CPU spin until receiving cancellation via `AbortSignal` or termination signals (`SIGINT`, `SIGTERM`), exiting cleanly with code 0.

### Development Commands

Start individual processes in development mode:

```bash
corepack pnpm dev:web      # Next.js development server
corepack pnpm dev:api      # Fastify API server with tsx
corepack pnpm dev:worker   # Idle worker with tsx
corepack pnpm dev          # Run all three processes concurrently
```

### Production Build & Start Commands

Production startup requires building the workspace first:

```bash
corepack pnpm build        # Compile packages and build Next.js / Node artifacts
corepack pnpm start:web    # Run Next.js production server (next start)
corepack pnpm start:api    # Run Fastify production server (node dist/main.js)
corepack pnpm start:worker # Run worker production process (node dist/main.js)
```

### API Liveness Endpoint (`GET /health/live`)

When the API server is running, the operational liveness probe is available:

```bash
curl http://127.0.0.1:3001/health/live
```

Expected response (`200 OK`, `application/json`):

```json
{
  "status": "ok",
  "service": "api"
}
```

> [!NOTE]
> `GET /health/live` is a pure process-level liveness probe. It intentionally executes zero database queries to ensure orchestrator health probes do not saturate connection pools or trigger cascading failure when databases experience transient load. Readiness is validated on startup via `database.probe()` before the HTTP listener binds.

An unknown route returns standard Fastify `404 Not Found`.

## Quality Gates

The workspace enforces strict verification commands:

| Command                           | Description                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm format:check`               | Check code formatting via Prettier                                                       |
| `pnpm format`                     | Auto-format files via Prettier                                                           |
| `pnpm lint`                       | Lint codebase with ESLint and run architecture boundary checks                           |
| `pnpm lint:boundaries`            | Enforce architecture layer and dependency direction rules via dependency-cruiser         |
| `pnpm typecheck`                  | Run strict TypeScript type checking across source and tests for all packages and apps    |
| `pnpm test`                       | Run unit and boundary tests with Vitest                                                  |
| `pnpm test:integration`           | Run isolated PostgreSQL integration tests with Vitest                                    |
| `pnpm verify:infrastructure-pins` | Verify Docker Compose and CI image digest pins against remote registry                   |
| `pnpm build`                      | Compile package source and build production artifacts                                    |
| `pnpm check`                      | Run all quality gates in sequence (`format:check`, `lint`, `typecheck`, `test`, `build`) |

## Architecture Boundaries

Static dependency boundaries are checked and enforced via `dependency-cruiser` (`pnpm lint:boundaries`) using `.dependency-cruiser.js`.

### Enforced Rules

- **No Package-to-App**: Packages must never import from `apps/*`.
- **No App-to-App**: Apps must never import from other apps.
- **Web Isolation**: `apps/web` must not import internal backend packages (`packages/domain`, `packages/application`, `packages/infrastructure`).
- **No Test Support in Production**: Production source code must never import `packages/test-support`.
- **No Cross-Workspace Deep Imports**: Workspace imports must use public package exports (`@affiliate-content-os/config`), not relative `src/` paths.
- **Framework Isolation**: Next.js / React must not be imported by backend packages, and Fastify must not be imported by domain, application, contracts, or config packages.
- **No Cycles**: Circular internal dependencies are rejected.

Automated negative and positive boundary tests in `test/boundaries.test.ts` verify that forbidden edges are caught and flagged.

## Workspace Structure

```text
affiliate-content-os/
├── .github/
│   ├── workflows/ci.yml         # GitHub Actions CI workflow (Node 24 LTS, frozen lockfile)
│   └── pull_request_template.md
├── apps/
│   ├── api/                     # Fastify API application shell
│   │   ├── src/                 # createApp factory, server lifecycle, main entrypoint
│   │   ├── test/                # API factory & liveness endpoint tests
│   │   └── package.json
│   ├── web/                     # Next.js App Router application shell
│   │   ├── app/                 # Root layout, page, globals.css
│   │   ├── src/server/          # Server-only configuration bootstrap
│   │   ├── test/                # Web shell & bootstrap boundary tests
│   │   └── package.json
│   └── worker/                  # Idle Node.js worker runtime shell
│       ├── src/                 # Worker lifecycle, runner, main entrypoint
│       ├── test/                # Worker lifecycle & cancellation tests
│       └── package.json
├── docs/                        # Architectural specifications & decision records
├── packages/
│   ├── config/                  # Environment configuration boundary & redaction helper
│   │   ├── src/                 # Configuration validation, redaction, and types
│   │   ├── test/                # Configuration unit & security tests
│   │   └── package.json
│   └── infrastructure/          # Persistence foundation and database migration engine
│       ├── migrations/          # Contiguous, forward-only SQL migration scripts
│       ├── src/                 # Connection pooling, transaction runner, and health probe
│       ├── test/                # Unit and isolated PostgreSQL integration tests
│       └── package.json
├── scripts/                     # Cross-platform environment, infra-up, and pin scripts
├── test/
│   ├── boundaries.test.ts       # Architecture boundary verification test suite
│   ├── scripts.test.ts          # Scripts unit test suite
│   └── fixtures/boundaries/     # Fixtures for verifying forbidden dependency directions
├── tasks/                       # Task specifications (Codex)
├── .dependency-cruiser.js       # Dependency-cruiser architecture boundary rules
├── .editorconfig
├── .gitattributes               # LF line-ending normalization
├── .gitignore
├── .nvmrc                       # Pinned Node.js version (24.14.0)
├── compose.yaml                 # Pinned local PostgreSQL 18.6 service definition
├── eslint.config.mjs            # Flat ESLint configuration with boundary checks
├── package.json                 # Root workspace manifest & quality scripts
├── pnpm-lock.yaml               # Pinned dependency lockfile
├── pnpm-workspace.yaml          # Workspace package patterns (apps/*, packages/*)
├── tsconfig.base.json           # Strict TypeScript compiler options
├── vitest.config.ts             # Vitest unit test runner configuration
└── vitest.integration.config.ts # Vitest isolated integration test runner configuration
```

## Public Configuration Contract (`@affiliate-content-os/config`)

The `@affiliate-content-os/config` package establishes an immutable, fail-fast configuration boundary that validates environment input and exposes safe redaction helpers for startup logging.

### Boundary Principles

1. **Injected Environment**: `loadConfig(rawEnv?: unknown)` accepts an injected key-value record rather than reading `process.env` at module import time. Successive invocations are completely independent with no global caching.
2. **Strict Input Validation**: Missing arguments, `null`, arrays, primitives, and non-record inputs are rejected at runtime with `ConfigurationError` without leaking supplied values.
3. **Unknown Key Filtering**: Known configuration keys are extracted; arbitrary operating-system environment variables (such as `PATH` or cloud secrets) are ignored and excluded from returned configuration objects.
4. **Deep Immutability**: All returned configuration and metadata objects are frozen via `Object.freeze` and immutable to callers.
5. **Non-Disclosure**: Error messages, issue objects, stringified representations, and serialization formats never echo raw environment values, credentials, or sensitive inputs.

### Supported Environment Variables

| Variable       | Required | Type / Allowed Values                                                    | Default       | Rules & Constraints                                                                                                                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`     | Yes      | `'development'` \| `'test'` \| `'production'`                            | None          | Must be exact lowercase string. Missing, empty, whitespace-padded, or unsupported values are rejected.                                                                                                 |
| `LOG_LEVEL`    | No       | `'trace'` \| `'debug'` \| `'info'` \| `'warn'` \| `'error'` \| `'fatal'` | `'info'`      | Optional. When omitted, defaults to `'info'`. Unsupported casing, whitespace, or empty strings are rejected.                                                                                           |
| `APP_BASE_URL` | No       | `string` (valid absolute URL)                                            | None          | Must be absolute `http` or `https` URL without credentials (`user:pass`), query strings (`?q=`), or hash fragments (`#hash`). In `production` mode, `https` protocol is required (`http` is rejected). |
| `API_HOST`     | No       | `string` (valid IP or hostname)                                          | `'127.0.0.1'` | Optional. Host address for the API server listener. Defaults to `127.0.0.1`. Unsafe whitespace or control characters are rejected.                                                                     |
| `API_PORT`     | No       | `integer` (`1` - `65535`)                                                | `3001`        | Optional. Port number for the API server listener. Defaults to `3001`. Non-numeric, decimal, zero, negative, or out-of-range values are rejected.                                                      |

### Database Environment Variables

| Variable                         | Required                                                               | Type / Allowed Values                       | Default     | Rules & Constraints                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Required for API/worker database startup and integration entry points  | `string` (`postgres://` or `postgresql://`) | None        | Absolute database connection URL without query parameters or hash fragments. Must be local loopback when SSL is disabled. |
| `DATABASE_POOL_MAX`              | No                                                                     | `integer` (`1` - `50`)                      | `10`        | Maximum pool connections.                                                                                                 |
| `DATABASE_CONNECTION_TIMEOUT_MS` | No                                                                     | `integer` (`100` - `60000`)                 | `5000`      | Connection acquisition timeout in milliseconds.                                                                           |
| `DATABASE_IDLE_TIMEOUT_MS`       | No                                                                     | `integer` (`1000` - `300000`)               | `30000`     | Idle client eviction timeout in milliseconds.                                                                             |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | No                                                                     | `integer` (`100` - `300000`)                | `15000`     | Statement execution timeout in milliseconds. Set on every acquired client session.                                        |
| `DATABASE_SSL_MODE`              | Optional outside production, default `disable`; required in production | `'disable'` \| `'verify-full'`              | `'disable'` | SSL mode. In `production`, `'disable'` is strictly forbidden and `'verify-full'` is mandatory.                            |
| `DATABASE_SSL_CA_FILE`           | Required when `DATABASE_SSL_MODE=verify-full`; otherwise absent/empty  | `string` (absolute filesystem path)         | None        | Absolute filesystem path to a non-empty PEM CA bundle. Validated by entry points before pool construction.                |
| `MIGRATION_DATABASE_URL`         | Required only by migration/status/validation commands                  | `string` (`postgres://` or `postgresql://`) | None        | URL for migration commands. Never loaded or exposed by normal app runtime configuration.                                  |
| `TEST_DATABASE_ADMIN_URL`        | Required only by database integration/validation harnesses             | `string` (`postgres://` or `postgresql://`) | None        | URL targeting the `postgres` administrative database on a loopback test instance. Never loaded by production roots.       |
| `TEST_DATABASE_DISPOSABLE`       | Required only by destructive integration/validation harnesses          | `string`                                    | None        | Must equal the exact literal `YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED`.                                           |

### Database URL Separation & Isolation Policy

To establish explicit architecture boundaries and prevent accidental cross-contamination, three distinct database URLs are defined:

1. **`DATABASE_URL` (Application Runtime)**:
   - Used by `apps/api` and `apps/worker` to connect to application databases (`acos_dev`, `acos_prod`).
   - In production, this URL must connect with a least-privilege runtime principal that lacks administrative privileges to create or drop databases.
   - In the local-only TASK-003 development setup, the default `.env.example` and Compose configuration reuse the single bootstrap `acos_local` PostgreSQL superuser role for all three URLs. This demonstrates configuration boundary separation rather than local least-privilege role enforcement.
2. **`MIGRATION_DATABASE_URL` (Schema Migrations)**:
   - Used by `db:migrate` and `db:migrate:status` to apply forward migrations and inspect schema versions.
   - Separated from the application runtime pool to ensure migration credentials and lock parameters are never exposed to HTTP or worker request handlers. In production, this URL connects using a dedicated DDL migration principal.
3. **`TEST_DATABASE_ADMIN_URL` & `TEST_DATABASE_DISPOSABLE` (Test Isolation Harness)**:
   - Used strictly by `test:integration` and `db:migrate:validate` against non-production loopback/CI test instances.
   - In production, administrative credentials are never loaded or made available to runtime containers.
   - Requires `NODE_ENV=test`, strict host allowlisting (`localhost`, `127.0.0.1`, `::1`, or `postgres` in CI), URL path strictly `/postgres`, target database matching `^acos_test_[0-9a-f]{1,48}$`, and the exact sentinel `TEST_DATABASE_DISPOSABLE=YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED`.
   - Administrative helpers (`createIsolatedDatabase`, `dropIsolatedDatabase`) are restricted to internal testing and migration validation and are never exported in public production module boundaries.

> [!NOTE]
> Production environments strictly require distinct, least-privilege database roles for application runtime, schema migrations, and administrative tasks. Those distinct database roles and grants are managed as deployment infrastructure and are not provisioned by the local TASK-003 foundation.

### SSL & CA Certificate Handling

- `DATABASE_SSL_MODE`:
  - In `production`: `'verify-full'` is strictly required. `'disable'` is rejected at startup.
  - In `development` and `test`: `'disable'` is permitted for local loopback connections (`127.0.0.1`, `localhost`).
- `DATABASE_SSL_CA_FILE`:
  - When `DATABASE_SSL_MODE=verify-full`, `DATABASE_SSL_CA_FILE` must be an absolute path pointing to an existing, non-empty PEM-encoded CA certificate file.
  - The certificate content is validated and loaded into memory before connection pool initialization.

## Public Persistence Contract (`@affiliate-content-os/infrastructure/database`)

The persistence module provides connection pooling, health checks, transaction execution, and forward-only database migrations.

### Architectural Separation

1. **Domain Isolation**: `packages/domain` contains enterprise entities and pure business rules. It has zero dependencies on PostgreSQL, SQL drivers, or I/O.
2. **Infrastructure Boundary**: `packages/infrastructure` implements data persistence adapters, connection pools, and migration runners. Domain logic never accesses raw SQL or database connections directly.

### Exported Persistence API

```ts
import {
  createDatabase,
  DatabaseError,
  type Database,
  type DatabaseConfig,
  type TransactionExecutor,
  type DatabaseQueryResult,
} from '@affiliate-content-os/infrastructure/database';
```

- `createDatabase(config: DatabaseConfig, options?: CreateDatabaseOptions): Database`: Creates an operational database instance encapsulating pool management, query boundaries, and transaction execution.
- `database.query<T>(text: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<T>>`: Executes a parameterized SQL query without string interpolation.
- `database.withTransaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T>`: Executes an async callback inside an atomic `BEGIN` / `COMMIT` / `ROLLBACK` transaction. The callback receives a single-use `TransactionExecutor` which is invalidated upon transaction completion.
- `database.probe(signal?: AbortSignal): Promise<void>`: Executes a health check probe (`SELECT 1`) to verify database connectivity. Fully cancelable via AbortSignal without leaking connections.
- `database.close(): Promise<void>`: Idempotently closes the connection pool, preserving and returning the exact first close promise and outcome on repeated invocations.

## Process Lifecycle & Graceful Shutdown

Both `apps/api` and `apps/worker` enforce strict operational shutdown guarantees:

1. **Database Probe on Startup**: Before listening for HTTP traffic or entering the worker loop, the application verifies database connectivity via `database.probe(signal)`.
2. **Shared Shutdown Deadline**: A single monotonic 5000ms deadline bounds the entire graceful shutdown sequence:
   - For `apps/api`: Waits for in-flight startup probe and listener settlement, closes the Fastify HTTP listener, and closes the database connection pool within the shared budget.
   - For `apps/worker`: Awaits worker runtime settlement and closes the database connection pool within the shared budget.
3. **Forced Nonzero Exit**: If any step in the shutdown sequence fails or the deadline expires, the process forcefully terminates with exit code 1 to prevent zombie processes. Late listener bindings or late completion callbacks are prevented from reversing termination or logging success.

## Troubleshooting

### Docker / Infrastructure Issues

- **Health check timeout on `infra:up`**: Ensure Docker Desktop or Docker Engine is running and port `5432` is not occupied by a host PostgreSQL instance. Check container logs with `pnpm infra:logs`.
- **Database authentication failed**: Verify credentials in `.env` match `POSTGRES_USER` and `POSTGRES_PASSWORD`. If `.env` was modified after volume creation, run `pnpm infra:reset` to reinitialize the volume with new credentials.
- **Port 5432 already allocated**: Stop any host PostgreSQL services (`net stop postgresql` on Windows or `sudo systemctl stop postgresql` on Linux) or change `127.0.0.1:5432:5432` in `compose.yaml`.

### Migration Issues

- **`Migration checksum mismatch`**: Existing migration files must never be edited once applied. Roll forward by creating a new migration file.
- **`Missing required confirmation for test database`**: Ensure `TEST_DATABASE_DISPOSABLE=YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED` is present in your environment when running integration tests or validation.
