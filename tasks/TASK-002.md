# TASK-002 - Runtime Process Shells and Architecture Boundaries

Status: Approved by Product Owner; Ready for Codex Review

Sprint: 1 - Foundation

Owner: Antigravity (Implementation Engineer)

Approval authority: Product Owner (User)

Implementation may begin only after explicit Product Owner approval.

## Objective

Create the next smallest runnable Sprint 1 slice by adding three minimal process shells:

- a Next.js web process;
- a Fastify HTTP API process; and
- a long-running Node.js worker process.

Each process must load validated runtime configuration through `@affiliate-content-os/config`, start and stop predictably, participate in the existing workspace quality gates, and contain only enough behavior to prove that its runtime boundary works.

Add executable architecture checks that enforce the modular-monolith dependency direction described in `docs/ARCHITECTURE.md`. Do not add database, authentication, tenancy, product, AI, queue, scheduling, publishing, analytics, or social-platform behavior.

## Context

`TASK-001` is merged into `origin/main` at merge commit `7e9644a`. The repository currently contains the pinned Node/`pnpm` TypeScript workspace, shared format/lint/typecheck/test/build gates, CI, and the tested `@affiliate-content-os/config` package. It has no application process directories.

The approved architecture defines one TypeScript modular monolith deployed as three process types from the same repository:

- `apps/web`: Next.js App Router UI;
- `apps/api`: Fastify HTTP API and backend composition root; and
- `apps/worker`: Node.js background-process composition root.

ADR-001 requires explicit module boundaries and automated import rules. ADR-002 fixes the runtime choices above and forbids putting backend business logic in Next.js route handlers. This task establishes only those executable shells and guardrails. It does not create the future domain modules or any product workflow.

The current Windows checkout also exposes a TASK-001 quality-gate portability defect: tracked files are stored as LF but are checked out as CRLF when `core.autocrlf=true`, causing `pnpm format:check` to fail even though the working tree is otherwise clean. Resolve this narrowly with repository-owned line-ending rules so the same quality commands pass on Windows and CI. Do not rewrite documentation content as part of normalization.

Read before implementation:

- `AGENTS.md`
- `docs/PRODUCT.md`, especially the Sprint 1 roadmap and non-goals
- `docs/ARCHITECTURE.md`, especially sections 2, 4-6, 15, and 17-21
- `docs/DECISIONS.md`, especially ADR-001, ADR-002, ADR-004, ADR-019, and ADR-020
- `docs/API.md`, especially contract principles and error-handling conventions
- `tasks/TASK-001.md`
- this task in full

## Required implementation

### 1. Preserve and extend the workspace foundation

1. Keep the Node and `pnpm` versions selected by TASK-001 unless a demonstrated compatibility problem requires a documented deviation.
2. Pin all new dependencies in `pnpm-lock.yaml`. Use supported stable versions compatible with the pinned Node release.
3. Add repository-owned line-ending rules, normally `.gitattributes`, so source/config files use LF and `pnpm format:check` is reproducible on Windows and Linux. Normalize files only as required; do not make unrelated content edits.
4. Update the root scripts so these stable gates remain available: `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, and `check`.
5. Add explicit developer commands for the individual process shells using stable names: `dev:web`, `dev:api`, `dev:worker`, `start:web`, `start:api`, and `start:worker`. A root `dev` convenience command may start all three, but it must not replace the individual commands.
6. Update Vitest, ESLint, TypeScript, and build configuration only as necessary to include `apps/*` and architecture checks. None of the existing quality gates may become a no-op.

### 2. Add the web process shell

Create `apps/web` as a private workspace package using Next.js App Router and React.

The web shell must:

- provide a single minimal root page that clearly identifies Affiliate Content OS and says the application shell is running;
- contain no product navigation, mocked dashboard data, login UI, API client, or feature placeholder that implies unavailable functionality;
- use a server-only bootstrap boundary that calls `loadConfig` with an explicitly supplied environment object derived from `process.env` at process/build entry, not from a shared module import side effect;
- keep `@affiliate-content-os/config` and all environment access out of the browser bundle;
- expose no Next.js API route or server action;
- build and run with the documented `dev:web` and `start:web` commands; and
- remain compatible with a later same-origin API/session design without selecting a hosting provider now.

Keep styling local and minimal. This task is not a design-system or product-UI task.

### 3. Add the API process shell

Create `apps/api` as a private workspace package using Fastify.

Separate construction from execution:

- an import-safe application factory creates and returns the Fastify instance without listening, reading global environment state, or installing signal handlers; and
- the executable entry point loads configuration, starts listening, installs bounded `SIGINT`/`SIGTERM` shutdown handling, and exits nonzero after a safe startup failure.

The only route in this task is an unauthenticated operational liveness probe:

```text
GET /health/live
```

It must return HTTP `200`, JSON content type, and this deterministic body:

```json
{ "status": "ok", "service": "api" }
```

The liveness route must not be placed below `/api/v1`, because it is an operational probe rather than a product API. Do not add readiness claims for dependencies that do not exist, a `/api/v1` product route, OpenAPI generation, CORS, cookies, auth hooks, database plugins, or generic application abstractions ahead of demonstrated need.

Bind host and port through validated configuration rather than ad hoc reads scattered through API code. Extend `packages/config` only with the smallest API-listener settings needed to run the shell. Use explicit safe development defaults and strict validation; port values must be valid TCP ports and invalid values must produce the existing non-leaking `ConfigurationError` shape. Document the selected environment variable names and defaults. Do not add vendor, credential, database, queue, or feature settings.

### 4. Add the worker process shell

Create `apps/worker` as a private workspace package using the Node.js runtime without a queue or scheduler library.

The worker shell must:

- load configuration through `@affiliate-content-os/config` only in its executable composition root;
- expose an import-safe runtime function whose dependencies and cancellation signal can be injected for tests;
- enter a long-running idle state without polling, timers, CPU spin, fake jobs, or periodic work;
- signal that startup completed through an injected callback or similarly testable lifecycle boundary;
- stop cleanly when its abort signal is triggered;
- translate `SIGINT` and `SIGTERM` into that graceful shutdown path only in the executable entry point; and
- exit nonzero on configuration/startup failure without logging raw environment values.

The shell must not claim queue connectivity, readiness to process jobs, or successful work execution.

### 5. Integrate `packages/config` safely

1. All three executable process entry points must explicitly call the existing `loadConfig` boundary. Environment access must be limited to composition-root/bootstrap files.
2. Preserve the package's injected-environment design: shared modules and application factories must receive typed configuration/dependencies and must not read `process.env` themselves.
3. Preserve safe redaction. If startup metadata is emitted, use `getRedactedConfigMetadata`; never log the raw environment or full configuration object.
4. Add focused configuration tests for every new key, including defaults, valid overrides, malformed/non-string values, boundary port values, unsafe host input where relevant, immutability, unknown-key filtering, and sentinel-value non-disclosure.
5. Ensure a clean checkout can run development/tests without relying on pre-existing ignored `dist` output from `packages/config`. Workspace package resolution and script ordering must be deliberate and documented.
6. Do not add a populated `.env` file. A sanitized `.env.example` is allowed only if it contains no secrets and materially improves the documented startup flow.

### 6. Enforce architecture dependency direction

Add a maintained static dependency-boundary checker, preferably `dependency-cruiser` with a committed JavaScript/ESM configuration, and expose it through a root `lint:boundaries` script. The existing `lint` or `check` path must run it automatically.

Enforce at least these rules for production source:

| From                      | Allowed internal dependencies                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`         | none                                                                                                                             |
| `packages/application`    | `packages/domain`                                                                                                                |
| `packages/contracts`      | none                                                                                                                             |
| `packages/config`         | none                                                                                                                             |
| `packages/observability`  | `packages/config`                                                                                                                |
| `packages/infrastructure` | `packages/domain`, `packages/application`, `packages/contracts`, `packages/config`, `packages/observability`                     |
| `packages/test-support`   | any `packages/*`, but test code only                                                                                             |
| `apps/web`                | `packages/contracts`, server-only `packages/config`, and browser-safe `packages/observability` exports when those packages exist |
| `apps/api`                | production `packages/*` needed as a composition root, excluding `packages/test-support`                                          |
| `apps/worker`             | production `packages/*` needed as a composition root, excluding `packages/test-support`                                          |

Also enforce:

- packages never import from `apps/*`;
- apps never import from another app;
- production code never imports `packages/test-support`;
- `apps/web` never imports `packages/domain`, `packages/application`, or `packages/infrastructure`;
- workspace-to-workspace imports use declared package public exports, not another workspace's `src`, test, or relative filesystem path;
- circular internal dependencies are rejected; and
- framework packages remain in their owning app: Next.js/React are not dependencies of shared backend packages, and Fastify is not a dependency of domain/application/contracts/config packages.

Rules must cover future paths named in the approved architecture even when those packages do not exist yet. Do not create empty `domain`, `application`, `infrastructure`, `contracts`, `observability`, or `test-support` packages merely to exercise the rules.

Add automated boundary tests that prove at least one allowed edge and representative forbidden edges are classified correctly. At minimum prove rejection of package-to-app, app-to-app, web-to-infrastructure, application-to-infrastructure, production-to-test-support, and cross-workspace deep imports. Testing only the current valid graph is insufficient because it would not prove the forbidden rules work.

### 7. Documentation

Update `README.md` to describe the three real process shells, prerequisites, install/build flow, required environment/defaults, individual development/start commands, liveness probe, graceful worker behavior, architecture-boundary command, tests, and current workspace map.

Remove TASK-001's statement that application processes do not exist. State plainly that the processes are foundation shells only and list the major unavailable capabilities without suggesting they are mocked.

## Expected files

Exact source filenames may vary where framework conventions require it, but expected scope includes:

- `.gitattributes`
- root `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml` only if a justified adjustment is necessary
- root ESLint/Vitest/TypeScript configuration as needed
- dependency-boundary configuration and focused boundary tests/fixtures
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- Next.js App Router files for the root layout/page and minimal styling
- a server-only web configuration/bootstrap module
- `apps/web` tests
- `apps/api/package.json`
- `apps/api/tsconfig.json` and build configuration if separate
- `apps/api/src/app.ts` or equivalent import-safe factory
- `apps/api/src/main.ts` or equivalent executable entry point
- `apps/api` tests
- `apps/worker/package.json`
- `apps/worker/tsconfig.json` and build configuration if separate
- `apps/worker/src/worker.ts` or equivalent import-safe runtime
- `apps/worker/src/main.ts` or equivalent executable entry point
- `apps/worker` tests
- focused updates to `packages/config/src/*` and `packages/config/test/*`
- `README.md`

Do not create placeholder architecture packages or generated build/coverage output.

## Database changes

None.

Do not add PostgreSQL, Redis, an ORM, a migration tool, schema files, database environment variables, containers, repositories, queue clients, or local infrastructure. Local infrastructure is a later Sprint 1 slice.

## API changes

Add only the operational `GET /health/live` endpoint with the exact response defined above.

Do not implement `/api/v1`, OpenAPI, Problem Details application errors, product resources, auth/session endpoints, or external callbacks in this task. The liveness result states only that the HTTP process can answer; it must not imply that future dependencies are ready.

## Frontend changes

Add only the minimal root App Router page and framework-required layout/styles. It must be usable enough to verify the web runtime but contain no application workflow, forms, dashboards, authentication state, sample products, generated content, schedules, analytics, or social-account UI.

## Backend changes

Add the Fastify process composition/factory boundary, operational liveness route, listener lifecycle, and idle Node worker lifecycle. Extend `packages/config` only for the API listener settings needed here.

Do not add domain/application/infrastructure modules, persistence, queues, cron/schedulers, background handlers, outbound HTTP clients, OAuth, AI SDKs, or social adapters.

## Security requirements

- Never commit secrets, tokens, credential-like fixtures, populated environment files, or generated output.
- Only executable composition roots may read `process.env`; importing an app factory, page module, or worker runtime in a test must not read global environment state or start a process.
- Invalid configuration must fail before the API begins listening or the worker reports started.
- Configuration failures, startup failures, shutdown handling, tests, and logs must not expose raw environment values.
- The config package must remain server-only from the web browser's perspective. Add a build/static assertion or boundary rule that prevents it from entering client modules.
- Default API binding must be documented and appropriate for local development. Do not enable permissive CORS or expose a network listener from tests unnecessarily; use Fastify injection for route tests.
- Liveness output must contain no configuration, version, host, filesystem, stack, dependency, or environment details.
- Signal handlers must be installed by executable entry points only and removed/settled during shutdown so tests and repeated lifecycle calls do not leak listeners.
- Dependency rules must fail closed for recognized workspace layers and must not silently skip TypeScript path aliases or workspace package imports.
- Do not add install/postinstall hooks that execute downloaded code outside normal pinned package installation.

## Edge cases

- Clean checkout with no `dist`, `.next`, cache, `.env`, or coverage directory.
- Windows checkout with `core.autocrlf=true` and Linux CI checkout.
- Missing optional API listener variables and documented default selection.
- API port at valid lower/upper boundaries and invalid zero, negative, greater-than-65535, decimal, whitespace-padded, empty, and nonnumeric inputs.
- Invalid configuration prevents startup and does not leak sentinel input.
- Repeated Fastify factory calls return independent instances and do not listen implicitly.
- Unknown API route returns Fastify's normal `404`; no catch-all fake success.
- Liveness response is deterministic and does not claim dependency readiness.
- API receives `SIGINT` or `SIGTERM` while starting, running, or already closing; shutdown remains bounded and idempotent.
- Worker is aborted before startup completes, while idle, and more than once; it exits without doing work or leaking a pending timer/listener.
- Importing worker/API modules in tests does not install process-global handlers.
- Web server configuration is never referenced from a client component or emitted browser chunk.
- Boundary checks handle package-name imports, relative cross-workspace imports, aliases, type-only imports, dynamic imports, and cycles.
- Boundary test fixtures do not become production workspace packages or get included in application builds.

## Acceptance criteria

1. A clean checkout completes `corepack pnpm install --frozen-lockfile` with the pinned toolchain and no prebuilt workspace artifacts.
2. `dev:web`, `dev:api`, and `dev:worker` each start their documented process from that checkout using the documented development defaults/setup.
3. The production flow builds first; `start:web`, `start:api`, and `start:worker` run only built/production artifacts as appropriate and do not transpile TypeScript implicitly in production.
4. The web root page renders successfully and its browser output contains no raw environment/config object or server-only config module.
5. The API application factory is import-safe and testable with Fastify injection. `GET /health/live` returns exactly HTTP `200`, JSON, and `{ "status": "ok", "service": "api" }`; an unknown route returns `404`.
6. The API listener loads validated config before listening and closes gracefully on both supported termination signals.
7. The worker loads validated config, reports startup, remains idle without polling/timers/fake jobs, and resolves cleanly on cancellation and supported termination signals.
8. Invalid configuration prevents each process from starting and produces a safe nonzero failure without echoing sentinel values.
9. New API listener configuration is strictly validated, immutable, redacted safely, ignores unrelated OS keys, and is fully unit-tested without regressing TASK-001 behavior.
10. `lint:boundaries` checks the real source graph and fails for every forbidden direction listed in this task.
11. Automated negative boundary tests demonstrate that representative forbidden imports are rejected; deleting or weakening a required rule makes a test fail.
12. No shared package imports from an app, no app imports another app, web has no backend-internal dependency, and no workspace deep-imports another workspace's source.
13. `pnpm format:check` passes in a Windows CRLF-prone checkout and Linux CI due to committed repository policy, not developer-global Git configuration.
14. `corepack pnpm lint`, `typecheck`, `test`, `build`, and `check` run real checks for all three apps and `packages/config` and pass.
15. Tests cover the web shell, API factory/liveness/error behavior, worker lifecycle/cancellation, process configuration, and both positive and negative dependency boundaries. Snapshot-only or existence-only tests are insufficient.
16. README commands and workspace map match the implemented behavior and explicitly state that these are non-product foundation shells.
17. The final diff contains no database/auth/product/AI/scheduling/social functionality, placeholder future packages, secrets, populated environment files, `.next`, `dist`, coverage, cache, or unrelated documentation rewrites.

## Test plan

### Automated tests

- Web: render the root shell and assert its stable heading/status content; verify the server-only configuration bootstrap with injected valid and invalid environments; add a build/static assertion that server configuration does not enter client code.
- API: create multiple independent Fastify instances; inject the liveness request; assert exact status/content type/body; assert unknown-route `404`; test startup rejection and graceful/idempotent close without binding a public test port.
- Worker: test startup notification, idle/pending behavior, cancellation before and after startup, repeated abort, failure propagation, and absence of fake work/timer polling.
- Config: test defaults and valid API listener overrides; every numeric boundary/invalid representation; host validation if configurable; immutability; unknown-key filtering; redacted metadata; and sentinel non-disclosure.
- Architecture: run the checker against the real graph and focused fixtures for allowed and forbidden dependency cases, including aliases, type-only/dynamic imports, deep imports, and cycles where supported by the selected checker.

### Manual smoke verification

From a clean state, start each process separately:

```text
corepack pnpm dev:web
corepack pnpm dev:api
corepack pnpm dev:worker
```

Verify the web root in a browser, request `GET /health/live`, stop the API and worker with both supported signals where the OS permits, and confirm graceful exit with no raw configuration in output. Stop each process before starting the next if ports or terminal ownership conflict.

Build before checking production start commands:

```text
corepack pnpm build
corepack pnpm start:web
corepack pnpm start:api
corepack pnpm start:worker
```

### Required verification commands

Run and report verbatim with results:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint:boundaries
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

Also inspect `git status --short`, the final diff, and tracked files to confirm that no secret, environment, generated build, cache, or out-of-scope artifact is committed.

## Out of scope

- Database, migrations, ORM, repositories, PostgreSQL, Redis, or containers.
- Local infrastructure beyond the three local runtime processes.
- Authentication, sessions, authorization, workspaces, tenancy, roles, or audit records.
- Product catalog, affiliate URLs, fact sets, or any product behavior.
- Domain/application/infrastructure feature modules or placeholder packages.
- AI gateways, model SDKs, prompts, analyses, generation, or evaluation.
- Queue clients, jobs, outbox, scheduling, cron, polling, leases, retries, or worker handlers.
- Content, approval, publishing, analytics, or compliance functionality.
- OAuth, social connections, Threads, TikTok, adapters, webhooks, or any external API call.
- OpenAPI generation, product API routes, API clients, CORS/session policy, or error-contract implementation beyond framework-safe startup failures.
- Observability platform selection, OpenTelemetry setup, durable audit logging, or a shared logging package.
- Production deployment, Dockerfiles, infrastructure as code, cloud/vendor selection, or CI deployment jobs.
- Design system, authenticated app shell, dashboard, forms, sample/mock business data, or end-to-end product journeys.
- Microservices, Kubernetes, Kafka, CQRS, event sourcing, or a monorepo build orchestrator without a demonstrated need.
- Changes to approved architecture/product/API/database documents.

## Implementation handoff requirements

This specification is presented to the Product Owner for approval. Antigravity must not begin implementation until the Product Owner explicitly approves it.

After approval, Antigravity must follow `AGENTS.md`; read the referenced documentation and this task before coding; and report any deviation before redesigning a boundary.

Before declaring the implementation ready for Codex review, report:

- created, modified, and deleted files;
- chosen framework/dependency versions and boundary-checking approach;
- the exact environment variables/defaults introduced;
- manual smoke results for web, API, and worker startup/shutdown;
- every required verification command and its actual result;
- known limitations or deviations; and
- final `git status --short` plus confirmation that generated and sensitive artifacts are untracked.

Do not claim architectural approval. Codex will review the user requirement, this specification, the actual code/diff, and executed evidence before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
