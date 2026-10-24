# TASK-003 - PostgreSQL, Persistence, Local Infrastructure, and CI Foundation

Status: Approved by Product Owner

Owner: Antigravity (Implementation Engineer)

Depends on: approved and merged `TASK-002`

## Objective

Establish the tested PostgreSQL and persistence foundation for the modular monolith so later identity, workspace, and product slices can add repositories and business migrations without redesigning configuration, connection ownership, transactions, migration execution, integration-test isolation, or CI.

This slice must add reproducible local PostgreSQL infrastructure, an architecture-consistent database module in `packages/infrastructure`, validated database configuration in `packages/config`, forward-only migrations, real-PostgreSQL integration tests, and PostgreSQL-aware CI gates. It must prove the complete foundation from an empty database while adding no product or tenant schema.

Do not implement authentication, authorization, users, workspaces, tenancy, products, AI, content, approval, scheduling, publishing, analytics, social-platform behavior, queues, or feature repositories.

## Context

`origin/main` is at `fcd9a36` (`Agy/task 002 runtime foundation (#2)`) and is identical to the clean local `main` inspected for this specification. The repository currently has:

- Node.js `24.14.0` and `pnpm` `12.4.2` pinned;
- Next.js, Fastify, and idle worker process shells;
- `@affiliate-content-os/config` with injected-environment validation and safe redaction;
- dependency-cruiser rules for the approved package graph; and
- a read-only GitHub Actions quality job running `pnpm check`.

It has no database dependency, database configuration, persistence package, migration system, container configuration, integration-test database, or CI PostgreSQL service.

The governing documents require PostgreSQL as the system of record, explicit transactions, forward-only separately applied migrations, repository integration tests against real PostgreSQL, isolated environment databases, and dependency/container security scans. The relevant sources are:

- `AGENTS.md`;
- `docs/ARCHITECTURE.md`, especially sections 2-7, 15, 17-21;
- `docs/DATABASE.md`, especially conventions, concurrency rules, and migration/recovery requirements;
- `docs/DECISIONS.md`, especially ADR-001, ADR-002, ADR-003, ADR-008, ADR-017, ADR-019, and ADR-020;
- `docs/API.md` only to preserve the current HTTP boundary; and
- `tasks/TASK-001.md` and `tasks/TASK-002.md` for existing toolchain, configuration, runtime, and quality-gate contracts.

Use PostgreSQL `18.6` for local development and CI. The Compose service must use the official Debian Bookworm image identified by `postgres:18.6-bookworm` and pin its immutable multi-platform manifest-list digest in the committed configuration; a tag alone, `latest`, a floating major tag, or a platform-specific child-manifest digest is insufficient. Retain Node.js `24.14.0` and `pnpm` `12.4.2`. Any required deviation must be reported before implementation and approved rather than silently changing the baseline.

This task creates the first real `packages/infrastructure` code, specifically its database foundation. That placement follows the approved architecture: PostgreSQL clients and repositories belong in infrastructure, apps are composition roots, and domain/application code must not depend on infrastructure. Do not add a new architectural layer named `packages/database` and do not create empty future packages.

## Required implementation

### 1. Preserve the modular-monolith and toolchain baseline

1. Keep the three existing process types and current workspace structure. PostgreSQL is one shared system of record, not a separate service-owned database.
2. Keep Node.js `24.14.0`, `pnpm` `12.4.2`, strict TypeScript, ESM, Vitest, ESLint, Prettier, and dependency-cruiser unless a blocking incompatibility is demonstrated.
3. Use exactly `pg@8.23.1` and `@types/pg@8.23.1` directly for this foundation and pin both in the relevant manifest and `pnpm-lock.yaml`; caret, tilde, tag, and workspace-catalog ranges are not permitted for these two dependencies. `pg@8.23.1` declares Node.js `>=16`, publishes an ESM import export, and therefore supports the repository's Node.js `24.14.0` ESM runtime. `@types/pg@8.23.1` publishes a TypeScript 5.8-compatible declaration track. The PostgreSQL wire client is compatible with PostgreSQL `18.6`; integration tests against that exact server version are the required compatibility proof. See the authoritative [`pg` package metadata](https://www.npmjs.com/package/pg/v/8.23.1), [node-postgres ESM documentation](https://node-postgres.com/features/esm), and [`@types/pg` package metadata](https://www.npmjs.com/package/@types/pg/v/8.23.1). Do not introduce an ORM, repository framework, code generator, Redis, or a queue.
4. Extend the existing dependency-boundary rules and tests so `packages/infrastructure` may depend only on the already approved layers and external infrastructure libraries, while domain, application, contracts, config, observability, and web cannot import it contrary to `TASK-002` rules.
5. All workspace imports must use the package's declared public exports. Do not deep-import `packages/infrastructure/src` from an app or another package.
6. Implement only abstractions exercised by this task's pool, query, transaction, migration, CLI, process-lifecycle, or integration-test requirements. Do not add generic repository bases, unit-of-work frameworks, dependency-injection containers, future domain ports, unused option bags, placeholder exports, or speculative TASK-004 helpers.

### 2. Add pinned local PostgreSQL infrastructure

Add a root `compose.yaml` with one PostgreSQL service named `postgres`.

- Use exactly PostgreSQL `18.6` from the official `18.6-bookworm` image. Before implementation, resolve the top-level multi-platform manifest-list digest with `docker buildx imagetools inspect postgres:18.6-bookworm`; verify its media type is an OCI image index or Docker manifest list, record the displayed top-level `Digest: sha256:...`, and use `postgres:18.6-bookworm@sha256:<manifest-list-digest>` verbatim in both `compose.yaml` and the GitHub Actions PostgreSQL service. Do not copy an `linux/amd64` or other platform child digest.
- Bind the host port to `127.0.0.1:5432`, not all interfaces.
- Persist development data in a named Compose volume. Normal `infra:down` must preserve it.
- Add a `pg_isready` health check with bounded interval, timeout, retries, and startup period. `infra:up` must not return success until the service is healthy.
- Use a deterministic project/service/volume naming strategy that does not collide with integration-test database names.
- Set an explicit database name, local user, and clearly non-production local-only password. These public example credentials are permitted only for loopback local/CI use, must be labeled as such, and must never be presented as production secrets.
- Do not mount the Docker socket, run privileged containers, use host networking, add unrelated services, or add production deployment configuration.
- Do not place application migrations in Docker entrypoint initialization. Compose initializes PostgreSQL only; the explicit migration command owns schema changes.

Provide these root commands with exactly these stable names and document their behavior:

```text
corepack pnpm infra:up
corepack pnpm infra:down
corepack pnpm infra:logs
corepack pnpm infra:reset
corepack pnpm verify:infrastructure-pins
```

`infra:reset` is the only command that may delete the named local database volume. It must target this Compose project explicitly, be documented as destructive to local development data, and must never derive a broad filesystem/container target from an unchecked variable. It must not run in CI or as part of install/test/check.

`verify:infrastructure-pins` is read-only. It must check the exact Compose/workflow reference equality locally, call `docker buildx imagetools inspect` for the pinned PostgreSQL reference, and fail unless the remote top-level object is a multi-platform index/list whose digest equals the committed digest. It must never accept `docker image inspect` or a local platform image ID as equivalent proof.

Add a cross-platform root command named `corepack pnpm env:local`. It must run a committed Node.js script that atomically copies root `.env.example` to root `.env` only when `.env` does not exist. It must never overwrite or merge an existing `.env`; an existing file produces a clear successful no-op message. The command must work unchanged in PowerShell, Command Prompt, and POSIX shells and must not require `cp`, `copy`, Bash, or PowerShell. Root `.env` remains ignored.

The local configuration workflow is exactly:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
```

After that setup, Docker Compose obtains its non-secret local substitutions from root `.env`; `dev:api` and `dev:worker` load root `.env` explicitly; and the `db:migrate`, `db:migrate:status`, `db:migrate:validate`, and `test:integration` launchers load root `.env` explicitly before calling typed config loaders. The integration/validation launchers must set their child/in-process `NODE_ENV` to exactly `test` in a cross-platform Node.js wrapper after loading `.env`; they must not ask developers to edit the development `NODE_ENV=development` value. Production `start:api` and `start:worker` must consume only their deployment process environment and must not load a repository file. No runtime, migration, test, Compose, or CI entry point may load `.env.example` directly. A missing `.env` must fail database-dependent local commands with the exact remediation `Run corepack pnpm env:local`; it must not silently fall back to example values.

The database-related block committed in `.env.example` must use these exact local-only values (alongside the existing API/web settings):

```dotenv
NODE_ENV=development
POSTGRES_USER=acos_local
POSTGRES_PASSWORD=acos_local_only
POSTGRES_DB=acos_dev
DATABASE_URL=postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev
MIGRATION_DATABASE_URL=postgresql://acos_local:acos_local_only@127.0.0.1:5432/acos_dev
TEST_DATABASE_ADMIN_URL=postgresql://acos_local:acos_local_only@127.0.0.1:5432/postgres
TEST_DATABASE_DISPOSABLE=YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED
DATABASE_SSL_MODE=disable
```

These credentials are intentionally public and valid only for the loopback development container/ephemeral CI service. Production must use distinct least-privilege runtime and migration principals. Do not commit `DATABASE_SSL_CA_FILE` in the local template because it must be absent in `disable` mode.

### 3. Integrate database configuration through `packages/config`

Extend the existing injected-environment design; no shared module may read `process.env` at import time. Executable composition roots and database CLI entry points supply an explicit environment object.

Required runtime settings:

| Environment variable             | Requirement                                                            | Validated behavior                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Required for API/worker database startup and integration entry points  | Absolute `postgresql:` or `postgres:` URL; hostname and database path required; all query parameters and fragments rejected; credentials treated as secret |
| `DATABASE_POOL_MAX`              | Optional, default `10`                                                 | Canonical base-10 integer from `1` through `50`                                                                                                            |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Optional, default `5000`                                               | Canonical base-10 integer from `100` through `60000`                                                                                                       |
| `DATABASE_IDLE_TIMEOUT_MS`       | Optional, default `30000`                                              | Canonical base-10 integer from `1000` through `300000`                                                                                                     |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | Optional, default `15000`                                              | Canonical base-10 integer from `100` through `300000`                                                                                                      |
| `DATABASE_SSL_MODE`              | Optional outside production, default `disable`; required in production | Exact enum `disable` or `verify-full`                                                                                                                      |
| `DATABASE_SSL_CA_FILE`           | Required when `DATABASE_SSL_MODE=verify-full`; otherwise absent/empty  | Absolute filesystem path to a non-empty PEM CA bundle; the path is configuration metadata, not file content                                                |
| `MIGRATION_DATABASE_URL`         | Required only by migration/status/validation commands                  | Same URL rules as `DATABASE_URL`; never loaded or exposed by normal app runtime configuration                                                              |
| `TEST_DATABASE_ADMIN_URL`        | Required only by database integration/validation harnesses             | Must target a disposable non-production PostgreSQL server and an administrative database; never loaded by production composition roots                     |
| `TEST_DATABASE_DISPOSABLE`       | Required only by destructive integration/validation harnesses          | Must equal the exact case-sensitive literal `YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED`                                                              |

Requirements:

1. Preserve one normal runtime configuration path for API/worker and separate narrowly exported loaders/types for migration and test-administration configuration. A normal `AppConfig` must not contain migration/test-admin credentials.
2. Do not accept passwords, SSL settings, pool settings, or timeouts from unvalidated ad hoc `process.env` reads in infrastructure code.
3. Returned configuration remains immutable. Unknown OS variables remain filtered.
4. Errors identify fields and safe reasons but never echo a URL, username, password, host, database name, query parameter, or sentinel value.
5. Redacted metadata may report only non-secret facts needed for startup diagnostics, such as database configuration presence and numeric pool/timeout settings. It must not serialize the database origin or any portion of a credential-bearing URL.
6. `.env.example` is a copy-only template and may contain only the documented loopback, non-production Compose values. It must contain all settings needed by the exact local workflow, including runtime/migration/test-admin URLs, `DATABASE_SSL_MODE=disable`, and the destructive-test opt-in literal. Keep `.env`, `.env.test`, and all populated overrides ignored.
7. Apply this exact transport policy, with no alternative policy left to implementation:
   - In `development` and `test`, `DATABASE_SSL_MODE` defaults to `disable`; `disable` is valid only when every database URL used by that loader has host `localhost`, `127.0.0.1`, or `::1`. `verify-full` is also valid.
   - In `production`, `DATABASE_SSL_MODE` must be explicitly `verify-full`; omitted, empty, `disable`, `require`, `prefer`, `allow`, or any other value fails configuration before creating a pool.
   - Map `disable` to the `pg` pool option `ssl: false`. `DATABASE_SSL_CA_FILE` must be absent or empty in this mode.
   - Map `verify-full` to `ssl: { rejectUnauthorized: true, ca: <exact UTF-8 contents of DATABASE_SSL_CA_FILE> }`. Never set `rejectUnauthorized: false`, never replace Node's hostname verification, and never translate `verify-full` to `require`.
   - Reject every URL query parameter, including `sslmode`, `ssl`, `sslcert`, `sslkey`, and `sslrootcert`, so URL parsing cannot override or weaken the explicit mapping.
   - `DATABASE_SSL_CA_FILE` is mandatory in `verify-full`, must be an absolute path, and is read only by the executable composition/CLI/test entry point before pool construction. Validate the UTF-8 content by constructing a Node.js secure context before the pool is created. Missing, relative, unreadable, non-file, empty, or invalid PEM/trust content fails before successful startup/migration/test and without logging path contents, CA contents, or a database URL. There is no fallback to system trust when the variable/file is missing.
   - Inject the loaded CA text into the infrastructure factory; `packages/config` validates the mode/path relationship but does not perform import-time filesystem I/O.

Test missing values, wrong protocols, relative/malformed URLs, missing host/database, embedded credentials handling, query/fragment policy, IPv4/IPv6, percent-encoding, every numeric lower/upper boundary, zero/negative/decimal/exponent/whitespace/non-string values, immutability, independent calls, unknown-key filtering, every SSL mode/environment/CA-file combination, and sentinel non-disclosure.

### 4. Implement the persistence boundary in `packages/infrastructure`

Create a private `@affiliate-content-os/infrastructure` workspace package with a narrow `./database` public export. Do not create repository, identity, tenancy, product, or other placeholder modules.

The database module must provide typed, import-safe construction and lifecycle boundaries:

1. A pool factory accepts validated database configuration and injected lifecycle/logging hooks. It must not read global environment state, connect on import, install signal handlers, run migrations, or start a process.
2. Do not export the mutable raw `pg.Pool` as the application contract. Export the smallest query/transaction/lifecycle interfaces needed for later infrastructure repositories and composition roots.
3. Provide an explicit one-shot connection probe used during API/worker startup. It may execute only a constant `SELECT 1`-style statement and must not imply schema readiness or run migrations.
4. Provide idempotent, concurrency-safe close behavior. Once closing starts, reject new work predictably; closing an already closed/closing database must not leak handles or throw merely because close was repeated.
5. Pool and checked-out client errors must be observed and safely surfaced. Failure diagnostics must not contain connection strings, passwords, raw SQL parameter values, or full driver configuration.
6. Do not implement automatic reconnect loops or unbounded retries. Let `pg` handle normal pool behavior; startup connection failure is a safe, nonzero process startup failure.

The transaction API must:

- acquire exactly one client for the callback;
- issue `BEGIN`, then `COMMIT` only after callback success;
- issue `ROLLBACK` after callback failure and always release the client in `finally`;
- return the callback value on success and preserve the original safe failure as the primary error if rollback/release also fails;
- never return a transaction-scoped client or executor that can be used after callback completion;
- make nesting behavior explicit. For this task, transaction executors must not expose `withTransaction`, so accidental nesting is impossible through the public callback contract;
- accept query text plus a separate parameter array and pass them to `pg` without interpolation; and
- avoid external calls, sleeps, retry loops, or application policy inside a database transaction.

Add focused unit tests with injected driver fakes for exact `BEGIN`/`COMMIT`/`ROLLBACK`/release ordering and failure paths, plus real-PostgreSQL integration tests proving commit visibility, rollback invisibility, callback return values, parameter safety, concurrent independent transactions, client release after failure, pool exhaustion timeout behavior, connection failure, and idempotent shutdown.

### 5. Add a forward-only migration mechanism

Implement migrations as reviewed, numbered SQL files plus a small migration runner in the infrastructure database module. Do not expose or implement a down/rollback migration command.

Required migration contract:

- Filenames use exactly four-digit, zero-padded, contiguous numbers beginning at `0001`, followed by one lowercase snake-case name and `.sql`, for example `0001_baseline.sql`, `0002_next_change.sql`. The committed set must contain every integer from `0001` through its highest number exactly once. Gaps, `0000`, duplicate numbers, duplicate names, malformed names, or numbers above `9999` fail discovery before any database connection or SQL execution.
- Applied migrations are recorded in a `schema_migrations` infrastructure table with at least migration number, immutable name, SHA-256 checksum, and applied timestamp. Use `snake_case` and typed PostgreSQL columns.
- The first migration creates only `schema_migrations` and records itself through the runner. No domain, identity, tenancy, product, AI, content, scheduling, analytics, audit, outbox, job, or social table may be added.
- Acquire a dedicated session-level PostgreSQL advisory lock before inspecting or changing migration state. Hold the same checked-out connection until migration work and unlock complete; always attempt unlock/release in `finally`.
- Apply each pending migration in number order in its own transaction. A failed migration rolls back fully, is not recorded, stops later migrations, and exits nonzero.
- Compare stored checksums and immutable names to every already-applied migration. Missing, reordered, renamed, edited, duplicate, unknown applied, or non-contiguous migrations are drift and must fail closed.
- A second run with no pending migrations is a successful no-op and does not alter applied timestamps.
- Migration logs may report number, name, duration, and outcome only; never log connection URLs, SQL parameters, environment objects, or full SQL bodies.
- Process startup never applies migrations. Only explicit migration commands may do so.

Provide exactly these commands:

```text
corepack pnpm db:migrate
corepack pnpm db:migrate:status
corepack pnpm db:migrate:validate
```

`db:migrate` uses only `MIGRATION_DATABASE_URL`. `db:migrate:status` is read-only and exits nonzero for pending migrations, any local/database numbering gap, drift, an unreachable database, or an absent baseline. `db:migrate:validate` uses `TEST_DATABASE_ADMIN_URL` to create an isolated empty database, runs all migrations, verifies status, reruns as a no-op, validates the tracking row/checksum, and drops the isolated database in `finally`. All three commands validate the complete contiguous local sequence before connecting; neither status nor validation may normalize, ignore, or fill a gap.

### 6. Add safe integration-test database setup and isolation

Build test-only helpers inside the infrastructure package test tree or a non-production test-support subpath that cannot be imported by production code. Do not create `packages/test-support` solely for this task.

1. Use a unique database per integration suite or Vitest worker, created from `TEST_DATABASE_ADMIN_URL`; do not share mutable tables between parallel tests.
2. Generate database names as the fixed prefix `acos_test_` followed by 1-48 lowercase hexadecimal characters. The complete name must match exactly `^acos_test_[0-9a-f]{1,48}$`; generate the suffix from `crypto.randomUUID()` without hyphens or equivalent cryptographic bytes. Correctly quote the already validated identifier. Never concatenate arbitrary external input into SQL.
3. Before any `CREATE DATABASE`, session termination, or `DROP DATABASE`, enforce every machine-verifiable guard below. Documentation or naming alone is not a guard:
   - the effective `NODE_ENV` is exactly `test`;
   - `TEST_DATABASE_DISPOSABLE` equals the exact case-sensitive literal `YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED`;
   - the URL protocol, credentials, port, and query policy passed normal validation;
   - the URL host is exactly `localhost`, `127.0.0.1`, or `::1`; in CI only, when `CI=true`, the additional exact host `postgres` is allowed;
   - the URL path names exactly the administrative database `postgres`;
   - the generated target matches `^acos_test_[0-9a-f]{1,48}$`; and
   - the target is not `postgres`, `template0`, `template1`, the database named by `TEST_DATABASE_ADMIN_URL`, or any name without the fixed prefix.

   Any failed guard must occur before opening an administrative connection where practical and always before destructive SQL. It exits nonzero with a safe field/reason and performs no create, terminate, or drop operation.

4. Connect to the administrative database to create/drop test databases. Close all pools/clients first; terminate only sessions for the exact guarded test database when cleanup requires it.
5. Run migrations before each isolated suite uses the database. Always attempt cleanup in `finally`, including after setup, migration, assertion, or pool-close failure.
6. Do not use production data, snapshots of production data, transaction-only isolation that cannot cover DDL/connection behavior, or tests that silently skip when PostgreSQL/configuration is unavailable.
7. Integration tests must be deterministic under parallel CI execution and must leave no prefixed databases after a successful run.

Provide a stable root command:

```text
corepack pnpm test:integration
```

Keep `corepack pnpm test` as the existing fast, infrastructure-independent test gate. `test:integration` must fail clearly rather than pass by omission when required test configuration or PostgreSQL is unavailable.

### 7. Wire database lifecycle into API and worker composition roots

API and worker executable startup must load validated runtime database configuration, construct the database dependency, perform the one-shot connection probe, and only then report successful startup/listen. They must not run migrations automatically.

- Preserve import-safe API/worker factories and injected dependencies for unit tests.
- The API `GET /health/live` response remains exactly the TASK-002 liveness contract and must not query PostgreSQL or claim readiness.
- Do not add an API readiness route in this task.
- Preserve TASK-002's default `5000ms` graceful-shutdown budget as one total process deadline, exposed through the existing injectable `shutdownTimeoutMs` option for deterministic tests. The first shutdown request records one monotonic absolute deadline (`startedAt + shutdownTimeoutMs`) and creates one shared shutdown promise. Waiting for/aborting a database probe, settling listener/worker startup, closing the Fastify listener or worker runtime, and closing the database pool all consume that same budget. Never give each stage a fresh timeout window.
- Pass one process-owned `AbortSignal` through the database probe and pending listener/worker startup boundaries. On the first shutdown request, abort it immediately, prevent any later successful-start notification/listen, and begin ordered cleanup. If a component does not settle after cancellation, race it only against the remaining shared deadline.
- If shutdown is requested during a pending probe, abort/race the probe, then close the partially created pool within the same remaining budget. During listener startup, prevent or immediately close a late listener, then close the pool within the same remaining budget. During active runtime, stop accepting API/worker work first and then close the pool. During pool close, keep awaiting the existing shared promise. Repeated signals or programmatic close calls return/observe that same promise, do not reinstall handlers, do not restart cleanup, and do not extend/reset the deadline.
- A clean signal-driven shutdown that completes every stage before the deadline terminates with code `0`. Any startup/shutdown stage failure, pool-close failure, or expiration of the one deadline emits one credential-safe failure, removes signal handlers, and invokes the injected termination boundary exactly once with code `1`; late completions must not change that result. A non-signal startup failure must also make one bounded cleanup attempt and exit nonzero.
- Inject the monotonic clock, deadline timer creation/clearing, abortable probe/listener/runtime boundaries, and termination function in unit tests. Tests must advance a fake clock/timer; real sleeps are not acceptable for proving the `5000ms` total deadline.
- Database connection or shutdown errors must be safe and credential-free. Do not log the raw driver error object if it can contain connection details.
- Web remains database-free and must not import infrastructure or receive database configuration in its browser bundle.

Update existing API/worker lifecycle tests to cover successful probe, probe rejection, partial-startup cleanup, exact shared-deadline accounting across multiple cleanup stages, close ordering, close failure/timeout, repeated shutdown/signals, late completion, exactly-once termination, and absence of import-time environment reads/connections.

### 8. Add PostgreSQL and security gates to CI

Keep workflow permissions at `contents: read`, request no repository secrets, and pin every third-party GitHub Action to a full commit SHA with a version comment.

CI must contain:

1. The existing infrastructure-independent quality job on Node.js `24.14.0` and pnpm `12.4.2`, using the frozen lockfile and running `corepack pnpm check` (or the equivalent pinned invocation already established).
2. A PostgreSQL integration job using the same immutable PostgreSQL `18.6-bookworm` manifest-list digest as Compose, with a health check. Its explicit job environment must set `NODE_ENV=test`, loopback/service URLs, `DATABASE_SSL_MODE=disable`, and `TEST_DATABASE_DISPOSABLE=YES_I_UNDERSTAND_TEST_DATABASES_WILL_BE_DROPPED` using only job-local non-production credentials. It must install from the frozen lockfile, build/typecheck as required, run `db:migrate:validate`, and run `test:integration`. It must not create/load `.env`, load `.env.example`, or silently retry failed migrations/tests.
3. A dependency audit using the frozen lockfile. `corepack pnpm audit --prod --audit-level high` must be an explicit gate; any temporary advisory exception must be narrow, documented, time-bounded, and Product Owner/Codex approved.
4. A container vulnerability scan using Trivy exactly `v0.76.1`, the current maintained release verified from the official [Trivy v0.76.1 release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.1). Install it with `aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567 # v0.3.1` and its `version: v0.76.1` input; do not use `trivy-action`, `latest`, or an unpinned installer. Assert `trivy --version` reports `0.76.1`, set `POSTGRES_IMAGE` to the exact committed digest reference, and invoke exactly:

   ```text
   trivy image --scanners vuln --timeout 10m --no-progress --format table --severity HIGH,CRITICAL --exit-code 0 "$POSTGRES_IMAGE"
   trivy image --scanners vuln --timeout 10m --no-progress --format table --severity CRITICAL --ignore-unfixed --exit-code 1 "$POSTGRES_IMAGE"
   ```

   The first command prints the reviewable HIGH/CRITICAL report to the CI log; the second gates all fixable CRITICAL findings. `--ignore-unfixed` is the only permitted suppression in this task. Do not add `.trivyignore`, Rego/VEX suppression, CVE exceptions, `continue-on-error`, or exit-code masking; a desired exception requires a separately approved task revision. Give the scan step a `15` minute GitHub Actions `timeout-minutes` ceiling in addition to each command's `10m` scanner timeout. Do not upload SARIF/JSON/table artifacts, and do not pass registry/database credentials. Trivy may use its public vulnerability database and public registry anonymously.

5. A Compose configuration validation/pull check so an invalid file or unavailable digest fails before integration tests.
6. A committed pin-verification script/test must parse `compose.yaml` and `.github/workflows/ci.yml`, assert that both contain the identical `postgres:18.6-bookworm@sha256:<64 lowercase hex>` reference, and fail if the digest is a platform child. CI must also run `docker buildx imagetools inspect` against the pinned reference and assert that the top-level media type is `application/vnd.oci.image.index.v1+json` or `application/vnd.docker.distribution.manifest.list.v2+json` and its digest equals the committed digest. `docker image inspect`, `docker compose images`, and a local pulled image ID are not sufficient because they resolve platform-specific children.

CI test credentials must be unique, clearly non-production, scoped to the ephemeral job service, and never sourced from repository/organization secrets. Logs and uploaded reports must not contain connection URLs or passwords. Do not add deployment, registry-push, cloud, or production migration jobs.

### 9. Document reproducible developer operation

Update `README.md` and `.env.example` only as needed to document:

- exact Node.js `24.14.0`, pnpm `12.4.2`, and PostgreSQL `18.6` requirements;
- Docker Engine with Compose v2 as the local infrastructure prerequisite;
- the exact `corepack pnpm env:local` copy workflow, which entry points load `.env`, the no-overwrite behavior, missing-file failure, and the prohibition on loading `.env.example` at runtime;
- local-only credential warning and ignored `.env` overrides;
- `infra:up`, health verification, explicit migration, API/worker startup, integration tests, logs, shutdown, and destructive reset;
- separation between runtime, migration, and test-admin credentials;
- migrations never run during API/worker startup;
- `GET /health/live` is process liveness only;
- troubleshooting for occupied port, unhealthy container, invalid configuration, migration drift/failure, and cleanup failure; and
- the current workspace map, including the real database-only scope of `packages/infrastructure`.

The documented clean-checkout development sequence must be exactly reproducible:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm db:migrate:status
corepack pnpm test:integration
corepack pnpm check
```

Document `infra:down` as the normal final cleanup and `infra:reset` separately as an optional destructive local reset.

## Expected files

Exact source filenames may vary if the same boundaries and public contracts are preserved. Expected scope includes:

- `compose.yaml`;
- `.env.example` and `.gitignore` only where required for safe database examples/overrides;
- a committed cross-platform `scripts/setup-local-env.mjs` or equivalent Node.js setup script;
- a committed infrastructure-pin verification script/test;
- root `package.json` scripts;
- `pnpm-lock.yaml`;
- `.github/workflows/ci.yml`;
- `README.md`;
- `packages/config/src/*` and focused `packages/config/test/*` updates;
- `packages/infrastructure/package.json`;
- `packages/infrastructure/tsconfig.json` and build configuration;
- `packages/infrastructure/src/database/*` for config mapping, pool/lifecycle, query/transaction boundaries, and migration runner;
- `packages/infrastructure/migrations/0001_baseline.sql` or an equivalent committed migration location included in build/package resolution;
- `packages/infrastructure/test/unit/*` and `packages/infrastructure/test/integration/*`;
- test-only isolated-database harness files;
- `apps/api` and `apps/worker` composition-root/lifecycle updates and tests;
- Vitest/root TypeScript configuration updates needed to separate unit and integration suites;
- `.dependency-cruiser.js` and focused boundary tests/fixtures only as needed to prove the new real package obeys the existing graph; and
- a narrowly configured container scan policy/report configuration if required.

Do not add generated `dist`, `.next`, coverage, scan-result, database-volume, dump, or environment files.

## Database changes

Add one forward migration only: `0001_baseline.sql`.

Its sole durable schema effect is the migration mechanism's `schema_migrations` table. The table must use PostgreSQL typed columns, a primary/unique constraint that prevents duplicate migration numbers, immutable migration name/checksum data, and `timestamptz` for application time. The runner records migration `0001` only after its DDL succeeds in the same transaction.

Do not add extensions or any application/business tables, including `users`, `workspaces`, memberships, sessions, products, facts, media, AI runs, analyses, content, approvals, social accounts/credentials, publications, attempts, metrics, outbox, jobs, idempotency, or audit events.

Do not add seed data. Do not implement down migrations. Do not auto-migrate from API/worker startup.

## API changes

No public API contract change.

`GET /health/live` must remain HTTP `200`, JSON, and exactly `{ "status": "ok", "service": "api" }` after successful process startup. It remains a liveness probe and performs no database query. Do not add `/api/v1`, readiness, auth/session, product, or database-management endpoints.

## Frontend changes

None, except README wording outside the frontend.

Do not change UI behavior or add database/auth/workspace/product state. `apps/web` must remain unable to import `packages/infrastructure`, and database secrets/configuration must not enter server-rendered output or browser bundles.

## Backend changes

Add the database-only infrastructure package, configuration loaders, pool/query/transaction lifecycle, forward migration CLI, isolated test harness, and API/worker composition-root wiring described above.

No repositories or application use cases are part of this task. The API and worker only prove connection ownership and cleanup; they do not read or write application records.

## Security requirements

- Never commit real credentials, populated environment files, database dumps, logs, or scan reports containing secrets.
- Treat `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `TEST_DATABASE_ADMIN_URL` as secrets in config objects, errors, inspections, logs, test snapshots, process arguments, and CI output. Treat CA bundle contents as sensitive log-excluded configuration. Sentinel tests must inspect thrown errors, JSON/string serialization, logger calls, and child-process output.
- Local/CI example credentials must bind only to loopback or the isolated CI service network, be explicitly non-production, and never be reused in deployed environments.
- Preserve least privilege as a contract: runtime uses `DATABASE_URL`; schema-change tooling uses `MIGRATION_DATABASE_URL`; destructive test administration uses `TEST_DATABASE_ADMIN_URL`; production code never receives the latter two.
- Production accepts only `DATABASE_SSL_MODE=verify-full` with an absolute, readable, non-empty `DATABASE_SSL_CA_FILE`; map it only to `ssl: { rejectUnauthorized: true, ca }`. Do not disable or replace certificate/hostname verification, use system-trust fallback when the required CA is missing, or accept other libpq SSL mode names.
- All application/test query values are parameters. Dynamic identifiers are prohibited except in the guarded integration harness, where generated names are strictly allowlisted and correctly quoted.
- Migration SQL is trusted reviewed source, checksum-verified after application, and never assembled from environment/user input.
- Bound connection, statement, health-check, and test-cleanup waits. API/worker shutdown has one total default `5000ms` deadline shared by startup cancellation, runtime/listener close, and pool close; no stage may reset it or hang CI indefinitely.
- Do not log raw SQL bodies, bind values, full driver errors, connection options, environment objects, or stack traces containing secrets.
- Pin the PostgreSQL image by exact version and immutable digest. Validate and vulnerability-scan that exact image. Audit production npm dependencies from the committed lockfile.
- CI stays read-only, uses no production/repository secrets or production data, and performs no deployment.
- No install/postinstall hook may start containers, connect to a database, run migrations, or download/execute tools outside normal pinned dependency installation.

## Edge cases

- Clean checkout has no `node_modules`, build output, environment override, Docker volume, cached image, or pre-existing database.
- Root `.env` is absent, setup creates it atomically from `.env.example`, repeated setup preserves local edits, and database commands fail with the required remediation when it is missing. No entry point loads `.env.example`.
- Docker/Compose missing, daemon unavailable, port `5432` occupied, image digest unavailable, container startup unhealthy, or service exits early.
- Existing named development volume is reused by `infra:up`; `infra:down` preserves it; only explicit `infra:reset` removes it.
- Missing/malformed database environment input and valid URLs with reserved/percent-encoded credential characters or IPv6 hosts.
- `disable` against a non-loopback host, production with missing/`disable`/unknown SSL mode, `verify-full` with missing/relative/unreadable/empty/invalid CA file, certificate chain failure, or hostname mismatch.
- PostgreSQL unavailable, authentication rejected, DNS/connection timeout, statement timeout, pool exhausted, or connection lost while checked out.
- Pool close begins during probe/query/transaction, close is called more than once, or a pool/client emits an error without an active query.
- Transaction callback succeeds, throws, returns a rejected promise, or encounters commit/rollback/release failure. No client remains checked out.
- Query payload includes quotes, semicolons, comment markers, Unicode, and SQL-looking text but remains data through parameters.
- Empty database, fully migrated database, one or several pending migrations in test fixtures, and concurrent migration runners.
- Duplicate migration number/name, missing `0001`, any local or applied numbering gap, changed checksum/name, missing local applied migration, unknown database migration, reordered files, unreadable file, invalid SQL, and failure halfway through a migration. Every gap fails before migration SQL; status remains read-only and nonzero.
- Migration advisory-lock contention times out or exits safely according to a documented bound; it never applies concurrently.
- Failed migration is rolled back and unrecorded; later migration does not run; rerun after correction behaves deterministically.
- Status is read-only and exits nonzero for pending, drifted, absent, or unreachable state.
- Missing/wrong destructive opt-in, non-`test` environment, disallowed host, non-`postgres` admin path, protected target name, malformed/generated-prefix mismatch, test database name collision, setup failure, migration failure, assertion failure, open client during cleanup, cleanup failure, and parallel Vitest workers. Every failed guard precedes destructive SQL.
- API/worker receives termination while database probe is pending, listener/worker startup is pending, active runtime is running, pool close is pending, or shutdown is already in progress; repeated signals never reset the one total deadline and late completions never reverse forced nonzero termination.
- PostgreSQL tag points at a different manifest list, a platform child digest is mistakenly recorded, Compose/CI pins differ, or Trivy cannot complete within `10m`.
- Liveness endpoint behavior remains deterministic and independent of a per-request database check.
- Windows local checkout using Docker Desktop and Linux GitHub Actions service-container networking use documented hostnames without platform-specific source changes.

## Acceptance criteria

1. A clean checkout uses Node.js `24.14.0`, pnpm `12.4.2`, `pg@8.23.1`, `@types/pg@8.23.1`, and the exact manifest-list-digest-pinned PostgreSQL `18.6-bookworm` image; `corepack pnpm install --frozen-lockfile` succeeds without generated workspace artifacts.
2. `corepack pnpm infra:up` starts only PostgreSQL, binds it to loopback, waits for health, and uses the documented persistent volume. `infra:down` preserves data and `infra:reset` removes only this project's local database volume.
3. `corepack pnpm env:local` is cross-platform, atomically creates but never overwrites ignored `.env`, and every clean-checkout/manual sequence runs it before infrastructure/database commands. Only the specified local entry points load `.env`; production uses process environment; no entry point loads `.env.example`.
4. Database runtime, migration, and test-admin configuration are separately typed, strictly validated, immutable, and non-leaking. Only executable composition/CLI/test entry points read `process.env`. The exact `disable`/`verify-full` mapping and production CA/certificate/hostname verification policy are enforced.
5. `@affiliate-content-os/infrastructure/database` is a real narrow public boundary with no generic/speculative abstractions, future placeholders, product repositories, import-time connection, environment read, signal handler, or migration side effect.
6. API and worker fail safely before reporting startup when PostgreSQL cannot be probed, clean partial resources, and use one monotonic default `5000ms` deadline across probe/startup/runtime/listener/pool shutdown. Repeated requests share it; failure/expiry terminates exactly once with code `1`. Web remains database-free.
7. `GET /health/live` retains the exact TASK-002 response and never queries PostgreSQL.
8. Unit tests prove transaction command ordering and all callback/commit/rollback/release failure paths without leaking a client or secret.
9. Real PostgreSQL tests prove commit, rollback, parameter safety, concurrent independent transactions, pool timeout/failure behavior, and idempotent lifecycle cleanup.
10. `0001_baseline.sql` creates only `schema_migrations`; there are no business tables, extensions, seed records, down migrations, or automatic startup migrations.
11. Migration numbers are contiguous from `0001`; any local/applied gap fails before SQL. Migrations use one-session advisory locking, ordered per-migration transactions, immutable name/checksum validation, and fail-closed drift detection. Concurrent runners apply each migration at most once.
12. `db:migrate:validate` creates a truly empty isolated database, applies all migrations, verifies recorded checksum/state, proves a second no-op run, and removes the database in `finally`.
13. `db:migrate:status` makes no schema changes and returns success only when the database exactly and contiguously matches committed migrations.
14. Integration tests require `NODE_ENV=test`, the exact destructive opt-in literal, an allowed host/admin database, and an exact guarded `acos_test_` target; they fail before destructive SQL on any mismatch, clean up after success/failure, and do not interfere under parallel execution.
15. Architecture checks prove API/worker may consume the infrastructure public database export while domain/application/contracts/config/web and cross-workspace deep imports remain forbidden.
16. The committed pin check and `docker buildx imagetools inspect` prove Compose and CI use the same top-level multi-platform manifest-list digest, not a platform child.
17. CI retains read-only permissions and frozen installation, runs the existing quality gates, runs migration validation and integration tests against the exact PostgreSQL image, audits production dependencies, validates Compose, and uses Trivy `v0.76.1` through the pinned setup action/commands/policy without secrets or report upload.
18. The documented clean-checkout sequence completes without manual SQL, pre-existing volumes, global Node packages, or manual environment editing after `env:local`.
19. `corepack pnpm format:check`, `lint:boundaries`, `lint`, `typecheck`, `test`, `build`, `check`, `db:migrate:validate`, and `test:integration` all execute substantive checks and pass in their documented environment.
20. The final diff contains no secret, generated output, database dump/volume, unrelated documentation rewrite, business schema, feature code, generic future abstraction/placeholder, queue/cache, ORM, microservice, Kubernetes, Kafka, CQRS, or event-sourcing artifact.

## Test plan

### Unit tests

- Local environment: atomic first copy, existing-file no-op/no-overwrite, missing `.env` remediation, explicit `.env` loading by only the named local entry points, production file-loading prohibition, and no `.env.example` runtime fallback.
- Config: all runtime/migration/test-admin happy paths, defaults, numeric boundaries, URL/protocol failures, every environment/mode/CA path and trust failure, exact `pg` SSL mapping, immutability, unknown keys, independent loads, destructive opt-in guards, and sentinel non-disclosure.
- Pool/lifecycle: lazy/import-safe construction, config mapping, connection probe, observed pool/client errors, rejection after close begins, repeated/concurrent close, and safe error mapping.
- Transactions: exact command/release order for success and every callback/begin/commit/rollback/release failure combination; callback result propagation; no transaction executor escape/nesting API.
- Migration discovery/state: exact filename grammar, contiguous numbering from `0001`, pre-connection gap rejection, ordering, duplicate detection, checksums, drift categories, pending/status result, safe logs, and no down path.
- Architecture: allowed API/worker-to-infrastructure public import and rejected web/core/deep-import/test-helper cases.
- API/worker: probe-before-start, failed probe cleanup, abort during each lifecycle phase, one injected monotonic `5000ms` total deadline across multi-stage cleanup, no deadline reset on repeats, late completion, exactly-once exit `0`/`1`, close failure, and no liveness database query.
- Infrastructure pins/scanning: Compose and CI exact-reference equality, top-level manifest-list media type/digest validation, platform-child rejection, and the exact Trivy version/arguments/no-ignore/no-upload policy.

### PostgreSQL integration and migration tests

- Create a unique empty database, verify baseline absence, apply `0001`, inspect the exact resulting user-owned relation set, constraints, types, and recorded SHA-256 checksum.
- Run migrations twice and prove the second run changes nothing.
- Run two migration processes concurrently and prove advisory-lock serialization and a single applied row.
- Use temporary migration fixtures to prove pending status, missing `0001`/interior/trailing numbering gaps fail before connection/SQL, invalid SQL rollback, stop-on-first-failure, checksum/name/unknown-applied drift, and recovery after an unapplied failure.
- Exercise real transaction commit/rollback/parameter/concurrency behavior and pool connection/exhaustion/shutdown failures.
- Force setup/test/cleanup failures and verify guarded cleanup and safe, credential-free diagnostics.

### Manual smoke verification

From a clean checkout with no prior project volume:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
docker compose config --quiet
corepack pnpm infra:up
docker compose ps
corepack pnpm db:migrate
corepack pnpm db:migrate:status
corepack pnpm dev:api
corepack pnpm dev:worker
corepack pnpm test:integration
corepack pnpm infra:down
```

Start API and worker separately if terminal ownership conflicts. Verify the API liveness response exactly, stop API/worker through supported signals, confirm pool shutdown, confirm logs contain no database credential/URL, and confirm `infra:down` leaves the development volume intact. Exercise `infra:reset` only against the confirmed project-local volume and verify a following migration starts from empty state.

### Required verification commands

Run and report these commands verbatim with exit status and concise result. `env:local` creates the ignored local configuration; no manual export/edit or `.env.example` runtime load is part of this sequence.

```text
node --version
corepack pnpm --version
docker version
docker compose version
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
docker compose config --quiet
corepack pnpm verify:infrastructure-pins
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm db:migrate:status
corepack pnpm db:migrate:validate
corepack pnpm test:integration
corepack pnpm format:check
corepack pnpm lint:boundaries
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm audit --prod --audit-level high
corepack pnpm infra:down
```

Also run `docker buildx imagetools inspect` for both `postgres:18.6-bookworm` and the committed pinned reference and record the top-level media type/digest. `docker compose images` may be reported but is not manifest-list proof. Inspect `docker compose ps`/health, the exact empty-database relation set after migration, `git status --short`, the final diff, ignored/untracked files, and tracked files for credentials, dumps, logs, scan output, build output, and out-of-scope artifacts.

CI evidence must include the quality, PostgreSQL migration/integration, dependency-audit, Compose validation, and container-scan job results for the implementation commit.

## Out of scope

- Authentication, sessions, managed OIDC integration, authorization, roles, users, workspaces, memberships, tenancy, or row-level security.
- Product catalog, facts, affiliate destinations, media, AI, analyses, content, compliance, approval, scheduling, publishing, analytics, audit records, or social-platform functionality.
- Tables for any of the above; outbox, job, idempotency, audit, or seed tables; sample/mock business data.
- Feature repositories, domain entities, application ports/use cases, public API resources, OpenAPI, readiness routes, forms, or dashboards.
- Redis-compatible queues, schedulers, cron, worker jobs, retries, leases, or advisory locks other than the migration lock.
- ORM/query-builder adoption, schema code generation, database GUI tooling, or a generic data-access framework.
- Generic repository/unit-of-work bases, dependency-injection containers, unused configuration knobs, speculative public interfaces, future TASK-004 helpers, or placeholder packages/exports not exercised by TASK-003 tests and runtime wiring.
- Production database/cloud/vendor selection, production credentials, secrets manager, certificates, deployment migrations, backups, point-in-time recovery, restore drills, replication, proxies, or production infrastructure as code.
- Database major-version upgrade automation or destructive application-schema migration examples.
- Redis, object storage, identity/AI/social emulators, Dockerfiles for application processes, or multi-container production topology.
- Microservices, Kubernetes, Kafka, service mesh, CQRS, or event sourcing.
- Changes to approved documents under `docs/`; architecture changes require a separately approved decision.

## Implementation handoff requirements

This specification is presented to the Product Owner for approval. Antigravity must not begin implementation until the Product Owner explicitly approves it.

After approval, Antigravity must read `AGENTS.md`, all relevant approved documentation, and this task before coding. Report before implementing any deviation in PostgreSQL version/image, package boundary, driver/migration approach, configuration contract, migration semantics, test-isolation strategy, CI gates, or required commands.

Before declaring implementation ready for Codex review, provide:

- created, modified, and deleted files;
- exact Node, pnpm, PostgreSQL tag and verified top-level manifest-list digest, `pg@8.23.1`, `@types/pg@8.23.1`, setup-trivy commit, and Trivy `v0.76.1` revisions;
- the full public database interface and package export map;
- every environment variable, default, valid range, secret classification, `.env` loader ownership, destructive-test guard, exact `pg` SSL mapping, CA/trust behavior, and production transport rule;
- migration table DDL, advisory-lock key/derivation, transaction/checksum/drift behavior, and proof no down/startup migration exists;
- local Compose service/port/volume/health behavior and the explicit target affected by `infra:reset`;
- integration database naming/safety guards, exact opt-in proof, parallel-isolation model, and cleanup evidence including failure paths;
- API/worker startup and one-total-deadline shutdown lifecycle evidence, injected deterministic timer tests, forced nonzero behavior, and exact unchanged liveness response;
- every required verification command with actual exit status/result, without redacting failures into claimed success;
- CI job links/results plus dependency audit, manifest-list pin proof, exact Trivy commands/output, and container audit outcome;
- migration validation evidence from an empty database, second-run no-op, concurrent runners, failed-migration rollback, and drift rejection;
- final `git status --short`, diff/stat, and confirmation that no credentials, environment overrides, generated files, database artifacts, scan reports, business tables, or out-of-scope code are tracked; and
- known limitations or deviations.

Do not claim architectural approval. Codex will review the Product Owner requirement, this specification, the actual implementation/diff, executed tests, migration behavior, and CI evidence before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
