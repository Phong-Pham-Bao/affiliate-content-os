# TASK-003-REMEDIATION-01 - Persistence Foundation Review Remediation

Status: Approved by Product Owner
Owner: Antigravity (Implementation Engineer)

Depends on: approved `TASK-003` and the implementation currently on `agy/task-003-persistence-foundation`

## Objective

Resolve every finding from the latest `TASK-003` review without expanding the persistence-foundation scope:

1. keep the complete Trivy vulnerability scan and introduce one formal, documented, path-scoped, expiring exception for `CVE-2025-68121` in `/usr/local/bin/gosu`;
2. preserve every transaction callback rejection, including falsy rejection values;
3. prevent database credentials from surviving in `infra:up` failures or transaction `Error` stacks;
4. make a missing integration-test `NODE_ENV` fail closed rather than default to `test`;
5. restore API and worker environment/configuration/CA ownership exclusively to executable composition roots;
6. guarantee worker cleanup deadline expiry terminates with exit code `1`; and
7. correct the README's inaccurate statement about privileges of the shared local PostgreSQL role.

This is a remediation specification only. It does not approve the existing `TASK-003` implementation and does not authorize implementation until the Product Owner approves this task.

## Context

The reviewed baseline is `origin/main...HEAD` on branch `agy/task-003-persistence-foundation`, with `HEAD` at `6acfa31` when this specification was prepared. The relevant approved constraints remain those in `AGENTS.md`, `tasks/TASK-003.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/API.md`, and `docs/DATABASE.md`.

The current implementation has these concrete defects:

- `.github/workflows/ci.yml` runs the required all-package Trivy scans, but the fixable-critical gate now fails on `CVE-2025-68121` attributed to the Go standard library embedded in `/usr/local/bin/gosu`.
- `packages/infrastructure/src/database/database.ts` decides whether to rethrow a callback failure with `if (transactionError)`, so rejections with `undefined`, `null`, `false`, `0`, `NaN`, or `''` are treated as success after rollback and may resolve instead of reject.
- `scripts/infra-up.mjs` includes `lastError.message` verbatim in console and thrown errors. The transaction path redacts an `Error.message` in place but leaves the pre-existing `Error.stack` unchanged.
- `packages/infrastructure/test/integration/helpers/setup.ts` uses `process.env['NODE_ENV'] ?? 'test'`, converting missing safety configuration into permission for destructive test-database operations.
- `apps/api/src/server.ts` and `apps/worker/src/runner.ts` load `process.env`, database configuration, and CA files even though `apps/api/src/main.ts` and `apps/worker/src/main.ts` are the executable composition roots that already own those responsibilities.
- the worker probe-failure path catches and discards a database-close deadline failure, then may select exit code `0` merely because the abort signal is set.
- `README.md` says the local runtime role cannot create or drop databases, while the single Compose role is the cluster bootstrap superuser and is reused by runtime, migration, and test-admin example URLs.

The remediation must preserve the modular monolith, existing PostgreSQL version and immutable image pin, explicit migration workflow, real-PostgreSQL tests, and one total shutdown deadline.

### Upstream evidence and formal exception basis

Evidence reviewed on 2026-10-24:

- The Go vulnerability is in `crypto/tls` session resumption when trust configuration changes between the initial and resumed handshake: [Go issue 77113](https://github.com/golang/go/issues/77113) and the [Debian CVE tracker](https://security-tracker.debian.org/tracker/CVE-2025-68121).
- The gosu maintainer's [security policy](https://github.com/tianon/gosu/blob/master/SECURITY.md) states that Go standard-library CVEs are not applicable to gosu when gosu does not invoke the vulnerable functionality and directs verification through its `govulncheck` wrapper.
- In the upstream [gosu CVE issue](https://github.com/tianon/gosu/issues/176), the maintainer directed reporters to that policy; recorded binary analysis reports no reachable vulnerabilities and reports that gosu 1.19 does not link `crypto/tls`, `crypto/x509`, or `net`.
- The official PostgreSQL 18 Bookworm [Dockerfile](https://github.com/docker-library/postgres/blob/master/18/bookworm/Dockerfile) installs the signed gosu 1.19 release binary at `/usr/local/bin/gosu` solely to change from root to the `postgres` user.

This evidence supports a temporary non-reachability exception for exactly the reported gosu binary finding. It does not establish that the CVE is harmless in other Go binaries, packages, paths, image digests, or execution contexts.

The authorized exception, if this task is approved, is:

| Field             | Required value                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exception ID      | `TASK-003-CVE-2025-68121-GOSU`                                                                                                                                                                                                                                                    |
| Vulnerability     | `CVE-2025-68121` only                                                                                                                                                                                                                                                             |
| Image             | exactly the PostgreSQL reference already shared by `compose.yaml` and `.github/workflows/ci.yml`: `postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`                                                                                |
| Target path       | `usr/local/bin/gosu` only, using the exact path emitted by Trivy; no wildcard, directory, package-wide, or image-wide match                                                                                                                                                       |
| Component/context | upstream gosu 1.19 binary used by the official image entrypoint for user switching; not an application TLS client or server                                                                                                                                                       |
| Rationale         | the vulnerable `crypto/tls` execution path is not linked/reachable in the upstream gosu binary according to the cited upstream policy and recorded binary `govulncheck` result                                                                                                    |
| Effective date    | the Product Owner approval date for this task                                                                                                                                                                                                                                     |
| Expiration        | `2026-12-31`; configure Trivy `expired_at: 2026-12-31` and treat the exception as invalid on expiry                                                                                                                                                                               |
| Owner             | Lead Architect / CTO / Final Reviewer (Codex), with implementation maintained by Antigravity                                                                                                                                                                                      |
| Removal triggers  | remove immediately if the pinned image changes, the finding moves or changes component, upstream evidence is contradicted, gosu gains an affected TLS path, Trivy reports another occurrence, or an upstream PostgreSQL image with a non-vulnerable gosu binary becomes available |
| Renewal           | prohibited without a new Product Owner-approved, evidence-backed task; no automatic extension                                                                                                                                                                                     |

## Required implementation

### 1. Add the narrow, time-bounded Trivy exception without weakening scanning

1. Keep Trivy pinned to `v0.76.1`, keep the exact PostgreSQL image digest, keep `--scanners vuln`, and retain both the reviewable `HIGH,CRITICAL` scan and the fixable-`CRITICAL` blocking scan. Do not add `--pkg-types os`, `--skip-files`, `--skip-dirs`, `continue-on-error`, exit-code masking, or a reduced scanner target.
2. Add `.trivyignore.yaml` with exactly one vulnerability item and no other suppression category or item:

   ```yaml
   vulnerabilities:
     - id: CVE-2025-68121
       paths:
         - usr/local/bin/gosu
       expired_at: 2026-12-31
       statement: >-
         TASK-003-CVE-2025-68121-GOSU: temporary non-reachability exception for
         upstream gosu 1.19 in the exact pinned PostgreSQL image; see
         security/exceptions/TASK-003-CVE-2025-68121-GOSU.md.
   ```

   If Trivy `v0.76.1` emits the target with a leading slash, use that exact emitted spelling consistently instead; do not include both spellings or a wildcard.

3. Pass `--ignorefile .trivyignore.yaml --show-suppressed` to both existing image scans. `--show-suppressed` is mandatory so the exception remains visible in CI logs.
4. Add `security/exceptions/TASK-003-CVE-2025-68121-GOSU.md` containing every formal-exception field above, the cited upstream URLs, the observed Trivy target/package/version/fixed-version data, the exact image reference and digest, approval/effective/expiry dates, risk analysis, compensating controls, removal triggers, and renewal prohibition.
5. Add a deterministic policy validator, covered by unit tests, that fails unless:
   - the YAML document has only the `vulnerabilities` top-level key;
   - it has exactly one item;
   - the item has exactly the required ID, one exact non-wildcard path, expiry, and exception-document reference;
   - the expiry is strictly in the future at validation time;
   - the exception document contains the same ID, image digest, path, expiry, and evidence URLs;
   - both CI Trivy commands name the explicit ignore file and show suppressed results; and
   - neither command narrows package types or uses any other suppression/skip/exit-masking mechanism.
6. In CI, run the exception-policy validator immediately before scanning. The blocking scan must fail for every other fixable critical vulnerability. The exception must cease suppressing automatically on expiry.
7. Do not replace the official image, rebuild gosu locally, add a custom Dockerfile, or change the PostgreSQL pin in this remediation. An upstream fixed-image adoption requires pin verification and its own reviewed change.

### 2. Preserve falsy transaction callback rejections

1. Replace truthiness-based failure detection with an explicit failure-state discriminant that is independent of the rejection value.
2. If the callback rejects with any value, execute `ROLLBACK`, release the client exactly once, and reject `withTransaction` with that same primary rejection value after cleanup, even when the value is `undefined`, `null`, `false`, `0`, `NaN`, or `''`.
3. A callback that resolves to a falsy value remains a successful transaction: issue `COMMIT`, release once, and resolve with the exact value.
4. Rollback and release failures must not replace the callback's primary rejection, including a falsy primary rejection. Existing behavior for begin, query, commit, rollback, release, and checked-out-client errors must remain covered.

### 3. Eliminate credential leakage from infra-up errors and transaction stacks

1. `scripts/infra-up.mjs` must never interpolate a raw driver error message, stack, connection string, configuration object, host, database name, username, or password into its logged or thrown readiness failure.
2. Classify or replace readiness failures with an allowlisted generic reason. The message may include the operation and bounded timeout/attempt information, but no driver-controlled text.
3. Preserve a callback `Error` as the primary transaction failure while sanitizing every externally observable textual surface before propagation. At minimum, sanitize `message` and `stack` consistently; `String(error)`, `error.stack`, `util.inspect(error)`, JSON output where defined, logger arguments, and process-level output must not contain a PostgreSQL URL or its username, password, host, port, database, query, or fragment.
4. Do not attach the raw error as an enumerable property or `cause` if doing so makes credentials inspectable. Do not log raw driver or callback errors.
5. Use centralized, tested redaction/sanitization behavior rather than adding divergent regular expressions to API, worker, infrastructure, and scripts. A narrow dependency from a root script to the infrastructure public database error utility is acceptable only if it remains import-safe and does not initialize a pool; otherwise add a small root-safe utility in an existing appropriate boundary and test it.

### 4. Make integration safety fail closed when `NODE_ENV` is absent

1. Remove the `?? 'test'` fallback from `setupIsolatedTestDatabase` and every destructive helper path.
2. The helper may use an explicitly injected `effectiveNodeEnv`; otherwise it may read the actual `process.env.NODE_ENV`, but missing, empty, or any value other than exact lowercase `test` must fail before an administrative connection and before `CREATE DATABASE`, backend termination, or `DROP DATABASE`.
3. Keep the cross-platform local launchers responsible for explicitly setting `NODE_ENV=test` after loading `.env`. Keep CI explicitly setting `NODE_ENV=test`.
4. Error output must identify `NODE_ENV` as invalid/missing without echoing other environment values or the destructive sentinel.

### 5. Restore configuration and CA ownership to composition roots

1. `apps/api/src/main.ts` and `apps/worker/src/main.ts` are the executable composition roots. Only they may read `process.env`, call `loadConfig`/`loadDatabaseConfig`, read and validate `DATABASE_SSL_CA_FILE`, create the database, and select process termination/logging adapters.
2. `apps/api/src/server.ts` must require injected, already validated `AppConfig` and `Database`. Remove `databaseConfig`, environment fallback, CA-file I/O, and database construction from `startApiServer`.
3. `apps/worker/src/runner.ts` must require injected, already validated `AppConfig` and `Database`. Remove `databaseConfig`, environment fallback, CA-file I/O, and database construction from `startWorker`.
4. Runtime modules remain import-safe and testable, with no environment or filesystem reads, pool construction, or signal installation at import time.
5. CLI and integration-test entry points may continue to own their narrowly scoped environment/config/CA setup. Shared infrastructure/config modules remain injected and import-safe.
6. Do not create a generic dependency-injection container or a new configuration framework.

### 6. Make worker deadline expiry unconditionally nonzero

1. In every startup and shutdown phase, any cleanup failure or exhaustion of the one shared monotonic deadline is a failure outcome and invokes the termination boundary exactly once with exit code `1`.
2. An aborted signal may produce exit code `0` only when probe/runtime cancellation and all ordered cleanup complete before the shared deadline without error.
3. Never catch and discard a `raceWithDeadline` rejection before choosing the exit code. Preserve the cleanup timeout/failure as the primary reported failure when it is more severe than the initiating abort.
4. Repeated signals, abort events, and programmatic close calls must share one close promise and one absolute deadline; they must not reset timers or reverse a previously selected nonzero result.
5. Late probe/runtime/pool completion must not emit a success message or invoke termination again after deadline expiry.
6. Keep deterministic injected-clock/timer tests; do not add real sleeps to unit tests.

### 7. Correct the README privilege claim

1. Replace the claim that the local `DATABASE_URL` role lacks create/drop privileges with an accurate statement: the default `.env.example` and Compose development setup reuse the bootstrap `acos_local` PostgreSQL superuser for runtime, migration, and disposable-test administration.
2. State that the three URLs demonstrate configuration separation, not least-privilege role enforcement, in the local-only TASK-003 setup.
3. Retain the production requirement for distinct least-privilege runtime, migration, and test-administration principals. Do not claim those roles are provisioned by this task.
4. Do not add role-provisioning SQL or change local credentials as part of this remediation.

## Expected files

Expected implementation scope is limited to files needed for these findings:

- `.github/workflows/ci.yml`;
- `.trivyignore.yaml`;
- `security/exceptions/TASK-003-CVE-2025-68121-GOSU.md`;
- `scripts/verify-trivy-exception.mjs` or an equivalently narrow deterministic validator;
- `package.json` only if a stable validator command is added;
- `test/scripts.test.ts` or a focused root security-policy test;
- `scripts/infra-up.mjs`;
- `packages/infrastructure/src/database/database.ts`;
- `packages/infrastructure/src/database/errors.ts` only if centralized stack-safe sanitization belongs there;
- focused infrastructure unit and integration tests;
- `packages/infrastructure/test/integration/helpers/setup.ts`;
- `apps/api/src/server.ts`, `apps/api/src/main.ts`, and focused API tests as needed for the ownership boundary;
- `apps/worker/src/runner.ts`, `apps/worker/src/main.ts`, and focused worker tests;
- `README.md`; and
- lockfile/configuration files only if an approved implementation demonstrates they are strictly required. No new dependency is expected.

Do not modify `docs/` architecture/product/API/database baselines for this remediation.

## Database changes

None.

Do not add or alter migrations, tables, roles, grants, extensions, seed data, or the PostgreSQL image/version/digest. The local privilege correction is documentation-only.

## API changes

None.

`GET /health/live` must remain HTTP `200` with exactly `{ "status": "ok", "service": "api" }` after successful startup. Do not add readiness or database-management routes.

## Frontend changes

None.

Do not modify `apps/web`, browser behavior, UI, or frontend dependencies.

## Backend changes

Make only the transaction, error-sanitization, destructive-test guard, composition-root ownership, and worker termination changes specified above. Preserve public database interfaces unless a minimal type correction is required to represent the existing callback contract safely.

No repositories, business schema, use cases, jobs, queues, retries, or product features are part of this remediation.

## Security requirements

- The full Trivy Go-binary and OS-package vulnerability analysis remains enabled. Only `CVE-2025-68121` at the one exact gosu path in the one exact pinned image may be suppressed, and the suppressed finding remains visible in CI output.
- The exception must be documented, Product Owner-approved, time-bounded, automatically fail closed on expiry, and removed earlier when a removal trigger occurs. No wildcard, second CVE, broad package/image suppression, undocumented `.trivyignore`, Rego policy, VEX assertion, file skip, directory skip, or OS-only scan is permitted.
- Treat every database URL and its username, password, host, port, database, query, and fragment as secret across errors, stacks, inspection, serialization, logs, child-process output, and CI output.
- Destructive database helpers require explicit `NODE_ENV=test` and the existing exact sentinel and target guards. Missing configuration never grants permission.
- Only executable composition roots read process environment or CA files for API/worker startup. Shared runtime modules accept validated dependencies.
- Cleanup deadline expiry is a process failure. It can never be reported as graceful success.
- Do not commit populated environment files, real credentials, database dumps, scan reports, generated output, or local Docker data.

## Edge cases

- The Trivy exception file is missing, malformed, expired, contains a second item, contains an extra top-level category, omits its exact path, uses `/usr/local/bin/*`, names a second CVE, or is referenced by only one of the two scan commands.
- Trivy reports `CVE-2025-68121` in another file, package, or image; another critical vulnerability appears; the pinned digest changes; or upstream ships a remediated image before the exception expires.
- A transaction callback resolves with or rejects with each falsy JavaScript value; rollback fails; release fails; both fail; the callback rejection is a normal `Error`, `DatabaseError`, custom error, primitive, or object.
- A transaction callback error embeds encoded and unencoded PostgreSQL credentials in its message and stack, including reserved characters and IPv6 hosts.
- `infra:up` sees authentication, DNS, connection-refused, timeout, and arbitrary driver errors whose message/stack contains the full connection URL.
- Integration setup receives missing, empty, `development`, `production`, whitespace-padded, uppercase, or non-string `NODE_ENV`, including when the destructive sentinel and URL are otherwise valid.
- API/worker runtime modules are imported while `process.env` contains invalid or sentinel values and while filesystem/database constructors are spied; import and injected execution perform no unauthorized reads or construction.
- Worker shutdown is requested before/during probe, during runtime startup, during runtime settlement, and during pool close; each stage may hang or reject at the exact deadline boundary.
- Cleanup times out after a signal abort, repeated signals arrive, termination already chose code `1`, or a late cleanup promise resolves.
- README wording is checked against `.env.example` and `compose.yaml`, which currently use one bootstrap superuser for all three URLs.

## Acceptance criteria

1. All seven review findings are resolved and no unrelated behavior is changed.
2. Both required Trivy scans still analyze vulnerabilities without `--pkg-types os` or file/directory skips; both use the explicit path-scoped exception and show suppressed results.
3. The exception policy and document match the formal values in this task, contain exactly one suppression for `CVE-2025-68121` at the exact gosu path, and expire on `2026-12-31` without fallback or automatic renewal.
4. CI fails for an expired exception, any broadened/mismatched policy, any additional suppressed finding, or any other fixable critical vulnerability.
5. Transaction callbacks that reject with `undefined`, `null`, `false`, `0`, `NaN`, or `''` roll back, release once, and remain rejected with the primary value; callbacks resolving to the same values commit and resolve.
6. Rollback/release failures never replace a callback rejection solely because it is falsy.
7. Sentinel database credentials are absent from infra-up console output/thrown errors and from transaction error messages, stacks, inspection, serialization, and logger/process output.
8. Missing or invalid `NODE_ENV` fails before any destructive test-database connection or SQL; explicit `test` through the supported launcher and CI remains successful.
9. API `server.ts` and worker `runner.ts` do not read `process.env`, load config, read CA files, or construct databases. Their executable `main.ts` composition roots inject validated config and constructed databases.
10. Worker cleanup deadline expiry and cleanup failure terminate exactly once with exit code `1`, including when shutdown began from a signal/abort during probe. Only fully successful cleanup before the deadline exits `0`.
11. README accurately describes the local role as the shared Compose bootstrap superuser and distinguishes local configuration separation from production least privilege.
12. Existing TASK-003 database, migration, integration, pinning, API liveness, and architecture tests remain passing.
13. A clean checkout completes the exact verification sequence below with no manual source/config edits, and the final tracked diff contains only remediation-scope files with no generated or secret artifacts.

## Test plan

### Unit and policy regression tests

Add exact automated cases for:

- Trivy policy: accept the one exact YAML item; reject missing/expired dates, a second item, a second top-level category, wildcard/alternate paths, absent statement/document, changed digest/ID/path/date, missing `--show-suppressed`, missing `--ignorefile`, `--pkg-types os`, `--skip-files`, `--skip-dirs`, Rego/VEX suppression, `continue-on-error`, or exit-code masking.
- Trivy command contract: assert both commands retain `--scanners vuln --timeout 10m --no-progress --format table`, the first retains `--severity HIGH,CRITICAL --exit-code 0`, the second retains `--severity CRITICAL --ignore-unfixed --exit-code 1`, and the step retains `timeout-minutes: 15`.
- Transaction rejection: table-test `undefined`, `null`, `false`, `0`, `NaN`, and `''`; for each assert `BEGIN`, `ROLLBACK`, no `COMMIT`, one release, and rejection with the exact primary value.
- Transaction falsy success: table-test the same values as resolved callback results; for each assert `BEGIN`, `COMMIT`, no `ROLLBACK`, one release, and exact result preservation.
- Transaction cleanup combinations: each falsy rejection with rollback failure, release failure, and both; assert the original primary rejection remains the outcome and the release attempt occurs once.
- Transaction credential redaction: use a unique username, password, IPv4/IPv6 host, port, database, query, and fragment sentinel in both `Error.message` and a manually assigned `Error.stack`; assert absence from `message`, `stack`, `String`, `util.inspect`, JSON/serialization where applicable, and captured logger/process output.
- Infra-up credential redaction: inject authentication, connection, and arbitrary errors containing the same sentinels; assert logged and thrown messages/stacks contain none of them and contain only an allowlisted readiness failure.
- Integration guard: with a fully valid admin config and sentinel, test missing, empty, invalid, padded, and non-string effective `NODE_ENV`; assert the pool/client factory and all create/terminate/drop query spies have zero calls. Test explicit exact `test` reaches the guarded path.
- API/worker ownership: statically and behaviorally prove `server.ts`/`runner.ts` have no `process.env`, config-loader, CA-reader, or `createDatabase` ownership; import them with poisoned globals and assert no environment/filesystem/database side effect. Prove each `main.ts` root loads, validates, reads CA when required, constructs once, and injects the database.
- Worker deadline: signal/abort during pending probe with pool close hanging until the shared deadline; assert one safe timeout log and exactly one termination call with `1`, never `0`. Repeat for close rejection, runtime settlement expiry, repeated signals, exact-zero remaining budget, and late completion. Retain a clean-before-deadline signal case expecting exactly one `0`.
- README privilege contract: assert documentation identifies the default local role as the Compose bootstrap superuser, does not claim it lacks create/drop privilege, and retains the production distinct-principal requirement.

### PostgreSQL integration regression tests

- Run the existing transaction integration suite against the exact pinned PostgreSQL image and add falsy rejection/rollback visibility cases for at least `undefined`, `false`, `0`, and `''`.
- Prove every falsy rejection leaves no inserted row and a subsequent query can acquire/use the released client.
- Run migration validation and the existing isolated-database suites with explicit `NODE_ENV=test`.
- Invoke the integration helper in a child process with `NODE_ENV` removed while all other destructive inputs are valid; assert nonzero exit, safe output, and no prefixed database created.

### Container-scan verification

Run both exact commands from the repository root against the committed image reference:

```text
trivy image --scanners vuln --timeout 10m --no-progress --format table --severity HIGH,CRITICAL --exit-code 0 --ignorefile .trivyignore.yaml --show-suppressed "$POSTGRES_IMAGE"
trivy image --scanners vuln --timeout 10m --no-progress --format table --severity CRITICAL --ignore-unfixed --exit-code 1 --ignorefile .trivyignore.yaml --show-suppressed "$POSTGRES_IMAGE"
```

Record that the suppressed-results section contains exactly `CVE-2025-68121` for the exact gosu path and that no other finding is suppressed. Then run the blocking command once with `--ignorefile` omitted and record that it fails specifically on the expected gosu finding; this negative-control command is evidence and must not replace or weaken the committed CI gate.

### Required verification commands

Run and report every command verbatim with exit status and concise result:

```text
node --version
corepack pnpm --version
docker version
docker compose version
trivy --version
corepack pnpm install --frozen-lockfile
corepack pnpm env:local
docker compose config --quiet
corepack pnpm verify:infrastructure-pins
corepack pnpm verify:trivy-exception
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

Also run and report:

```text
docker buildx imagetools inspect postgres:18.6-bookworm
docker buildx imagetools inspect postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc
```

Set `POSTGRES_IMAGE` to the exact committed reference and run the two exact Trivy commands in the preceding subsection, plus the deliberate no-ignore negative control. Report the top-level image media type/digest, PostgreSQL health, the one expected suppressed finding, and confirmation that the negative control failed for that finding.

### Clean-checkout verification

From a fresh clone of the implementation commit, not the developer's existing worktree:

1. Confirm `git status --short` is empty and no `.env`, `node_modules`, build output, Docker volume, cached project image, or prefixed test database exists.
2. Run the required verification commands in their listed order. `env:local` is the only permitted creation of `.env`; do not edit it manually or load `.env.example` at runtime.
3. After `infra:up`, verify Compose health and run migrations/integration tests against the exact pinned image.
4. Run both Trivy scans and the negative control exactly as specified.
5. Run `infra:down`, verify the normal development volume remains, and do not run destructive `infra:reset` unless separately recording its exact confirmed project-local target.
6. Inspect `git status --short`, `git diff --check`, tracked/untracked/ignored files, and the final `origin/main...HEAD` diff. Confirm no populated environment file, credential, dump, log, scan report, generated output, business schema, unrelated documentation, or out-of-scope artifact is tracked.
7. Provide CI links/results for quality, PostgreSQL integration/migration, dependency audit, Compose/pin validation, exception-policy validation, and the full container scan.

## Out of scope

- Changing PostgreSQL `18.6`, its Bookworm variant, or its committed manifest-list digest.
- Building or publishing a custom PostgreSQL image, rebuilding/forking gosu, or changing the image entrypoint.
- Suppressing any vulnerability other than the exact `CVE-2025-68121` gosu-path finding, or extending the exception beyond `2026-12-31`.
- Weakening Trivy to OS packages, skipping files/directories, adding a broad ignore, disabling CI gates, or hiding suppressed findings.
- Adding dependencies unless unavoidable and separately justified before implementation; no dependency is expected.
- Database schema, migration, role, grant, seed, credential, Compose-user, or port changes.
- Authentication, authorization, tenancy, products, AI, content, approval, scheduling, publishing, analytics, queues, repositories, or other feature work.
- API or frontend contract changes, readiness endpoints, UI work, or changes under `docs/`.
- Refactoring unrelated lifecycle, migration, configuration, or testing code.
- Committing, pushing, merging, changing pull-request metadata, or claiming final architecture approval as part of this specification.

## Implementation handoff requirements

Antigravity must not implement this remediation until the Product Owner explicitly approves this proposed task.

Before declaring implementation ready for review, report:

- every created, modified, and deleted file;
- the exact exception YAML and formal exception document;
- current upstream evidence and whether any removal trigger has occurred;
- output proving both full Trivy scans ran, exactly one finding was suppressed, and the no-ignore negative control failed as expected;
- the exact transaction failure-state approach and falsy rejection test matrix;
- credential non-disclosure evidence for infra-up and transaction error stacks/inspection/output;
- proof destructive helpers fail before connection/SQL when `NODE_ENV` is absent;
- proof API/worker environment, config, CA, and database construction live only in executable composition roots;
- worker shared-deadline and exactly-once exit evidence for success, failure, and expiry;
- corrected README wording and confirmation that no database roles/grants were added;
- every required verification command with actual exit status/result;
- clean-checkout and CI evidence; and
- final `git status --short` and `origin/main...HEAD` diff/stat with any deviation called out.

Codex will review the approved requirement, this remediation specification, the actual implementation and diff, regression tests, full scan evidence, and clean-checkout results before returning `STATUS: APPROVED` or `STATUS: CHANGES REQUIRED`.
