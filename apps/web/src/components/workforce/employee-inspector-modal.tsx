'use client';

import type { ReactElement } from 'react';
import type {
  AgentRoleKey,
  ContentArtifactSummaryDTO,
  WorkOrderDetailDTO,
} from '../../types/workforce.js';
import { useEscapeKey } from '../../lib/use-escape-key.js';

interface EmployeeInspectorModalProps {
  readonly isOpen: boolean;
  readonly roleKey: AgentRoleKey | null;
  readonly detail: WorkOrderDetailDTO | null;
  readonly artifacts: readonly ContentArtifactSummaryDTO[];
  readonly onClose: () => void;
  readonly onSelectArtifact: (artifactId: string) => void;
}

const ROLE_METADATA: Record<AgentRoleKey, { title: string; responsibilities: string }> = {
  chief_of_staff: {
    title: 'Chief of Staff',
    responsibilities:
      'Deterministic director responsible for context package validation, policy checks, job dispatch, and artifact delivery.',
  },
  product_strategist: {
    title: 'Product Strategist',
    responsibilities:
      'Analyzes product facts and market evidence to formulate core positioning, verified benefit statements, objection countermeasures, and compliance boundaries.',
  },
  audience_strategist: {
    title: 'Audience Strategist',
    responsibilities:
      'Profiles target demographics, core desires, burning pain points, and attention-grabbing hooks rooted in evidence.',
  },
  creative_director: {
    title: 'Creative Director',
    responsibilities:
      'Synthesizes product and audience insights into a coherent 5-video series plan with visual direction, narrative roles, and high-converting CTAs.',
  },
  scriptwriter: {
    title: 'Scriptwriter',
    responsibilities:
      'Drafts spoken video scripts, visual cues, and caption variants. Blocked until all three planning roles complete.',
  },
  compliance_reviewer: {
    title: 'Compliance Reviewer',
    responsibilities:
      'Audits drafted materials against prohibited claim lists, affiliate disclosure laws, and merchant terms before publishing.',
  },
};

export function EmployeeInspectorModal({
  isOpen,
  roleKey,
  detail,
  artifacts,
  onClose,
  onSelectArtifact,
}: EmployeeInspectorModalProps): ReactElement | null {
  useEscapeKey(onClose, false, isOpen);

  if (!isOpen || !roleKey || !detail) return null;

  const roleMeta = ROLE_METADATA[roleKey];
  const assignment = detail.assignments.find((a) => a.roleKey === roleKey);
  const workItem = detail.workItems.find((w) => w.roleKey === roleKey);
  const linkedArtifact = artifacts.find((art) => art.authorRoleKey === roleKey);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspector-title"
        className="modal-content workforce-inspector-modal"
      >
        <div className="modal-header">
          <h3 id="inspector-title" className="modal-title">
            Employee Inspector: {roleMeta.title}
          </h3>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label="Close inspector"
          >
            &times;
          </button>
        </div>

        <div className="inspector-body my-3">
          <div className="inspector-section mb-3">
            <h5 className="section-subtitle">Role Mandate</h5>
            <p className="text-muted text-sm">{roleMeta.responsibilities}</p>
          </div>

          <div className="inspector-section mb-3">
            <h5 className="section-subtitle">Execution State</h5>
            <div className="inspector-fields text-sm">
              <div>
                <strong>Office State:</strong>{' '}
                <span className="badge badge-secondary">{assignment?.officeState ?? 'idle'}</span>
              </div>
              <div>
                <strong>Work Item Status:</strong>{' '}
                <span className="badge badge-secondary">{workItem?.status ?? 'none'}</span>
              </div>
              {assignment?.latestReportCode && (
                <div>
                  <strong>Latest Report:</strong> {assignment.latestReportCode}
                </div>
              )}
              {workItem?.startedAt && (
                <div>
                  <strong>Started:</strong> {new Date(workItem.startedAt).toLocaleString()}
                </div>
              )}
              {workItem?.completedAt && (
                <div>
                  <strong>Completed:</strong> {new Date(workItem.completedAt).toLocaleString()}
                </div>
              )}
              {workItem?.blockedReasonCode && (
                <div className="text-danger">
                  <strong>Block Reason:</strong> {workItem.blockedReasonCode}
                </div>
              )}
            </div>
          </div>

          <div className="inspector-section mb-3">
            <h5 className="section-subtitle">Deliverable Artifact</h5>
            {linkedArtifact ? (
              <div className="artifact-summary-box p-3 bg-light rounded">
                <p className="text-sm mb-2">
                  <strong>Type:</strong> {linkedArtifact.artifactType} (Revision #
                  {linkedArtifact.currentRevisionNumber})
                </p>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    onClose();
                    onSelectArtifact(linkedArtifact.id);
                  }}
                >
                  View Completed Artifact &rarr;
                </button>
              </div>
            ) : (
              <p className="text-muted text-sm">No artifact produced yet for this role.</p>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
