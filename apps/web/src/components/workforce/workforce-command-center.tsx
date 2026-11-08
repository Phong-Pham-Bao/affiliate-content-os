'use client';

import { useState, type ReactElement } from 'react';
import type { AnalysisSummaryDTO } from '../../types/analysis.js';
import type { FactDTO } from '../../types/catalog.js';
import type { AgentRoleKey, KickoffWorkOrderPayload } from '../../types/workforce.js';
import { kickoffWorkOrderApi, retryWorkOrderPlanningApi } from '../../lib/workforce-api-client.js';
import { PlanningArtifactCard } from './planning-artifact-card.js';
import { WorkOrderTimeline } from './work-order-timeline.js';
import { WorkforceHeaderControls } from './workforce-header-controls.js';
import { WorkforceModals } from './workforce-modals.js';
import { useWorkforceOrders } from './use-workforce-orders.js';

interface WorkforceCommandCenterProps {
  readonly workspaceId: string;
  readonly productId: string;
  readonly canManage?: boolean;
  readonly hasConfirmedFacts?: boolean;
  readonly confirmedFacts?: readonly FactDTO[];
  readonly acceptedAnalyses?: readonly AnalysisSummaryDTO[];
  readonly aiEnabled?: boolean | undefined;
  readonly availableBudgetMicrounits?: number | undefined;
  readonly isReadinessLoading?: boolean | undefined;
}

export function WorkforceCommandCenter({
  workspaceId,
  productId,
  canManage = true,
  hasConfirmedFacts = false,
  confirmedFacts = [],
  acceptedAnalyses = [],
  aiEnabled,
  availableBudgetMicrounits,
  isReadinessLoading = false,
}: WorkforceCommandCenterProps): ReactElement {
  const {
    workOrders,
    selectedWorkOrderId,
    setSelectedWorkOrderId,
    activeDetail,
    artifacts,
    loading,
    error,
    setError,
    loadWorkOrders,
    loadOrderDetail,
  } = useWorkforceOrders(workspaceId, productId);

  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [inspectedRoleKey, setInspectedRoleKey] = useState<AgentRoleKey | null>(null);
  const [viewingArtifactId, setViewingArtifactId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleKickoffSubmit = async (payload: KickoffWorkOrderPayload, key: string) => {
    setIsSubmittingAssign(true);
    setAssignError(null);
    try {
      const res = await kickoffWorkOrderApi(workspaceId, productId, payload, key);
      setIsAssignOpen(false);
      await loadWorkOrders();
      setSelectedWorkOrderId(res.workOrder.id);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign mission to AI team');
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  const handleRetry = async () => {
    if (!selectedWorkOrderId) return;
    setIsRetrying(true);
    setError(null);
    try {
      await retryWorkOrderPlanningApi(workspaceId, selectedWorkOrderId);
      await loadOrderDetail(selectedWorkOrderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <section
      className="workforce-command-center section-container my-4"
      aria-labelledby="wf-heading"
    >
      <h2 id="wf-heading" className="sr-only">
        AI Workforce Command Center
      </h2>
      <WorkforceHeaderControls
        workOrders={workOrders}
        selectedWorkOrderId={selectedWorkOrderId}
        activeDetail={activeDetail}
        isRetrying={isRetrying}
        onSelectWorkOrder={(id) => setSelectedWorkOrderId(id)}
        onOpenAssignDialog={() => setIsAssignOpen(true)}
        onRetry={handleRetry}
      />
      {error && (
        <div role="alert" className="alert-danger mb-4 p-3 rounded">
          {error}
        </div>
      )}
      {loading && !activeDetail && <p className="text-muted">Loading AI workforce status...</p>}
      {!loading && workOrders.length === 0 && (
        <div className="empty-state p-4 text-center border rounded bg-light">
          <p className="text-muted mb-3">
            No missions assigned to the AI team yet for this product.
          </p>
          <button type="button" className="btn-primary" onClick={() => setIsAssignOpen(true)}>
            Assign Mission to AI Team
          </button>
        </div>
      )}
      {activeDetail && (
        <>
          <WorkOrderTimeline
            detail={activeDetail}
            onInspectEmployee={(rk) => setInspectedRoleKey(rk)}
          />
          {artifacts.length > 0 && (
            <div className="artifacts-section mt-4">
              <h4 className="artifacts-title mb-3">Deliverables &amp; Planning Artifacts</h4>
              <div className="artifact-cards-grid d-flex gap-3 flex-wrap">
                {artifacts.map((art) => (
                  <PlanningArtifactCard
                    key={art.id}
                    artifact={art}
                    onOpen={(id) => setViewingArtifactId(id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <WorkforceModals
        workspaceId={workspaceId}
        isAssignOpen={isAssignOpen}
        canManage={canManage}
        hasConfirmedFacts={hasConfirmedFacts}
        confirmedFacts={confirmedFacts}
        acceptedAnalyses={acceptedAnalyses}
        aiEnabled={aiEnabled}
        availableBudgetMicrounits={availableBudgetMicrounits}
        isLoadingContext={isReadinessLoading}
        isSubmittingAssign={isSubmittingAssign}
        assignError={assignError}
        inspectedRoleKey={inspectedRoleKey}
        viewingArtifactId={viewingArtifactId}
        activeDetail={activeDetail}
        artifacts={artifacts}
        onCloseAssign={() => setIsAssignOpen(false)}
        onSubmitAssign={handleKickoffSubmit}
        onCloseInspector={() => setInspectedRoleKey(null)}
        onSelectArtifactFromInspector={(id) => setViewingArtifactId(id)}
        onCloseViewer={() => setViewingArtifactId(null)}
      />
    </section>
  );
}
