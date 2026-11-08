'use client';

import type { ReactElement } from 'react';
import type {
  AgentAssignmentSummaryDTO,
  AgentRoleKey,
  WorkItemSummaryDTO,
  WorkOrderDetailDTO,
} from '../../types/workforce.js';

interface WorkOrderTimelineProps {
  readonly detail: WorkOrderDetailDTO;
  readonly onInspectEmployee: (roleKey: AgentRoleKey) => void;
}

const ROLE_DISPLAY_NAMES: Record<AgentRoleKey, { title: string; desc: string }> = {
  chief_of_staff: {
    title: 'Chief of Staff',
    desc: 'Deterministic orchestration & context assembly',
  },
  product_strategist: {
    title: 'Product Strategist',
    desc: 'Value props, benefits, objections & campaign angles',
  },
  audience_strategist: {
    title: 'Audience Strategist',
    desc: 'Audience segments, desires, pain points & hooks',
  },
  creative_director: {
    title: 'Creative Director',
    desc: '5-video series concept, hooks & visual direction',
  },
  scriptwriter: {
    title: 'Scriptwriter',
    desc: 'High-converting scripts (unlocked after planning)',
  },
  compliance_reviewer: {
    title: 'Compliance Reviewer',
    desc: 'Claim verification & regulatory sign-off',
  },
};

const ORDERED_ROLES: readonly AgentRoleKey[] = [
  'chief_of_staff',
  'product_strategist',
  'audience_strategist',
  'creative_director',
  'scriptwriter',
  'compliance_reviewer',
];

export function WorkOrderTimeline({
  detail,
  onInspectEmployee,
}: WorkOrderTimelineProps): ReactElement {
  const { workItems, assignments } = detail;

  const getAssignment = (roleKey: AgentRoleKey): AgentAssignmentSummaryDTO | undefined =>
    assignments.find((a) => a.roleKey === roleKey);

  const getWorkItem = (roleKey: AgentRoleKey): WorkItemSummaryDTO | undefined =>
    workItems.find((w) => w.roleKey === roleKey);

  const formatStatus = (assignment?: AgentAssignmentSummaryDTO, item?: WorkItemSummaryDTO) => {
    if (!assignment && !item) return { label: 'Idle', badgeClass: 'badge-secondary' };
    const state = assignment?.officeState ?? item?.status;
    switch (state) {
      case 'completed':
        return { label: 'Completed', badgeClass: 'badge-success' };
      case 'working':
      case 'in_progress':
        return { label: 'Working', badgeClass: 'badge-primary' };
      case 'queued':
        return { label: 'Queued', badgeClass: 'badge-info' };
      case 'waiting':
      case 'waiting_dependency':
        return { label: 'Waiting on Dependency', badgeClass: 'badge-warning' };
      case 'ready':
      case 'preparing':
        return { label: 'Ready', badgeClass: 'badge-info' };
      case 'failed':
        return { label: 'Failed', badgeClass: 'badge-danger' };
      default:
        return { label: String(state), badgeClass: 'badge-secondary' };
    }
  };

  return (
    <div
      className="workforce-timeline-container"
      role="region"
      aria-label="AI Team Activity Timeline"
    >
      <h4 className="timeline-title mb-3">AI Team Workflow & Employee Status</h4>
      <div className="timeline-grid" role="list">
        {ORDERED_ROLES.map((roleKey) => {
          const roleInfo = ROLE_DISPLAY_NAMES[roleKey];
          const assignment = getAssignment(roleKey);
          const item = getWorkItem(roleKey);
          const status = formatStatus(assignment, item);

          return (
            <div
              key={roleKey}
              className={`timeline-card status-${assignment?.officeState ?? 'idle'}`}
              role="listitem"
            >
              <div className="timeline-card-header">
                <div>
                  <h5 className="employee-name">{roleInfo.title}</h5>
                  <span className="employee-desc text-muted text-xs">{roleInfo.desc}</span>
                </div>
                <span className={`badge ${status.badgeClass}`} aria-live="polite">
                  {status.label}
                </span>
              </div>

              <div className="timeline-card-body text-sm my-2">
                {roleKey === 'scriptwriter' && item?.status === 'waiting_dependency' && (
                  <p className="dependency-note text-warning text-xs">
                    Waiting for: Product Strategist, Audience Strategist, Creative Director
                  </p>
                )}
                {roleKey === 'compliance_reviewer' && (
                  <p className="dependency-note text-muted text-xs">
                    Waiting for: Scriptwriter deliverables
                  </p>
                )}
                {item?.completedAt && (
                  <p className="timestamp-note text-muted text-xs">
                    Done: {new Date(item.completedAt).toLocaleTimeString()}
                  </p>
                )}
                {item?.status === 'failed' && (
                  <p className="error-note text-danger text-xs">
                    {item.blockedReasonCode
                      ? `Code: ${item.blockedReasonCode}`
                      : 'Planning step failed.'}
                  </p>
                )}
              </div>

              <div className="timeline-card-footer">
                <button
                  type="button"
                  className="btn-link btn-xs"
                  onClick={() => onInspectEmployee(roleKey)}
                  aria-label={`Inspect ${roleInfo.title}`}
                >
                  Inspect Employee &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
