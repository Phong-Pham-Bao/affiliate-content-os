# Sprint 3 AI Creative Workforce Threat Review

This document presents a structured security threat review for the Sprint 3 AI Creative Workforce release, assessing risk vectors, security architecture boundaries, and verified mitigations.

---

## 1. Scope & System Boundary

The Sprint 3 boundary covers:
- Workforce Command Center UI (Virtual Office, Board view, Employee Inspector, Deliverables & Activity surfaces).
- Orchestration engine, durable job queue, and Gemini LLM provider integration.
- Human boss approval gate and immutable revision history.

**Explicit Sprint 4 Boundary**:
Sprint 3 explicitly produces a verified, human-approved creative content package. It **never** schedules posts, publishes to social networks (TikTok, YouTube, Meta, X), manages social OAuth credentials, or interacts with social media APIs. Those capabilities are strictly quarantined to Sprint 4.

---

## 2. Threat Analysis & Mitigations

### 2.1 Cross-Tenant Data Exposure
- **Threat**: A user belonging to Tenant A observes or alters work orders, employee assignments, artifacts, or activities belonging to Tenant B.
- **Mitigation**:
  - All database queries enforce strict tenant scoping via `workspace_id`.
  - API routes validate that the authenticated session possesses active membership in the target workspace.
  - Client state transition coordinators discard out-of-band responses when workspace or product selection changes, preventing cross-tenant leakage.

### 2.2 Prompt, Secret & Internal Stack Leakage
- **Threat**: Raw Gemini system prompts, API keys, or backend stack traces are inadvertently leaked to client responses or browser logs.
- **Mitigation**:
  - All API keys (`GEMINI_API_KEY`) reside exclusively in server-side process environments and are never passed to the client or embedded in artifacts.
  - LLM prompts are synthesized inside the worker runtime; only structured, validated artifact JSON/markdown is returned to API consumers.
  - Error responses are mapped to standard error codes (`PROVIDER_RATE_LIMIT`, `BUDGET_EXHAUSTED`, `INTERNAL_ERROR`), stripping stack traces and raw provider bodies.

### 2.3 Unsafe Activity & Artifact Rendering (XSS Protection)
- **Threat**: Untrusted AI-generated script text, directives, or activity logs inject malicious scripts into the DOM when viewed by an operator.
- **Mitigation**:
  - All text content rendered in the Office view, Board view, Inspector panel, and Deliverables section uses React text interpolation (`<div>{content}</div>`).
  - No `dangerouslySetInnerHTML` is used for artifact content or activity trails.
  - Content Security Policy (CSP) headers block inline scripts and unauthorized resource origins.

### 2.4 Stale UI & Async Race Conditions
- **Threat**: Rapid UI switches or delayed polling responses overwrite current state with stale data, or cause double submissions.
- **Mitigation**:
  - `pollWorkOrderUntilTerminal` utilizes `AbortController` and sequence tracking to ignore cancelled or superseded fetch cycles.
  - Polling gracefully degrades to a visible stale state (`isStale: true`) on network drop or timeout rather than fabricating false progress.
  - Mutation endpoints enforce optimistic concurrency via revision numbers and idempotency keys.

### 2.5 Mutation Authorization vs. Client Presentation
- **Threat**: A read-only viewer attempts to trigger assignments, retries, or approvals by manipulating the DOM.
- **Mitigation**:
  - While the web client hides action buttons and displays a read-only badge when `!canManage`, this is purely a presentation convenience.
  - The API server enforces strict role-based access control (RBAC): only users with `owner` or `editor` roles in the workspace can invoke mutation endpoints (`POST /work-orders`, `POST /decisions`, `POST /retry`). Read-only `viewer` requests receive `403 Forbidden`.

### 2.6 Denial-of-Wallet & Provider Rate Limit Exploitation
- **Threat**: Runaway prompt loops or malicious task creation exhaust workspace AI budget or trigger API provider suspensions.
- **Mitigation**:
  - Workspace AI policies enforce hard monthly budget caps (`monthlyBudgetMicrounits`) and per-minute rate limits.
  - Budget is reserved prior to job execution; if remaining budget is insufficient, the job is refused before invoking the Gemini API.
  - Circuit breakers and exponential backoff prevent hammer loops against the upstream provider.

### 2.7 Approval Spoofing & Autonomous Publishing Prevention
- **Threat**: An AI agent (e.g. Chief of Staff or Compliance Reviewer) approves content on behalf of the human boss or bypasses the approval gate.
- **Mitigation**:
  - AI compliance checks are strictly advisory (`advisoryReview`). Compliance reviewers have zero capability to approve a work order.
  - Only an authenticated human user session can record an `accepted` decision.
  - Revisions are hashed and immutable; once approved, a revision cannot be mutated.

### 2.8 Office Animation carries Zero Operational Authority
- **Threat**: Visual animation states or client-side timers dictate workflow progression.
- **Mitigation**:
  - Office stations and movement classes (`pos-desk`, `pos-dependency`, `pos-review`, etc.) are 100% pure projections of durable backend database states.
  - The client runs zero timers or random progress simulators.
  - Visual animations carry no operational authority and cannot advance, approve, or complete any work order.
