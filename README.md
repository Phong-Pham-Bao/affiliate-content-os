# Affiliate Content OS

Deterministic development foundation, runtime process shells, and architecture boundary enforcement for Affiliate Content OS.

> **Status Notice:** This repository contains the deterministic monorepo foundation, configuration boundary (`@affiliate-content-os/config`), and three minimal runtime process shells (`apps/web`, `apps/api`, `apps/worker`). These processes are foundation shells only. Databases, migrations, ORM, queue systems, background job processors, authentication, domain workflows, AI models, and social platform integrations do not exist yet.

## Prerequisites

- **Node.js**: `24.14.0` (Active LTS pinned in `.nvmrc`, engines range `>=24.14.0 <25.0.0`)
- **pnpm**: `12.4.2` (pinned via `packageManager` and engines in `package.json`)

## Setup

Enable Corepack or use installed `pnpm`:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

## Runtime Process Shells

The repository defines three independent runtime processes:

1. **Web Application Shell (`apps/web`)**: Next.js App Router application providing the root layout and landing page. It enforces server-only configuration boundaries and contains no application forms, dashboards, or external client-side calls.
2. **API Server Shell (`apps/api`)**: Fastify-based HTTP application exposing an operational `GET /health/live` liveness endpoint. It provides an import-safe application factory (`createApp`), loads validated configuration before binding, and handles graceful shutdown via `SIGINT` and `SIGTERM`.
3. **Worker Runtime Shell (`apps/worker`)**: Pure event-driven Node.js worker runtime. It initializes with validated configuration, reports startup via lifecycle callbacks, and remains in an idle state without polling, timers, or CPU spin until receiving cancellation via `AbortSignal` or termination signals.

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

### API Liveness Endpoint

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

An unknown route returns standard Fastify `404 Not Found`.

## Quality Gates

The workspace enforces strict verification commands:

| Command                | Description                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm format:check`    | Check code formatting via Prettier                                                       |
| `pnpm format`          | Auto-format files via Prettier                                                           |
| `pnpm lint`            | Lint codebase with ESLint and run architecture boundary checks                           |
| `pnpm lint:boundaries` | Enforce architecture layer and dependency direction rules via dependency-cruiser         |
| `pnpm typecheck`       | Run strict TypeScript type checking across source and tests for all packages and apps    |
| `pnpm test`            | Run unit and boundary tests with Vitest                                                  |
| `pnpm build`           | Compile package source and build production artifacts                                    |
| `pnpm check`           | Run all quality gates in sequence (`format:check`, `lint`, `typecheck`, `test`, `build`) |

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
│   └── config/                  # Environment configuration boundary & redaction helper
│       ├── src/                 # Configuration validation, redaction, and types
│       ├── test/                # Configuration unit & security tests
│       └── package.json
├── test/
│   ├── boundaries.test.ts       # Architecture boundary verification test suite
│   └── fixtures/boundaries/     # Fixtures for verifying forbidden dependency directions
├── tasks/                       # Task specifications (Codex)
├── .dependency-cruiser.js       # Dependency-cruiser architecture boundary rules
├── .editorconfig
├── .gitattributes               # LF line-ending normalization
├── .gitignore
├── .nvmrc                       # Pinned Node.js version (24.14.0)
├── eslint.config.mjs            # Flat ESLint configuration with boundary checks
├── package.json                 # Root workspace manifest & quality scripts
├── pnpm-lock.yaml               # Pinned dependency lockfile
├── pnpm-workspace.yaml          # Workspace package patterns (apps/*, packages/*)
├── tsconfig.base.json           # Strict TypeScript compiler options
└── vitest.config.ts             # Vitest test runner configuration
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

### Exported API

```ts
import {
  loadConfig,
  getRedactedConfigMetadata,
  ConfigurationError,
  type AppConfig,
  type RedactedConfigMetadata,
  type ConfigurationIssue,
  type RawEnvironment,
  type NodeEnv,
  type LogLevel,
  ALLOWED_NODE_ENVS,
  ALLOWED_LOG_LEVELS,
  DEFAULT_LOG_LEVEL,
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
} from '@affiliate-content-os/config';
```

- `loadConfig(rawEnv?: unknown): AppConfig`: Validates and returns an immutable `AppConfig` object `{ nodeEnv, logLevel, appBaseUrl?, apiHost, apiPort }`. Throws `ConfigurationError` on any validation failure.
- `getRedactedConfigMetadata(config: AppConfig): RedactedConfigMetadata`: Generates startup-safe diagnostic metadata `{ nodeEnv, logLevel, hasAppBaseUrl, appBaseUrlOrigin?, apiHost, apiPort }`. The `appBaseUrlOrigin` is reduced strictly to scheme, host, and port (e.g. `https://example.com:8443`), stripping any path, query, or fragment.
- `ConfigurationError`: Subclass of `Error` containing a frozen `issues: readonly ConfigurationIssue[]` list and a safe `toJSON()` implementation.
