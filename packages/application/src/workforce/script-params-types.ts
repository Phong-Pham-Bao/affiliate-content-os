import type { ScriptPackage, UserId, WorkspaceId } from '@affiliate-content-os/domain';

export interface CreateManualRevisionParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly content: ScriptPackage;
  readonly note?: string | undefined;
}

export interface RequestScriptChangesParams {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly actorUserId: UserId;
  readonly expectedVersion: number;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly instructionText: string;
  readonly selectedVideoNumbers: readonly (1 | 2 | 3 | 4 | 5)[];
  readonly targetVariantCount?: number | undefined;
}
