'use client';

import type { ReactElement } from 'react';
import type { AgentRoleKey } from '../../types/workforce.js';
import type { EmployeeVM } from '../../lib/workforce-view-model-types.js';
import { useRosterKeyboardNav } from './use-roster-keyboard-nav.js';

interface OfficeViewProps {
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

export function OfficeView({ employees, onInspectEmployee }: OfficeViewProps): ReactElement {
  const { setActiveRoleKey, getTabIndex, handleKeyDown } = useRosterKeyboardNav(onInspectEmployee);

  const getEmp = (rk: AgentRoleKey): EmployeeVM | undefined =>
    employees.find((e) => e.roleKey === rk);

  const renderStation = (rk: AgentRoleKey) => {
    const emp = getEmp(rk);
    if (!emp) return null;
    const icon = ROLE_ICONS[rk];

    return (
      <div
        key={rk}
        id={`station-${rk}`}
        tabIndex={getTabIndex(rk)}
        role="button"
        aria-label={`Inspect ${emp.displayName}, Department: ${emp.department}, Status: ${emp.statusLabel}`}
        className={`office-station station-${emp.station} ${emp.positionClass} status-${emp.officeState}`}
        onClick={() => {
          setActiveRoleKey(rk);
          onInspectEmployee(rk);
        }}
        onFocus={() => setActiveRoleKey(rk)}
        onKeyDown={(e) => handleKeyDown(e, rk)}
      >
        <div className="station-header d-flex justify-content-between align-items-center">
          <span className="station-icon" aria-hidden="true">
            {icon}
          </span>
          <span className={`badge badge-${emp.badgeVariant}`}>{emp.statusLabel}</span>
        </div>
        <div className="station-body my-1">
          <strong className="station-role-title d-block">{emp.displayName}</strong>
          <span className="station-department text-muted text-xs">{emp.department}</span>
          {emp.namedDependencies.length > 0 && emp.officeState === 'waiting_dependency' && (
            <div className="station-dependency-note text-warning text-xs mt-1">
              Waiting on: {emp.namedDependencies.map((d) => d.roleName).join(', ')}
            </div>
          )}
          {emp.operationalDetails.actionableMessage && (
            <div className="station-alert-note text-danger text-xs mt-1">
              {emp.operationalDetails.actionableMessage}
            </div>
          )}
        </div>
        <div className="station-footer text-xs text-muted d-flex justify-content-between mt-1">
          <span>
            {emp.deliverables.length > 0 ? `${emp.deliverables.length} item(s)` : 'No files'}
          </span>
          <span className="inspect-prompt">Inspect &rarr;</span>
        </div>
      </div>
    );
  };

  return (
    <div className="office-floor-plan" role="region" aria-label="Virtual AI Company Office Map">
      <div className="office-grid">
        {/* Department Zone: Strategy Room */}
        <section className="office-zone zone-strategy" aria-labelledby="zone-strategy-title">
          <h4 id="zone-strategy-title" className="zone-title">
            Strategy Room
          </h4>
          <div className="zone-stations">{renderStation('chief_of_staff')}</div>
        </section>

        {/* Department Zone: Planning & Market Insights */}
        <section className="office-zone zone-planning" aria-labelledby="zone-planning-title">
          <h4 id="zone-planning-title" className="zone-title">
            Planning & Insights Pod
          </h4>
          <div className="zone-stations d-flex gap-2">
            {renderStation('product_strategist')}
            {renderStation('audience_strategist')}
          </div>
        </section>

        {/* Department Zone: Content Studio */}
        <section className="office-zone zone-content" aria-labelledby="zone-content-title">
          <h4 id="zone-content-title" className="zone-title">
            Creative & Content Studio
          </h4>
          <div className="zone-stations d-flex gap-2">
            {renderStation('creative_director')}
            {renderStation('scriptwriter')}
          </div>
        </section>

        {/* Department Zone: Quality Lab */}
        <section className="office-zone zone-quality" aria-labelledby="zone-quality-title">
          <h4 id="zone-quality-title" className="zone-title">
            Quality & Compliance Lab
          </h4>
          <div className="zone-stations">{renderStation('compliance_reviewer')}</div>
        </section>
      </div>

      {/* Central Review & Human Handoff Lane */}
      <div
        className="office-handoff-lane mt-3 p-2 rounded"
        role="region"
        aria-label="Human Executive Review Lane"
      >
        <div className="d-flex justify-content-between align-items-center text-xs">
          <span>
            <strong>Executive Review Lane:</strong> Deliverables flow here for authenticated human
            acceptance.
          </span>
          <span className="text-muted">
            Keyboard: Arrow keys navigate stations, Enter/Space inspects.
          </span>
        </div>
      </div>
    </div>
  );
}
