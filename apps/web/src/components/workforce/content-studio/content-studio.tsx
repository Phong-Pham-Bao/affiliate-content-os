'use client';

import type { ReactElement } from 'react';
import type { ContentArtifactDetailDTO } from '../../../types/workforce.js';
import { useContentStudioState } from './use-content-studio-state.js';
import { ContentStudioHeaderToolbar } from './content-studio-header-toolbar.js';
import { ContentStudioVideoNav } from './content-studio-video-nav.js';
import { ContentStudioVideoReader } from './content-studio-video-reader.js';
import { ContentStudioProvenanceBar } from './content-studio-provenance-bar.js';
import { ContentStudioStatusBanner } from './content-studio-status-banner.js';
import { ContentStudioRevisionHistory } from './content-studio-revision-history.js';
import { ContentStudioFieldCompare } from './content-studio-field-compare.js';
import { ContentStudioManualEditor } from './content-studio-manual-editor.js';
import { ContentStudioRequestChangesDialog } from './content-studio-request-changes-dialog.js';
import { ContentStudioCompliancePanel } from './content-studio-compliance-panel.js';
import { ContentStudioAcceptDialog } from './content-studio-accept-dialog.js';
import { ContentStudioRejectDialog } from './content-studio-reject-dialog.js';
import { ContentStudioDecisionsHistory } from './content-studio-decisions-history.js';

export interface ContentStudioProps {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly canManage?: boolean | undefined;
  readonly initialDetail?: ContentArtifactDetailDTO | null | undefined;
  readonly onClose?: (() => void) | undefined;
}

export function ContentStudio({
  workspaceId,
  artifactId,
  canManage = true,
  initialDetail = null,
  onClose,
}: ContentStudioProps): ReactElement {
  const {
    detail,
    revisions,
    activeRevision,
    compareRevision,
    setCompareRevision,
    selectedVideoIndex,
    setSelectedVideoIndex,
    isEditing,
    setIsEditing,
    isHistoryOpen,
    setIsHistoryOpen,
    isRequestChangesOpen,
    setIsRequestChangesOpen,
    isAcceptDialogOpen,
    setIsAcceptDialogOpen,
    isRejectDialogOpen,
    setIsRejectDialogOpen,
    isDecisionsOpen,
    setIsDecisionsOpen,
    isSubmitting,
    statusState,
    error,
    activePackage,
    comparePackage,
    // Compliance & Decisions
    complianceEvaluation,
    isComplianceLoading,
    complianceError,
    decisions,
    isDecisionsLoading,
    approvalSnapshot,
    canAccept,
    canReject,
    acceptDisabledReason,
    rejectDisabledReason,
    // Actions
    handleSaveManualEdit,
    handleCancelManualEdit,
    handleRequestChanges,
    handleCloseRequestChanges,
    handleSelectRevision,
    handleCompareRevision,
    handleResumePolling,
    handleAcceptRevision,
    handleRejectRevision,
    handleRetryCompliance,
    canResumePolling,
  } = useContentStudioState(workspaceId, artifactId, initialDetail, canManage);

  const advisoryWarnings =
    complianceEvaluation?.findings.filter((f) => f.severity === 'warning') ?? [];

  return (
    <div
      className="content-studio-container p-4"
      role="region"
      aria-label="Xưởng kịch bản Content Studio"
    >
      <ContentStudioHeaderToolbar
        seriesTitle={activePackage?.seriesTitle || ''}
        canManage={canManage}
        isEditing={isEditing}
        isComparing={Boolean(compareRevision)}
        isHistoryOpen={isHistoryOpen}
        onToggleHistory={() => setIsHistoryOpen((prev) => !prev)}
        isDecisionsOpen={isDecisionsOpen}
        onToggleDecisions={() => setIsDecisionsOpen((prev) => !prev)}
        onStartEdit={() => setIsEditing(true)}
        onOpenRequestChanges={() => setIsRequestChangesOpen(true)}
        onOpenAccept={() => setIsAcceptDialogOpen(true)}
        onOpenReject={() => setIsRejectDialogOpen(true)}
        canAccept={canAccept}
        canReject={canReject}
        acceptDisabledReason={acceptDisabledReason}
        rejectDisabledReason={rejectDisabledReason}
        onClose={onClose}
      />

      <ContentStudioStatusBanner
        status={statusState}
        message={error}
        onResume={canResumePolling ? handleResumePolling : undefined}
      />

      {activeRevision && (
        <ContentStudioProvenanceBar
          revision={activeRevision}
          lineage={detail?.lineage}
          lifecycleStatus={detail?.artifact.lifecycleStatus ?? 'review_required'}
        />
      )}

      {/* Compliance & Policy Evaluation Panel (Checkpoint D) */}
      <ContentStudioCompliancePanel
        evaluation={complianceEvaluation}
        isLoading={isComplianceLoading}
        error={complianceError}
        onRetry={handleRetryCompliance}
      />

      {/* Decisions History (Checkpoint D) */}
      {isDecisionsOpen && (
        <ContentStudioDecisionsHistory
          decisions={decisions}
          approvalSnapshot={approvalSnapshot}
          isLoading={isDecisionsLoading}
          onClose={() => setIsDecisionsOpen(false)}
        />
      )}

      {isHistoryOpen && (
        <ContentStudioRevisionHistory
          revisions={revisions}
          currentRevisionNumber={detail?.artifact.currentRevisionNumber ?? 1}
          activeRevisionNumber={activeRevision?.revisionNumber ?? 1}
          onSelectRevision={handleSelectRevision}
          onCompareRevision={handleCompareRevision}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}

      {compareRevision && comparePackage && activePackage && (
        <ContentStudioFieldCompare
          baseRevNumber={activeRevision?.revisionNumber ?? 1}
          basePackage={activePackage}
          targetRevNumber={compareRevision.revisionNumber}
          targetPackage={comparePackage}
          videoIndex={selectedVideoIndex}
          onClose={() => setCompareRevision(null)}
        />
      )}

      {isEditing && activePackage && activeRevision && detail && (
        <ContentStudioManualEditor
          pkg={activePackage}
          videoIndex={selectedVideoIndex}
          baseRevisionNumber={activeRevision.revisionNumber}
          baseContentHashHex={activeRevision.contentHashHex}
          expectedVersion={detail.artifact.version}
          isSubmitting={isSubmitting}
          error={error}
          onSave={handleSaveManualEdit}
          onCancel={handleCancelManualEdit}
        />
      )}

      {!isEditing && activePackage && (
        <>
          <ContentStudioVideoNav
            videos={activePackage.videos}
            selectedIndex={selectedVideoIndex}
            onSelectVideo={setSelectedVideoIndex}
          />
          <ContentStudioVideoReader
            video={activePackage.videos[selectedVideoIndex] ?? activePackage.videos[0]}
          />
        </>
      )}

      <ContentStudioRequestChangesDialog
        isOpen={isRequestChangesOpen}
        baseRevisionNumber={activeRevision?.revisionNumber ?? 1}
        baseContentHashHex={activeRevision?.contentHashHex ?? ''}
        isSubmitting={isSubmitting}
        error={error}
        onSubmit={handleRequestChanges}
        onClose={handleCloseRequestChanges}
      />

      {/* Accept Dialog (Checkpoint D) */}
      <ContentStudioAcceptDialog
        isOpen={isAcceptDialogOpen}
        revisionNumber={activeRevision?.revisionNumber ?? 1}
        contentHashHex={activeRevision?.contentHashHex ?? ''}
        warnings={advisoryWarnings}
        isSubmitting={isSubmitting}
        error={error}
        onConfirm={handleAcceptRevision}
        onClose={() => setIsAcceptDialogOpen(false)}
      />

      {/* Reject Dialog (Checkpoint D) */}
      <ContentStudioRejectDialog
        isOpen={isRejectDialogOpen}
        revisionNumber={activeRevision?.revisionNumber ?? 1}
        contentHashHex={activeRevision?.contentHashHex ?? ''}
        isSubmitting={isSubmitting}
        error={error}
        onConfirm={handleRejectRevision}
        onClose={() => setIsRejectDialogOpen(false)}
      />
    </div>
  );
}
