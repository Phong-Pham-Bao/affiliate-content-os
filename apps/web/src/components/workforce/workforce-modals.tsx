'use client';

import type { ReactElement } from 'react';
import type { AnalysisSummaryDTO } from '../../types/analysis.js';
import type { FactDTO } from '../../types/catalog.js';
import type {
  AgentRoleKey,
  ContentArtifactSummaryDTO,
  KickoffWorkOrderPayload,
  WorkOrderDetailDTO,
} from '../../types/workforce.js';
import { AssignToAiTeamDialog } from './assign-to-ai-team-dialog.js';
import { EmployeeInspectorModal } from './employee-inspector-modal.js';
import { ArtifactViewerModal } from './artifact-viewer-modal.js';

interface WorkforceModalsProps {
  readonly workspaceId: string;
  readonly isAssignOpen: boolean;
  readonly canManage: boolean;
  readonly hasConfirmedFacts: boolean;
  readonly confirmedFacts: readonly FactDTO[];
  readonly acceptedAnalyses: readonly AnalysisSummaryDTO[];
  readonly aiEnabled: boolean;
  readonly availableBudgetMicrounits: number;
  readonly isSubmittingAssign: boolean;
  readonly assignError: string | null;
  readonly inspectedRoleKey: AgentRoleKey | null;
  readonly viewingArtifactId: string | null;
  readonly activeDetail: WorkOrderDetailDTO | null;
  readonly artifacts: readonly ContentArtifactSummaryDTO[];
  readonly onCloseAssign: () => void;
  readonly onSubmitAssign: (payload: KickoffWorkOrderPayload, key: string) => Promise<void>;
  readonly onCloseInspector: () => void;
  readonly onSelectArtifactFromInspector: (id: string) => void;
  readonly onCloseViewer: () => void;
}

export function WorkforceModals(props: WorkforceModalsProps): ReactElement {
  return (
    <>
      <AssignToAiTeamDialog
        isOpen={props.isAssignOpen}
        canManage={props.canManage}
        hasConfirmedFacts={props.hasConfirmedFacts}
        confirmedFacts={props.confirmedFacts}
        acceptedAnalyses={props.acceptedAnalyses}
        aiEnabled={props.aiEnabled}
        availableBudgetMicrounits={props.availableBudgetMicrounits}
        isSubmitting={props.isSubmittingAssign}
        error={props.assignError}
        onClose={props.onCloseAssign}
        onSubmit={props.onSubmitAssign}
      />

      <EmployeeInspectorModal
        isOpen={Boolean(props.inspectedRoleKey)}
        roleKey={props.inspectedRoleKey}
        detail={props.activeDetail}
        artifacts={props.artifacts}
        onClose={props.onCloseInspector}
        onSelectArtifact={props.onSelectArtifactFromInspector}
      />

      <ArtifactViewerModal
        isOpen={Boolean(props.viewingArtifactId)}
        workspaceId={props.workspaceId}
        artifactId={props.viewingArtifactId}
        onClose={props.onCloseViewer}
      />
    </>
  );
}
