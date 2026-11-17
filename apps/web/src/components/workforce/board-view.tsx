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
  const { setActiveRoleKey, getTabIndex, handleKeyDown } = useRosterKeyboardNav(onInspectEmployee);

  return (
    <div className="workforce-board-view" role="region" aria-label="AI Workforce Operational Board">
      <ul className="board-roster-grid list-unstyled m-0 p-0" role="list">
        {employees.map((emp) => {
          const icon = ROLE_ICONS[emp.roleKey];
          return (
            <li key={emp.roleKey} className="board-roster-item" role="listitem">
              <div
                id={`board-${emp.roleKey}`}
                tabIndex={getTabIndex(emp.roleKey)}
                role="button"
                aria-label={`Inspect ${emp.displayName}, Department: ${emp.department}, Status: ${emp.statusLabel}`}
                className={`board-card status-${emp.officeState}`}
                onClick={() => {
                  setActiveRoleKey(emp.roleKey);
                  onInspectEmployee(emp.roleKey);
                }}
                onFocus={() => setActiveRoleKey(emp.roleKey)}
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
                  <span className="text-primary text-xs inspect-prompt" aria-hidden="true">
                    Inspect &rarr;
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
