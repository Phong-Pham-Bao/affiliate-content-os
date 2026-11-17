'use client';

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import type { EmployeeVM } from '../../lib/workforce-view-model-types.js';
import { useEscapeKey } from '../../lib/use-escape-key.js';

interface EmployeeInspectorProps {
  readonly isOpen: boolean;
  readonly employee: EmployeeVM | null;
  readonly canManage?: boolean;
  readonly onClose: () => void;
  readonly onSelectArtifact: (artifactId: string) => void;
}

export function EmployeeInspector({
  isOpen,
  employee,
  canManage = true,
  onClose,
  onSelectArtifact,
}: EmployeeInspectorProps): ReactElement | null {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);
  const invokingRoleKeyRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  const safeRestoreFocus = useCallback(() => {
    const invoking = invokingElementRef.current;
    if (invoking && document.contains(invoking)) {
      invoking.focus();
      invokingElementRef.current = null;
      return;
    }
    const roleKey = invokingRoleKeyRef.current;
    if (roleKey) {
      const fallback =
        document.getElementById(`station-${roleKey}`) ??
        document.getElementById(`board-${roleKey}`);
      if (fallback && document.contains(fallback)) {
        fallback.focus();
        invokingElementRef.current = null;
        return;
      }
    }
    const viewToggle = document.querySelector('.view-mode-toggle button') as HTMLElement | null;
    if (viewToggle && document.contains(viewToggle)) {
      viewToggle.focus();
    }
    invokingElementRef.current = null;
  }, []);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      invokingElementRef.current = document.activeElement as HTMLElement | null;
      invokingRoleKeyRef.current = employee?.roleKey ?? null;
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      safeRestoreFocus();
    }
    return undefined;
  }, [isOpen, safeRestoreFocus, employee?.roleKey]);

  useEscapeKey(onClose, false, isOpen);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  if (!isOpen || !employee) return null;

  return (
    <div
      className="inspector-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspector-heading"
        className="employee-inspector-panel"
        onKeyDown={handleKeyDown}
      >
        <div className="inspector-header d-flex justify-content-between align-items-center pb-2 border-bottom">
          <div>
            <h3 id="inspector-heading" className="inspector-title m-0 text-lg">
              {employee.displayName}
            </h3>
            <span className="text-muted text-xs">{employee.department}</span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label={`Close ${employee.displayName} inspector`}
          >
            &times;
          </button>
        </div>

        <div className="inspector-body my-3">
          {!canManage && (
            <div className="alert alert-secondary p-2 mb-2 text-2xs" role="note">
              Read-only view: You do not have manager privileges to retry or approve.
            </div>
          )}

          <section className="inspector-section mb-3" aria-labelledby="section-mandate">
            <h4 id="section-mandate" className="section-title text-xs text-uppercase text-muted">
              Role Mandate
            </h4>
            <p className="text-sm">{employee.mandate}</p>
          </section>

          <section className="inspector-section mb-3" aria-labelledby="section-state">
            <h4 id="section-state" className="section-title text-xs text-uppercase text-muted">
              Persisted Execution State
            </h4>
            <div className="state-grid text-xs">
              <div>
                <strong>Office State:</strong>{' '}
                <span className={`badge badge-${employee.badgeVariant}`}>
                  {employee.statusLabel}
                </span>
              </div>
              {employee.workItem && (
                <div>
                  <strong>Work Item Status:</strong> <code>{employee.workItem.status}</code>
                </div>
              )}
              {employee.latestReportCode && (
                <div>
                  <strong>Latest Report Code:</strong> <code>{employee.latestReportCode}</code>
                </div>
              )}
              {employee.timestamps.startedAt && (
                <div>
                  <strong>Started:</strong>{' '}
                  {new Date(employee.timestamps.startedAt).toLocaleString()}
                </div>
              )}
              {employee.timestamps.completedAt && (
                <div>
                  <strong>Completed:</strong>{' '}
                  {new Date(employee.timestamps.completedAt).toLocaleString()}
                </div>
              )}
              {employee.operationalDetails.actionableMessage && (
                <div className="text-danger mt-1">
                  <strong>Alert:</strong> {employee.operationalDetails.actionableMessage}
                </div>
              )}
            </div>
          </section>

          {employee.namedDependencies.length > 0 && (
            <section className="inspector-section mb-3" aria-labelledby="section-dependencies">
              <h4
                id="section-dependencies"
                className="section-title text-xs text-uppercase text-muted"
              >
                Prerequisite Dependencies
              </h4>
              <ul className="list-unstyled text-xs m-0">
                {employee.namedDependencies.map((dep) => (
                  <li key={dep.workItemId || dep.roleName} className="mb-1">
                    • <strong>{dep.roleName}:</strong>{' '}
                    <span className="badge badge-secondary">{dep.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="inspector-section mb-3" aria-labelledby="section-deliverables">
            <h4
              id="section-deliverables"
              className="section-title text-xs text-uppercase text-muted"
            >
              Role Deliverables ({employee.deliverables.length})
            </h4>
            {employee.deliverables.length === 0 ? (
              <p className="text-xs text-muted">No artifacts produced by this role yet.</p>
            ) : (
              <div className="deliverables-list d-flex flex-column gap-2">
                {employee.deliverables.map((art) => (
                  <div key={art.id} className="deliverable-item p-2 border rounded bg-light">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <strong className="text-xs">{art.artifactType}</strong>
                      <span className="badge badge-info text-2xs">
                        Rev #{art.currentRevisionNumber}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between align-items-center text-2xs text-muted">
                      <span>Status: {art.lifecycleStatus}</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-xs"
                        onClick={() => {
                          onClose();
                          onSelectArtifact(art.id);
                        }}
                      >
                        Open Deliverable &rarr;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {employee.relevantActivities.length > 0 && (
            <section className="inspector-section mb-3" aria-labelledby="section-activities">
              <h4
                id="section-activities"
                className="section-title text-xs text-uppercase text-muted"
              >
                Activity Trail ({employee.relevantActivities.length})
              </h4>
              <div className="activity-list text-xs">
                {employee.relevantActivities.slice(0, 5).map((act) => (
                  <div
                    key={act.id}
                    className="activity-row py-1 border-bottom d-flex justify-content-between"
                  >
                    <span>{act.action}</span>
                    <span className="text-muted">
                      {new Date(act.occurredAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="inspector-footer pt-2 border-top text-right">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close Inspector
          </button>
        </div>
      </aside>
    </div>
  );
}
