# Phase 04: Live Google Login Diagnostic & Remediation

## Overview

Perform a fresh live Google login, inspect the diagnostic category in terminal output, identify the grant/claim incompatibility, remediate it, and verify with full quality gates.

## Key Steps

1. Start the API or trigger the OIDC flow to obtain Google authorization URL.
2. Complete authorization flow to observe the safe terminal diagnostic.
3. Diagnose the root cause of the failure from the allowlisted diagnostic category and parameters.
4. Implement the remediation for the identified incompatibility.
5. Run full quality gate (`pnpm check`).
