# TASK-006 Remediation 02: Deterministic Trivy Bootstrap in CI

## Status

Approved by Product Owner.

## Objective

Restore the blocking `Container Security Scan` check for PR #6 by replacing only the failing Trivy bootstrap path with a deterministic, checksum-pinned download of the official Trivy v0.76.1 Linux x86-64 release asset.

This remediation must not change TASK-006 production code, weaken or suppress scanning, skip any security gate, make the security job non-blocking, change the PostgreSQL image or exception policy, or merge PR #6.

## Context and diagnosis

PR #6 is `agy/task-006-managed-oidc-session` at reviewed head `91030043af02107801bf8d0eb0eaea9f7fc67c6b`. On CI run `41774131623`, `Quality Checks` and `PostgreSQL Integration` passed. `Container Security Scan` failed in each of five attempts before any scan command ran.

The exact failing chain is:

1. `.github/workflows/ci.yml` invokes `aquasecurity/setup-trivy@81e514348e19b6112ce2a7e3ecbafe19c1e1f567` (`v0.3.1`) with `version: v0.76.1` and caching disabled.
2. That pinned composite action uses full-SHA-pinned `actions/checkout` to fetch `aquasecurity/trivy` installer commit `75c4dc0f45c5d7ffd05ae26df1e0c666787bdf2a` and runs `contrib/install.sh`.
3. The official installer resolves the requested tag through GitHub successfully. Every failed log reaches `found version: 0.76.1 for v0.76.1/Linux/64bit`.
4. At that installer commit, the checksum URL uses the GitHub release, but the archive URL is hard-coded as `https://get.trivy.dev/trivy?...`.
5. `get.trivy.dev` does not resolve. Curl exits with code `6`, so the action stops before its checksum verification, version verification, policy verification, or either image scan.
6. The official GitHub release URL for `trivy_0.76.1_Linux-64bit.tar.gz` is reachable. The corresponding official `trivy_0.76.1_checksums.txt` entry is:

   ```text
   c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0  trivy_0.76.1_Linux-64bit.tar.gz
   ```

This is a bootstrap transport/DNS failure, not a TASK-006 application failure and not a vulnerability-scan finding. Retrying the same action is not a deterministic remediation because every retry uses the same non-resolving archive host.

Primary evidence inspected:

- pinned workflow `.github/workflows/ci.yml` at PR head;
- exact logs for run `41774131623`, attempts 1 through 5;
- pinned `setup-trivy` action definition at commit `81e514348e19b6112ce2a7e3ecbafe19c1e1f567`;
- official Trivy installer at commit `75c4dc0f45c5d7ffd05ae26df1e0c666787bdf2a`;
- official Trivy v0.76.1 GitHub release assets and checksum manifest; and
- the inherited TASK-003 through TASK-006 Trivy scan and negative-control requirements.

## Required implementation

### 1. Replace only the failing setup action

In the existing `security_scan` job, replace the `Set up Trivy` step that invokes `aquasecurity/setup-trivy` with one inline Bash step named `Install checksum-pinned Trivy`.

Do not retain or invoke `get.trivy.dev`, do not download or execute an installer script, and do not introduce another third-party setup action.

The new step must:

1. run under the existing GitHub-hosted Ubuntu job with Bash strict mode (`set -euo pipefail`);
2. define the version exactly once as `0.76.1` (or `v0.76.1` with an unambiguous derivation for the filename) and define the expected archive SHA-256 exactly once as `c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`;
3. fail closed unless `uname -s` is `Linux` and `uname -m` is `x86_64`, because the pinned asset and checksum are specifically for `Linux-64bit`;
4. construct the exact archive name `trivy_0.76.1_Linux-64bit.tar.gz` and download it only from the versioned official URL `https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz`;
5. use curl failure handling, visible errors, redirect following, HTTPS-only initial and redirect protocols, TLS 1.2 or newer, and a small bounded retry count for transient transport failures;
6. download into a unique directory under `$RUNNER_TEMP`, never into the checked-out repository;
7. verify the downloaded archive before extraction with `sha256sum --check --strict` against the hard-coded expected SHA-256;
8. extract only the `trivy` member after successful verification, install it with executable mode into a dedicated directory under `$RUNNER_TEMP`, and append that directory to `$GITHUB_PATH`;
9. clean its unique temporary staging directory with a scoped trap; and
10. fail immediately on a download, protocol, platform, checksum, extraction, installation, or path-publication error.

The committed SHA-256 is the immutable content pin. It must not be replaced by trust in a checksum file downloaded from the same release at runtime. The implementation handoff must record that the literal was independently compared with Aqua Security's official v0.76.1 checksum manifest.

Do not add a cache in this remediation. A cache would add key and cache-integrity behavior unrelated to the narrow failure and could conceal whether the deterministic download path works.

### 2. Retain exact version verification

Keep the separate `Verify Trivy version` step after installation. Tighten its assertion, if needed, so it accepts exactly Trivy `0.76.1` and cannot accept a prefix/suffix version such as `0.76.10`.

The expected first line is `Version: 0.76.1`. Log that non-secret line and fail on any other value.

### 3. Preserve the security policy and both committed scans

The `Verify security exception policy` step must remain blocking and execute immediately before the scan step.

Retain both existing Trivy image commands and their current semantics:

```text
trivy image --scanners vuln --timeout 10m --no-progress --format table --severity HIGH,CRITICAL --exit-code 0 --ignorefile .trivyignore.yaml --show-suppressed "$POSTGRES_IMAGE"
trivy image --scanners vuln --timeout 10m --no-progress --format table --severity CRITICAL --ignore-unfixed --exit-code 1 --ignorefile .trivyignore.yaml --show-suppressed "$POSTGRES_IMAGE"
```

Do not change:

- the exact PostgreSQL image and digest;
- the scan step's `timeout-minutes: 15`;
- scanner selection, severity, fixed/unfixed policy, output format, progress behavior, command timeouts, or exit codes;
- `.trivyignore.yaml`, its expiry, path, CVE, or exception document;
- `--ignorefile .trivyignore.yaml` or `--show-suppressed` on either command; or
- the job/check name, workflow triggers, least-privilege permissions, or blocking behavior.

Do not add `continue-on-error`, conditional success, exit masking, `|| true`, skip flags, narrower package types, VEX/Rego suppression, or any other bypass.

### 4. Retain the no-ignore negative control as required evidence

The inherited no-ignore negative control remains mandatory for implementation and review evidence. Run the blocking CRITICAL command against the exact committed PostgreSQL image with only `--ignorefile .trivyignore.yaml` omitted.

The control must exit `1`, and its output must show that the failure is specifically the approved `CVE-2025-68121` finding at `usr/local/bin/gosu`, with no unexpected additional finding. Capture and assert the expected nonzero exit deliberately in the verification harness; do not use `continue-on-error`, `|| true`, or reinterpret an arbitrary failure as success.

This evidence command must not replace either committed CI scan and must not be added in a way that makes the blocking workflow tolerate a failed real scan.

### 5. Preserve repository write boundaries

Implementation source changes are limited to `.github/workflows/ci.yml`. Runtime downloads, extraction, and installation must occur only below `$RUNNER_TEMP`.

Do not modify TASK-006 production, application, database, migration, API, frontend, backend, package, lockfile, Compose, image-pin, security-exception, or documentation files. Do not commit downloaded archives, binaries, checksums, logs, caches, generated output, or the supplied diagnostic log `trivy-setup-failure.txt`.

If implementation demonstrates that a separate narrowly scoped installer script is unavoidable, stop and request Codex approval before creating it. The approved default is the single workflow-file change.

## Expected files

Implementation file:

- `.github/workflows/ci.yml` — replace only Trivy bootstrap and make version matching exact.

Specification file created by Codex before approval:

- `tasks/TASK-006-REMEDIATION-02.md`

No other file is expected to change.

## Database changes

None. No schema, migration, query, role, credential, PostgreSQL configuration, image tag, or image digest change.

## API changes

None. No HTTP, OpenAPI, authentication, authorization, cookie, OIDC, or error-contract change.

## Frontend changes

None.

## Backend changes

None. TASK-006 production and test behavior remains unchanged.

## Security requirements

- Trivy remains pinned to v0.76.1.
- The exact Linux x86-64 archive remains content-pinned by the hard-coded official SHA-256.
- All GitHub Actions still used by the workflow remain pinned to full commit SHAs; no mutable action tag may be introduced.
- The archive must come from Aqua Security's versioned GitHub release path over HTTPS and must verify before extraction or execution.
- Redirects must remain HTTPS-only.
- A checksum mismatch must fail the job without installing or executing the downloaded content.
- The implementation must not execute a remotely downloaded shell script.
- Repository permissions remain `contents: read` and no new token or permission is added.
- Both real scans and the policy validator remain blocking.
- The approved exception remains exact, visible, time-bounded, and unchanged.
- No secrets or credentials may be added or logged.

## Edge cases

- `get.trivy.dev` remains NXDOMAIN or intermittently unavailable: the new path never queries it.
- GitHub returns a redirect: curl follows it only when the redirect target uses HTTPS.
- GitHub returns 4xx/5xx, an empty/truncated archive, or exhausts bounded retries: installation fails.
- A release asset is replaced under the same tag: the hard-coded SHA-256 rejects it.
- A checksum literal, version, filename, or URL is changed independently: verification/version checks fail or review rejects the inconsistent pin set.
- The runner architecture changes to ARM64 or the OS changes: the setup step fails closed instead of installing the wrong artifact.
- The tar archive is unavailable or lacks the exact `trivy` member: extraction/install fails.
- An older/different `trivy` exists on the runner: the dedicated install directory is placed on `$GITHUB_PATH`, and exact version verification must prove the invoked binary is 0.76.1.
- The approved exception expires or its policy changes: the existing policy validator continues to fail before scanning.
- The no-ignore control exits for transport/database errors rather than the expected finding: it is a failed control, not a pass.

## Acceptance criteria

1. The implementation diff outside this specification contains only `.github/workflows/ci.yml`.
2. `aquasecurity/setup-trivy` and `get.trivy.dev` are absent from the implemented workflow.
3. The workflow downloads only `trivy_0.76.1_Linux-64bit.tar.gz` from the exact Aqua Security GitHub release URL.
4. The literal SHA-256 is exactly `c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`, and archive verification succeeds before extraction/installation.
5. Platform checks fail closed for anything other than Linux x86-64.
6. `trivy --version` is asserted as exactly `Version: 0.76.1`.
7. Runtime artifacts are confined to `$RUNNER_TEMP`; the checkout remains unchanged and no binary/archive is committed.
8. `corepack pnpm verify:trivy-exception` passes without any relaxation to its rules.
9. The HIGH/CRITICAL review scan runs, exits `0`, and visibly reports exactly the approved suppressed gosu finding.
10. The blocking CRITICAL fixed-vulnerability scan runs with `--ignore-unfixed`, remains blocking, and exits `0` only when no non-excepted fixable critical finding exists.
11. The no-ignore negative control exits exactly `1` for `CVE-2025-68121` at `usr/local/bin/gosu` and for no unexpected finding.
12. No scan flag, exception, timeout, image reference, workflow trigger, permission, or blocking behavior is weakened.
13. `Quality Checks`, `PostgreSQL Integration`, and `Container Security Scan` all pass on the same final implementation SHA in PR #6.
14. No TASK-006 production code or contract changes, and PR #6 is not merged by the implementer.
15. The final branch, remote branch, PR head, test evidence, and reviewed SHA agree exactly, and the implementation worktree is clean apart from this approved specification if it has not yet been committed by the Product Owner's chosen workflow.

## Test plan

### Static workflow inspection

- Inspect the final workflow diff and confirm only the setup/version bootstrap changed.
- Confirm every remaining `uses:` reference is a full 40-character commit SHA.
- Confirm no mutable action tag, `get.trivy.dev`, installer-script execution, cache, new permission, `continue-on-error`, `|| true`, skip, or suppression was introduced.
- Confirm the version, release URL, archive filename, checksum, platform, install directory, and `$GITHUB_PATH` publication are internally consistent.
- Confirm both committed scan command lines are unchanged.

### Bootstrap verification

On Linux x86-64, run the exact inline installation logic in a disposable temporary directory and record:

- resolved URL and archive filename;
- successful HTTPS download;
- expected and actual SHA-256 equality;
- extraction of only `trivy`;
- installed file mode/path; and
- exact `Version: 0.76.1` output.

Also demonstrate fail-closed behavior by running a disposable copy of the checksum verification with one changed checksum nibble and proving that extraction/installation does not occur.

### Existing policy and scan verification

Run and report actual exit codes for:

```text
corepack pnpm verify:trivy-exception
```

Set `POSTGRES_IMAGE` to `postgres:18.6-bookworm@sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc`, then run the two exact committed scans listed above.

Run the no-ignore negative control separately, capture its exit without masking it, assert exit `1`, and inspect its output for exactly the expected CVE/path. Report any additional finding or different failure as a failed verification.

### Regression and CI verification

Run and report:

```text
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm openapi:check
corepack pnpm build
corepack pnpm check
corepack pnpm audit --prod --audit-level high
git diff --check origin/main...HEAD
git status --short --branch
```

Push only after Product Owner approval and implementation completion. Verify the three required GitHub checks on the same exact PR-head SHA. Do not rerun or merge merely to conceal an unresolved scan/setup failure.

## Out of scope

- Any TASK-006 production, application, test, database, migration, API, frontend, backend, package, lockfile, OpenAPI, Compose, or architecture change.
- Changing Trivy version, PostgreSQL tag/digest, `.trivyignore.yaml`, exception documentation, exception expiry, scan flags, severity, scanner set, timeouts, or exit policy.
- Making any security step optional, advisory, skipped, suppressed, conditionally successful, or non-blocking.
- Adding a package/dependency, container image, custom action, fork, mirror, proxy, cache, artifact upload, or secret.
- Updating `setup-trivy`, patching the downloaded installer, editing DNS/hosts, or relying on `get.trivy.dev` retries.
- Broad CI refactoring, runner-image migration, unrelated action upgrades, or formatting churn.
- Committing `trivy-setup-failure.txt` or any downloaded/generated artifact.
- Merging PR #6 or declaring TASK-006 approved as part of implementation.

## Implementation handoff evidence

Before requesting Codex review, Antigravity must provide:

- Product Owner approval reference;
- baseline SHA, final local SHA, remote branch SHA, and PR #6 head SHA;
- exact `origin/main...HEAD` file list and diff/stat;
- the final Trivy installation step and exact version assertion;
- the official checksum-manifest line and computed archive SHA-256;
- proof a deliberately wrong checksum fails before extraction/installation;
- proof runtime files were confined to `$RUNNER_TEMP` and the repository remained clean;
- actual exit codes and concise outputs for the policy validator, both required scans, and no-ignore negative control;
- proof the negative control failed only for the approved CVE/path;
- actual outcomes for every regression command and all three exact-SHA GitHub checks;
- confirmation that no production, exception, image, scan-policy, permission, or dependency file changed;
- every warning, retry, skip, limitation, deviation, or environment issue; and
- confirmation that PR #6 was not merged.

Codex will review the approved requirement, this specification, actual workflow diff, exact CI logs, checksum provenance, fail-closed reproduction, all scan outputs, and exact-SHA check results. Implementation is not complete until Codex explicitly returns `STATUS: APPROVED`.
