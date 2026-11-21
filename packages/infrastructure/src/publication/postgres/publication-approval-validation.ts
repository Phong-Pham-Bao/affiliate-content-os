import {
  computeCanonicalHash,
  computePreviewHash,
  PublicationApprovalSnapshotNotFoundError,
  PublicationDriftError,
  PublicationGatedError,
  PublicationPreviewMismatchError,
  renderPublicationText,
  type RenderableVideoInput,
} from '@affiliate-content-os/domain';
import type { CreatePublicationApprovalSnapshotParams } from '@affiliate-content-os/application';
import type { TransactionExecutor } from '../../database/types.js';
import {
  SQL_FIND_COMPLIANCE_EVALUATION,
  SQL_FIND_SOCIAL_ACCOUNT,
  SQL_FIND_SOURCE_ARTIFACT_REVISION,
  SQL_FIND_SOURCE_CONTENT_APPROVAL,
} from './postgres-publication-statements.js';

export interface ValidatedApprovalSource {
  readonly sourceApproval: {
    readonly id: string;
    readonly snapshot_hash: Buffer;
    readonly artifact_id: string;
    readonly revision_number: number;
    readonly content_hash: Buffer;
    readonly policy_hash: Buffer;
  };
  readonly socialAccount: {
    readonly id: string;
    readonly platform: string;
    readonly provider_account_id: string;
    readonly capabilities_checked_at: Date | null;
    readonly version: string | number;
  };
  readonly caps: Record<string, boolean>;
  readonly renderedText: string;
  readonly previewHash: Uint8Array;
  readonly explicitDisclosure: string | undefined;
  readonly capabilityFingerprint: Uint8Array;
  readonly snapshotPayload: Record<string, unknown>;
  readonly snapshotHash: Uint8Array;
}

export async function validateAndAssembleApprovalSource(
  tx: TransactionExecutor,
  params: CreatePublicationApprovalSnapshotParams,
): Promise<ValidatedApprovalSource> {
  // 1. Source content approval
  const contentApprRes = await tx.query<{
    id: string;
    workspace_id: string;
    artifact_id: string;
    revision_number: number;
    content_hash: Buffer;
    evaluation_id: string;
    policy_version: string;
    policy_hash: Buffer;
    snapshot_hash: Buffer;
    created_at: Date;
  }>(SQL_FIND_SOURCE_CONTENT_APPROVAL, [params.workspaceId, params.contentApprovalId]);
  if (contentApprRes.rowCount === 0 || !contentApprRes.rows[0]) {
    throw new PublicationApprovalSnapshotNotFoundError(params.contentApprovalId);
  }
  const sourceApproval = contentApprRes.rows[0];

  // 2. Source artifact revision
  const artRevRes = await tx.query<{
    id: string;
    workspace_id: string;
    artifact_id: string;
    revision_number: number;
    content_hash: Buffer;
    content_json: Record<string, unknown>;
  }>(SQL_FIND_SOURCE_ARTIFACT_REVISION, [
    params.workspaceId,
    sourceApproval.artifact_id,
    sourceApproval.revision_number,
    sourceApproval.content_hash,
  ]);
  if (artRevRes.rowCount === 0 || !artRevRes.rows[0]) {
    throw new PublicationDriftError(
      'artifact_revision',
      'Source artifact revision missing or content hash drifted',
    );
  }
  const artifactRev = artRevRes.rows[0];

  // 3. Compliance evaluation
  const compEvalRes = await tx.query<{
    id: string;
    status: string;
    result: string;
    blocking_count: number;
  }>(SQL_FIND_COMPLIANCE_EVALUATION, [params.workspaceId, sourceApproval.evaluation_id]);
  if (compEvalRes.rowCount === 0 || !compEvalRes.rows[0]) {
    throw new PublicationGatedError(
      'COMPLIANCE_EVALUATION_MISSING',
      'Compliance evaluation missing',
    );
  }
  const compEval = compEvalRes.rows[0];
  if (
    compEval.status !== 'completed' ||
    compEval.result !== 'pass' ||
    compEval.blocking_count > 0
  ) {
    throw new PublicationGatedError(
      'COMPLIANCE_EVALUATION_FAILED',
      'Compliance evaluation is not passed and completed',
    );
  }

  // 4. Social account
  const socialAccRes = await tx.query<{
    id: string;
    workspace_id: string;
    platform: string;
    provider_account_id: string;
    display_name: string;
    handle: string | null;
    status: string;
    capabilities_json: Record<string, boolean>;
    capabilities_checked_at: Date | null;
    version: string | number;
  }>(SQL_FIND_SOCIAL_ACCOUNT, [params.workspaceId, params.socialAccountId]);
  if (socialAccRes.rowCount === 0 || !socialAccRes.rows[0]) {
    throw new PublicationDriftError('social_account', 'Social account not found');
  }
  const socialAccount = socialAccRes.rows[0];
  if (socialAccount.status !== 'active') {
    throw new PublicationGatedError(
      'SOCIAL_ACCOUNT_INACTIVE',
      `Social account status is '${socialAccount.status}', must be active`,
    );
  }
  const caps = socialAccount.capabilities_json ?? {};
  if (!caps.canPublishText) {
    throw new PublicationGatedError(
      'CAPABILITY_MISSING',
      'Social account does not have text publish capability',
    );
  }

  // 5. Video script & text render
  const videos =
    (artifactRev.content_json?.videos as unknown as readonly RenderableVideoInput[]) ?? [];
  const videoIndex = params.videoNumber - 1;
  const video = videos[videoIndex];
  if (!video) {
    throw new PublicationDriftError(
      'video_number',
      `Video #${params.videoNumber} not found in script package`,
    );
  }

  const explicitDisclosure =
    typeof params.platformSettings?.disclosure === 'string'
      ? params.platformSettings.disclosure
      : undefined;
  const renderedText = renderPublicationText(video, { explicitDisclosure });
  const previewHash = computePreviewHash(renderedText);
  const previewHashHex = Buffer.from(previewHash).toString('hex');

  if (
    params.previewHashHex &&
    params.previewHashHex.toLowerCase() !== previewHashHex.toLowerCase()
  ) {
    throw new PublicationPreviewMismatchError(params.previewHashHex, previewHashHex);
  }

  const capabilityFingerprint = computeCanonicalHash(caps);
  const snapshotPayload = {
    sourceContentApprovalId: sourceApproval.id,
    sourceContentApprovalSnapshotHashHex: sourceApproval.snapshot_hash.toString('hex'),
    artifactId: sourceApproval.artifact_id,
    revisionNumber: sourceApproval.revision_number,
    contentHashHex: sourceApproval.content_hash.toString('hex'),
    platform: socialAccount.platform,
    socialAccountId: socialAccount.id,
    providerAccountId: socialAccount.provider_account_id,
    accountVersion: Number(socialAccount.version),
    capabilities: caps,
    renderedText,
    previewHashHex,
    disclosureState: explicitDisclosure ? { explicit: explicitDisclosure } : {},
    platformSettings: params.platformSettings,
    approvedByUserId: params.actorUserId,
    consentType: params.consent.consentType,
    policyVersion: params.consent.policyVersion,
    policyHashHex: sourceApproval.policy_hash.toString('hex'),
  };
  const snapshotHash = computeCanonicalHash(snapshotPayload);

  return {
    sourceApproval,
    socialAccount,
    caps,
    renderedText,
    previewHash,
    explicitDisclosure,
    capabilityFingerprint,
    snapshotPayload,
    snapshotHash,
  };
}
