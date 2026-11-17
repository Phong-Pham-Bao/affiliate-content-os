'use client';

import type { ReactElement } from 'react';
import type {
  AgentRoleKey,
  ContentArtifactSummaryDTO,
  WorkOrderDetailDTO,
} from '../../types/workforce.js';
import { mapWorkforceViewModel } from '../../lib/workforce-view-model.js';
import { EmployeeInspector } from './employee-inspector.js';

export interface EmployeeInspectorModalProps {
  readonly isOpen: boolean;
  readonly roleKey: AgentRoleKey | null;
  readonly detail: WorkOrderDetailDTO | null;
  readonly artifacts: readonly ContentArtifactSummaryDTO[];
  readonly canManage?: boolean;
  readonly onClose: () => void;
  readonly onSelectArtifact: (artifactId: string) => void;
}

export function EmployeeInspectorModal({
  isOpen,
  roleKey,
  detail,
  artifacts,
  canManage = true,
  onClose,
  onSelectArtifact,
}: EmployeeInspectorModalProps): ReactElement | null {
  if (!isOpen || !roleKey) return null;

  const vm = mapWorkforceViewModel({
    detail,
    artifacts,
    activities: [],
    canManage,
  });

  const employee = vm.employees.find((e) => e.roleKey === roleKey) ?? null;

  return (
    <EmployeeInspector
      isOpen={isOpen}
      employee={employee}
      canManage={canManage}
      onClose={onClose}
      onSelectArtifact={onSelectArtifact}
    />
  );
}

export { EmployeeInspector };
