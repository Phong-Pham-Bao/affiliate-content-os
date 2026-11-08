-- Migration 0012: Add bounded failure_code to artifact_change_requests
ALTER TABLE artifact_change_requests
  ADD COLUMN failure_code TEXT NULL;

ALTER TABLE artifact_change_requests
  ADD CONSTRAINT artifact_change_requests_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'stale_base_conflict',
      'provider_failure',
      'context_drift',
      'budget_exhausted',
      'timeout',
      'validation_failed'
    )
  );
