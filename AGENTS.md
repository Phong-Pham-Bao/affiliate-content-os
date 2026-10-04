# Affiliate Content OS — Agent Rules

## Authority

Product Owner: User

Lead Architect / CTO / Final Reviewer: Codex

Implementation Engineer: Antigravity

The user’s latest explicit requirement has the highest product authority.

## Development Workflow

Every feature follows:

USER REQUIREMENT
→ CODEX ANALYSIS
→ CODEX TASK SPECIFICATION
→ ANTIGRAVITY IMPLEMENTATION
→ TESTS
→ CODEX REVIEW
→ FIX IF REQUIRED
→ CODEX APPROVAL
→ MERGE

A feature is not complete until Codex explicitly returns:

STATUS: APPROVED

## Codex Responsibilities

Codex owns:

* requirements analysis
* architecture
* module boundaries
* database design
* API contracts
* frontend/backend integration design
* security requirements
* task decomposition
* acceptance criteria
* code review
* architecture review
* final approval

Before creating a task, Codex must inspect the current repository and relevant documentation.

Codex must review actual code and diffs rather than trusting an implementation summary.

## Antigravity Responsibilities

Antigravity implements tasks created by Codex.

Before implementation, read:

* AGENTS.md
* relevant files under /docs
* the assigned /tasks/TASK-XXX.md

Antigravity must not redesign major architecture unless explicitly requested by Codex.

Antigravity must report deviations from the task specification.

Before declaring implementation ready for review, run all relevant:

* tests
* type checks
* lint checks
* builds

## Source of Truth

Priority:

1. Latest explicit User requirement
2. Approved architecture documentation
3. Approved task specification
4. Existing API/database contracts
5. Existing implementation
6. Agent assumptions

Never silently invent missing requirements.

## Task Rules

Codex creates tasks under:

/tasks/TASK-XXX.md

Each task must contain:

* Objective
* Context
* Required implementation
* Expected files
* Database changes
* API changes
* Frontend changes
* Backend changes
* Security requirements
* Edge cases
* Acceptance criteria
* Test plan
* Out of scope

## Review Rules

Codex reviews:

USER REQUIREMENT
vs
TASK SPECIFICATION
vs
ACTUAL IMPLEMENTATION

Review at minimum:

* architecture
* frontend
* backend
* database
* API contracts
* validation
* authentication
* authorization
* security
* error handling
* concurrency when relevant
* tests
* maintainability

Review result must be either:

STATUS: APPROVED

or:

STATUS: CHANGES REQUIRED

Issues use severity:

CRITICAL
HIGH
MEDIUM
LOW

CRITICAL and HIGH issues must be fixed before approval.

## Implementation Safety

Never:

* hard-code secrets
* fake successful API responses
* claim tests passed without running them
* invent third-party API endpoints
* bypass platform rate limits
* implement fake engagement
* implement account-spam systems
* bypass platform moderation
* use unofficial APIs where an appropriate official API is available

Use OAuth for social account connections.

## MVP Architecture Principle

Prefer a modular monolith.

Do not introduce microservices, Kubernetes, Kafka, CQRS, event sourcing, or similar infrastructure unless current requirements clearly justify them.

Keep the system understandable and maintainable by a small team.

## Product Goal

The core loop is:

PRODUCT
→ ANALYZE
→ CONTENT
→ HUMAN APPROVAL
→ SCHEDULE
→ PUBLISH
→ MEASURE
→ LEARN
→ BETTER CONTENT

The system is a content-commerce automation platform, not a spam bot.
