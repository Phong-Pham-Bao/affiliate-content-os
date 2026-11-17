'use client';

import type { ReactElement } from 'react';
import type { WorkOrderDetailDTO, WorkOrderSummaryDTO } from '../../types/workforce.js';
import { ViewModeToggle, type WorkforceViewMode } from './view-mode-toggle.js';

interface WorkforceHeaderControlsProps {
  readonly workOrders: readonly WorkOrderSummaryDTO[];
  readonly selectedWorkOrderId: string | null;
  readonly activeDetail: WorkOrderDetailDTO | null;
  readonly viewMode?: WorkforceViewMode;
  readonly canManage?: boolean;
  readonly canRetry?: boolean;
  readonly isRetrying: boolean;
  readonly onViewModeChange?: (mode: WorkforceViewMode) => void;
  readonly onSelectWorkOrder: (id: string) => void;
  readonly onOpenAssignDialog: () => void;
  readonly onRetry: () => Promise<void>;
}

export function WorkforceHeaderControls({
  workOrders,
  selectedWorkOrderId,
  activeDetail,
  viewMode = 'office',
  canManage = true,
  canRetry = activeDetail?.workOrder.status === 'failed',
  isRetrying,
  onViewModeChange = () => {},
  onSelectWorkOrder,
  onOpenAssignDialog,
  onRetry,
}: WorkforceHeaderControlsProps): ReactElement {
  return (
    <div className="workforce-header d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <div>
        <h3 className="section-title mb-1">AI Workforce Command Center</h3>
        <p className="section-subtitle text-muted text-sm mb-0">
          Autonomous AI company: Strategy Room, Planning Pod, Content Studio &amp; Quality Lab
        </p>
      </div>

      <div className="d-flex align-items-center gap-2 flex-wrap">
        <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />

        {workOrders.length > 1 && (
          <select
            className="form-control form-control-sm"
            value={selectedWorkOrderId ?? ''}
            onChange={(e) => onSelectWorkOrder(e.target.value)}
            aria-label="Select Work Order"
          >
            {workOrders.map((wo) => (
              <option key={wo.id} value={wo.id}>
                Mission {wo.id.slice(0, 8)} ({wo.status})
              </option>
            ))}
          </select>
        )}

        {canManage && canRetry && (
          <button
            type="button"
            className="btn btn-warning btn-sm"
            onClick={() => void onRetry()}
            disabled={isRetrying}
            aria-label="Retry failed planning items"
          >
            {isRetrying ? 'Retrying...' : 'Retry Planning Steps'}
          </button>
        )}

        {canManage && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onOpenAssignDialog}
            aria-haspopup="dialog"
          >
            + Assign to AI Team
          </button>
        )}
      </div>
    </div>
  );
}
