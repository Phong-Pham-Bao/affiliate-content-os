'use client';

import { useState, type ReactElement } from 'react';
import type { AnalysisSummaryDTO } from '../../types/analysis.js';
import type { FactDTO } from '../../types/catalog.js';
import type { AgentRoleKey, KickoffWorkOrderPayload } from '../../types/workforce.js';
import { kickoffWorkOrderApi, retryWorkOrderPlanningApi } from '../../lib/workforce-api-client.js';
import { mapWorkforceViewModel } from '../../lib/workforce-view-model.js';
import { BoardView } from './board-view.js';
import { DeliverablesSection } from './deliverables-section.js';
import { OfficeView } from './office-view.js';
import { OperationalStatusBanner } from './operational-status-banner.js';
import { useViewModePreference } from './view-mode-toggle.js';
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

export function WorkforceCommandCenter(props: WorkforceCommandCenterProps): ReactElement {
  const {
    workspaceId,
    productId,
    canManage = true,
    hasConfirmedFacts = false,
    confirmedFacts = [],
    acceptedAnalyses = [],
    aiEnabled,
    availableBudgetMicrounits,
    isReadinessLoading = false,
  } = props;
  const orders = useWorkforceOrders(workspaceId, productId);
  const {
    workOrders,
    selectedWorkOrderId,
    setSelectedWorkOrderId,
    activeDetail,
    artifacts,
    activities,
    loading,
    isRefreshing,
    isStale,
    lastUpdatedAt,
    error,
    pollingError,
    activityError,
    setError,
    loadOrderDetail,
    loadWorkOrders,
    refresh,
  } = orders;

  const [viewMode, setViewMode] = useViewModePreference();
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [inspectedRoleKey, setInspectedRoleKey] = useState<AgentRoleKey | null>(null);
  const [viewingArtifactId, setViewingArtifactId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const vm = mapWorkforceViewModel({
    detail: activeDetail,
    artifacts,
    activities,
    isStale,
    isRefreshing,
    lastUpdatedAt,
    pollingError,
    observationWarning: activityError,
    canManage,
  });

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

      {/* Screen-reader live status announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {vm.overview.screenReaderSummary}
      </div>

      <WorkforceHeaderControls
        workOrders={workOrders}
        selectedWorkOrderId={selectedWorkOrderId}
        activeDetail={activeDetail}
        viewMode={viewMode}
        canManage={canManage}
        canRetry={vm.overview.canRetry}
        isRetrying={isRetrying}
        onViewModeChange={setViewMode}
        onSelectWorkOrder={(id) => setSelectedWorkOrderId(id)}
        onOpenAssignDialog={() => setIsAssignOpen(true)}
        onRetry={handleRetry}
      />

      <OperationalStatusBanner
        overview={vm.overview}
        isStale={isStale}
        isRefreshing={isRefreshing}
        pollingError={pollingError}
        observationWarning={vm.observationWarning}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={refresh}
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
          {canManage && (
            <button type="button" className="btn-primary" onClick={() => setIsAssignOpen(true)}>
              Assign Mission to AI Team
            </button>
          )}
        </div>
      )}

      {activeDetail && (
        <>
          {viewMode === 'office' ? (
            <OfficeView
              employees={vm.employees}
              onInspectEmployee={(rk) => setInspectedRoleKey(rk)}
            />
          ) : (
            <BoardView
              employees={vm.employees}
              onInspectEmployee={(rk) => setInspectedRoleKey(rk)}
            />
          )}

          <DeliverablesSection
            artifacts={artifacts}
            onOpenArtifact={(id) => setViewingArtifactId(id)}
          />
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
        activities={activities}
        onCloseAssign={() => setIsAssignOpen(false)}
        onSubmitAssign={handleKickoffSubmit}
        onCloseInspector={() => setInspectedRoleKey(null)}
        onSelectArtifactFromInspector={(id) => setViewingArtifactId(id)}
        onCloseViewer={() => setViewingArtifactId(null)}
      />
    </section>
  );
}
