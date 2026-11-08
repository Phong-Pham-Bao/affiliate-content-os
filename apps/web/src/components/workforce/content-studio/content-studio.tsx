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
    isSubmitting,
    statusState,
    error,
    activePackage,
    comparePackage,
    handleSaveManualEdit,
    handleCancelManualEdit,
    handleRequestChanges,
    handleCloseRequestChanges,
    handleSelectRevision,
    handleCompareRevision,
  } = useContentStudioState(workspaceId, artifactId, initialDetail);

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
        onStartEdit={() => setIsEditing(true)}
        onOpenRequestChanges={() => setIsRequestChangesOpen(true)}
        onClose={onClose}
      />

      <ContentStudioStatusBanner status={statusState} message={error} />

      {activeRevision && (
        <ContentStudioProvenanceBar
          revision={activeRevision}
          lineage={detail?.lineage}
          lifecycleStatus={detail?.artifact.lifecycleStatus ?? 'review_required'}
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
    </div>
  );
}
