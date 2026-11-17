'use client';

import type { ReactElement } from 'react';
import type { AgentRoleKey } from '../../types/workforce.js';
import type { EmployeeVM } from '../../lib/workforce-view-model-types.js';
import { useRosterKeyboardNav } from './use-roster-keyboard-nav.js';

interface BoardViewProps {
  readonly employees: readonly EmployeeVM[];
  readonly onInspectEmployee: (roleKey: AgentRoleKey) => void;
}

const ROLE_ICONS: Record<AgentRoleKey, string> = {
  chief_of_staff: '👔',
  product_strategist: '🎯',
  audience_strategist: '🔍',
  creative_director: '🎬',
  scriptwriter: '✍️',
  compliance_reviewer: '⚖️',
};

export function BoardView({ employees, onInspectEmployee }: BoardViewProps): ReactElement {
  const { handleKeyDown } = useRosterKeyboardNav(onInspectEmployee);

  return (
    <div className="workforce-board-view" role="region" aria-label="AI Workforce Operational Board">
      <div className="board-roster-grid" role="list">
        {employees.map((emp) => {
          const icon = ROLE_ICONS[emp.roleKey];
          return (
            <div
              key={emp.roleKey}
              id={`board-${emp.roleKey}`}
              tabIndex={0}
              role="listitem"
              aria-label={`Employee: ${emp.displayName}, Department: ${emp.department}, Status: ${emp.statusLabel}`}
              className={`board-card status-${emp.officeState}`}
              onClick={() => onInspectEmployee(emp.roleKey)}
              onKeyDown={(e) => handleKeyDown(e, emp.roleKey)}
            >
              <div className="board-card-header d-flex justify-content-between align-items-center mb-2">
                <div className="d-flex align-items-center gap-2">
                  <span className="board-role-icon text-lg" aria-hidden="true">
                    {icon}
                  </span>
                  <div>
                    <h5 className="employee-name m-0 text-base">{emp.displayName}</h5>
                    <span className="employee-dept text-muted text-xs">{emp.department}</span>
                  </div>
                </div>
                <span className={`badge badge-${emp.badgeVariant}`}>{emp.statusLabel}</span>
              </div>

              <div className="board-card-body text-sm my-2">
                {emp.currentTask && (
                  <p className="task-line text-xs mb-1">
                    <strong>Task:</strong> {emp.currentTask}
                  </p>
                )}
                {emp.namedDependencies.length > 0 && emp.officeState === 'waiting_dependency' && (
                  <p className="dependency-line text-warning text-xs mb-1">
                    <strong>Waiting for:</strong>{' '}
                    {emp.namedDependencies.map((d) => d.roleName).join(', ')}
                  </p>
                )}
                {emp.latestReportCode && (
                  <p className="report-code-line text-muted text-xs mb-1">
                    <strong>Report:</strong> <code>{emp.latestReportCode}</code>
                  </p>
                )}
                {emp.operationalDetails.actionableMessage && (
                  <p className="error-line text-danger text-xs mb-1">
                    {emp.operationalDetails.actionableMessage}
                  </p>
                )}
              </div>

              <div className="board-card-footer d-flex justify-content-between align-items-center pt-2 border-top text-xs">
                <span className="deliverables-count text-muted">
                  {emp.deliverables.length > 0
                    ? `${emp.deliverables.length} deliverable(s)`
                    : 'No deliverables yet'}
                </span>
                <button
                  type="button"
                  className="btn btn-link btn-xs p-0 text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectEmployee(emp.roleKey);
                  }}
                  aria-label={`Inspect ${emp.displayName} details`}
                >
                  Inspect &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
