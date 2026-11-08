'use client';

import type { ReactElement } from 'react';
import type { WorkOrderDetailDTO, WorkOrderSummaryDTO } from '../../types/workforce.js';

interface WorkforceHeaderControlsProps {
  readonly workOrders: readonly WorkOrderSummaryDTO[];
  readonly selectedWorkOrderId: string | null;
  readonly activeDetail: WorkOrderDetailDTO | null;
  readonly isRetrying: boolean;
  readonly onSelectWorkOrder: (id: string) => void;
  readonly onOpenAssignDialog: () => void;
  readonly onRetry: () => Promise<void>;
}

export function WorkforceHeaderControls({
  workOrders,
  selectedWorkOrderId,
  activeDetail,
  isRetrying,
  onSelectWorkOrder,
  onOpenAssignDialog,
  onRetry,
}: WorkforceHeaderControlsProps): ReactElement {
  const currentStatus = activeDetail?.workOrder.status;
  const isFailed = currentStatus === 'failed';

  return (
    <div className="workforce-header d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
      <div>
        <h3 className="section-title mb-1">AI Workforce Command Center</h3>
        <p className="section-subtitle text-muted text-sm mb-0">
          Autonomous planning pod: Product Strategist, Audience Strategist &amp; Creative Director
        </p>
      </div>

      <div className="d-flex align-items-center gap-2 flex-wrap">
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

        {isFailed && (
          <button
            type="button"
            className="btn-warning btn-sm"
            onClick={() => void onRetry()}
            disabled={isRetrying}
            aria-label="Retry failed planning items"
          >
            {isRetrying ? 'Retrying...' : 'Retry Planning Steps'}
          </button>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={onOpenAssignDialog}
          aria-haspopup="dialog"
        >
          + Assign to AI Team
        </button>
      </div>
    </div>
  );
}
