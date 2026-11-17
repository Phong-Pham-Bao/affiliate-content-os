'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactRevisionDTO,
} from '../../../types/workforce.js';
import type { ArtifactChangeRequestDTO, ScriptPackage } from '../../../types/script-studio.js';
import type {
  ComplianceEvaluationDTO,
  ContentApprovalSnapshotDTO,
  ContentReviewDecisionDTO,
} from '../../../types/compliance.js';
import {
  acceptScriptRevisionApi,
  createManualRevisionApi,
  fetchArtifactComplianceApi,
  fetchArtifactDecisionsApi,
  fetchArtifactDetailApi,
  fetchArtifactRevisionByNumberApi,
  fetchArtifactRevisionsApi,
  rejectScriptRevisionApi,
  requestScriptChangesApi,
} from '../../../lib/workforce-api-client.js';
import { validateScriptPackage } from '../../../lib/workforce-validators-script.js';
import {
  generateCryptoIdempotencyKey,
  normalizeAcceptRevisionPayload,
  normalizeManualSavePayload,
  normalizeRejectRevisionPayload,
  normalizeRequestChangesPayload,
} from '../../../lib/crypto-idempotency.js';
import {
  PollingDeadlineError,
  pollChangeRequestUntilTerminal,
} from '../../../lib/workforce-operation-polling.js';
import { ApiError } from '../../../lib/api-validators-common.js';
import type { ContentStudioStatusState } from './content-studio-status-banner.js';

export function useContentStudioState(
  workspaceId: string,
  artifactId: string,
  initialDetail?: ContentArtifactDetailDTO | null | undefined,
  canManage = true,
) {
  const [detail, setDetail] = useState<ContentArtifactDetailDTO | null>(initialDetail ?? null);
  const [revisions, setRevisions] = useState<readonly ContentArtifactRevisionDTO[]>([]);
  const [activeRevision, setActiveRevision] = useState<ContentArtifactRevisionDTO | null>(
    initialDetail?.latestRevision ?? null,
  );
  const [compareRevision, setCompareRevision] = useState<ContentArtifactRevisionDTO | null>(null);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRequestChangesOpen, setIsRequestChangesOpen] = useState(false);
  const [isAcceptDialogOpen, setIsAcceptDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isDecisionsOpen, setIsDecisionsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusState, setStatusState] = useState<ContentStudioStatusState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resumableChangeRequestId, setResumableChangeRequestId] = useState<string | null>(null);

  // Compliance & Decision states (Checkpoint D)
  const [complianceEvaluation, setComplianceEvaluation] = useState<ComplianceEvaluationDTO | null>(
    null,
  );
  const [isComplianceLoading, setIsComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<readonly ContentReviewDecisionDTO[]>([]);
  const [isDecisionsLoading, setIsDecisionsLoading] = useState(false);
  const [approvalSnapshot, setApprovalSnapshot] = useState<ContentApprovalSnapshotDTO | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const activeChangeRequestIdRef = useRef<string | null>(null);

  const manualSaveSubmissionRef = useRef<{ key: string; payloadStr: string } | null>(null);
  const requestChangesSubmissionRef = useRef<{ key: string; payloadStr: string } | null>(null);
  const acceptSubmissionRef = useRef<{ key: string; payloadStr: string } | null>(null);
  const rejectSubmissionRef = useRef<{ key: string; payloadStr: string } | null>(null);

  const loadComplianceForRevision = useCallback(
    async (revNum: number, signal?: AbortSignal) => {
      setIsComplianceLoading(true);
      setComplianceError(null);
      try {
        const evalResult = await fetchArtifactComplianceApi(
          workspaceId,
          artifactId,
          revNum,
          signal,
        );
        if (!signal?.aborted) {
          setComplianceEvaluation(evalResult);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setComplianceEvaluation(null);
          setComplianceError(
            err instanceof Error ? err.message : 'Chưa tải được đánh giá tuân thủ',
          );
        }
      } finally {
        if (!signal?.aborted) {
          setIsComplianceLoading(false);
        }
      }
    },
    [workspaceId, artifactId],
  );

  const loadDecisions = useCallback(
    async (signal?: AbortSignal) => {
      setIsDecisionsLoading(true);
      try {
        const decResult = await fetchArtifactDecisionsApi(workspaceId, artifactId, signal);
        if (!signal?.aborted) {
          setDecisions(decResult.items);
        }
      } catch {
        // Safe degrade
      } finally {
        if (!signal?.aborted) {
          setIsDecisionsLoading(false);
        }
      }
    },
    [workspaceId, artifactId],
  );

  useEffect(() => {
    abortRef.current?.abort();
    pollAbortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    activeChangeRequestIdRef.current = null;
    setResumableChangeRequestId(null);
    manualSaveSubmissionRef.current = null;
    requestChangesSubmissionRef.current = null;
    acceptSubmissionRef.current = null;
    rejectSubmissionRef.current = null;

    setError(null);
    setStatusState('idle');
    setIsEditing(false);
    setCompareRevision(null);

    const loadData = async () => {
      try {
        let currentDetail = initialDetail;
        if (!currentDetail) {
          currentDetail = await fetchArtifactDetailApi(workspaceId, artifactId, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setDetail(currentDetail);
          setActiveRevision(currentDetail.latestRevision);
        }
        const revs = await fetchArtifactRevisionsApi(workspaceId, artifactId, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setRevisions(revs.items);

        const currentRevNum = currentDetail?.artifact.currentRevisionNumber ?? 1;
        void loadComplianceForRevision(currentRevNum, ctrl.signal);
        void loadDecisions(ctrl.signal);
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu kịch bản');
          setStatusState('failed');
        }
      }
    };

    void loadData();

    return () => {
      ctrl.abort();
      pollAbortRef.current?.abort();
    };
  }, [workspaceId, artifactId, initialDetail, loadComplianceForRevision, loadDecisions]);

  const activePackage: ScriptPackage | null = (() => {
    if (!activeRevision?.contentJson) return null;
    try {
      return validateScriptPackage(activeRevision.contentJson);
    } catch {
      return null;
    }
  })();

  const comparePackage: ScriptPackage | null = (() => {
    if (!compareRevision?.contentJson) return null;
    try {
      return validateScriptPackage(compareRevision.contentJson);
    } catch {
      return null;
    }
  })();

  const handleSaveManualEdit = async (updatedPackage: ScriptPackage, note: string) => {
    if (!detail || !activeRevision) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      expectedVersion: detail.artifact.version,
      baseRevisionNumber: activeRevision.revisionNumber,
      baseContentHashHex: activeRevision.contentHashHex,
      rawContent: updatedPackage,
      note: note.trim() || undefined,
    };

    const normalized = normalizeManualSavePayload(workspaceId, artifactId, payload);
    let key: string;

    if (manualSaveSubmissionRef.current?.payloadStr === normalized) {
      key = manualSaveSubmissionRef.current.key;
    } else {
      const generated = generateCryptoIdempotencyKey();
      if (!generated) {
        setIsSubmitting(false);
        setError(
          'Trình duyệt không hỗ trợ Web Crypto bảo mật. Vui lòng thử lại trên trình duyệt hiện đại.',
        );
        setStatusState('failed');
        return;
      }
      key = generated;
      manualSaveSubmissionRef.current = { key, payloadStr: normalized };
    }

    try {
      const updatedDetail = await createManualRevisionApi(workspaceId, artifactId, payload, key);
      manualSaveSubmissionRef.current = null;
      setDetail(updatedDetail);
      setActiveRevision(updatedDetail.latestRevision);
      setCompareRevision(null);
      setIsEditing(false);
      setStatusState('ready');
      setError(null);

      // Refresh revisions, compliance and decisions
      const revs = await fetchArtifactRevisionsApi(workspaceId, artifactId);
      setRevisions(revs.items);
      void loadComplianceForRevision(updatedDetail.latestRevision.revisionNumber);
      void loadDecisions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError(err.message || 'Lỗi mạng khi lưu chỉnh sửa. Bạn có thể nhấn thử lại.');
      } else {
        manualSaveSubmissionRef.current = null;
        const msg = err instanceof Error ? err.message : 'Lỗi khi lưu chỉnh sửa thủ công';
        setError(msg);
        setStatusState(
          msg.includes('Precondition') ||
            msg.includes('conflict') ||
            (err instanceof ApiError && err.status === 409)
            ? 'stale_conflict'
            : 'failed',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelManualEdit = () => {
    manualSaveSubmissionRef.current = null;
    setIsEditing(false);
  };

  const handleRequestChanges = async (
    selectedVideos: (1 | 2 | 3 | 4 | 5)[],
    instruction: string,
    variants: number,
  ) => {
    if (!detail || !activeRevision) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      expectedVersion: detail.artifact.version,
      baseRevisionNumber: activeRevision.revisionNumber,
      baseContentHashHex: activeRevision.contentHashHex,
      instructionText: instruction,
      selectedVideoNumbers: selectedVideos,
      targetVariantCount: variants,
    };

    const normalized = normalizeRequestChangesPayload(workspaceId, artifactId, payload);
    let key: string;

    if (requestChangesSubmissionRef.current?.payloadStr === normalized) {
      key = requestChangesSubmissionRef.current.key;
    } else {
      const generated = generateCryptoIdempotencyKey();
      if (!generated) {
        setIsSubmitting(false);
        setError(
          'Trình duyệt không hỗ trợ Web Crypto bảo mật. Vui lòng thử lại trên trình duyệt hiện đại.',
        );
        setStatusState('failed');
        return;
      }
      key = generated;
      requestChangesSubmissionRef.current = { key, payloadStr: normalized };
    }

    let changeRequest: ArtifactChangeRequestDTO;
    try {
      changeRequest = await requestScriptChangesApi(workspaceId, artifactId, payload, key);
      requestChangesSubmissionRef.current = null;
      setIsRequestChangesOpen(false);
      setStatusState('running');
      void loadDecisions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError(err.message || 'Lỗi mạng khi gửi yêu cầu thay đổi. Bạn có thể nhấn thử lại.');
      } else {
        requestChangesSubmissionRef.current = null;
        const msg = err instanceof Error ? err.message : 'Lỗi khi yêu cầu thay đổi';
        setError(msg);
        setStatusState(
          msg.includes('Precondition') ||
            msg.includes('conflict') ||
            (err instanceof ApiError && err.status === 409)
            ? 'stale_conflict'
            : 'failed',
        );
      }
      setIsSubmitting(false);
      return;
    } finally {
      setIsSubmitting(false);
    }

    await executePolling(changeRequest.id);
  };

  const executePolling = async (crId: string) => {
    activeChangeRequestIdRef.current = crId;
    setResumableChangeRequestId(crId);
    pollAbortRef.current?.abort();
    const pollCtrl = new AbortController();
    pollAbortRef.current = pollCtrl;

    const currentWsId = workspaceId;
    const currentArtId = artifactId;

    setStatusState('running');
    setError(null);

    try {
      const finalCr = await pollChangeRequestUntilTerminal(
        currentWsId,
        currentArtId,
        crId,
        pollCtrl.signal,
        (cr) => {
          if (
            pollCtrl.signal.aborted ||
            currentWsId !== workspaceId ||
            currentArtId !== artifactId
          ) {
            return;
          }
          if (cr.status === 'pending' || cr.status === 'in_progress') {
            setStatusState('running');
          }
        },
      );

      if (pollCtrl.signal.aborted || currentWsId !== workspaceId || currentArtId !== artifactId) {
        return;
      }

      setResumableChangeRequestId(null);
      activeChangeRequestIdRef.current = null;

      if (finalCr.status === 'completed') {
        const updatedDetail = await fetchArtifactDetailApi(
          currentWsId,
          currentArtId,
          pollCtrl.signal,
        );
        const revs = await fetchArtifactRevisionsApi(currentWsId, currentArtId, pollCtrl.signal);
        if (pollCtrl.signal.aborted || currentWsId !== workspaceId || currentArtId !== artifactId) {
          return;
        }
        setDetail(updatedDetail);
        setRevisions(revs.items);
        const resultingRev = finalCr.resultingRevisionNumber
          ? (revs.items.find((r) => r.revisionNumber === finalCr.resultingRevisionNumber) ??
            updatedDetail.latestRevision)
          : updatedDetail.latestRevision;
        setActiveRevision(resultingRev);
        setCompareRevision(null);
        setStatusState('ready');
        setError(null);

        void loadComplianceForRevision(resultingRev.revisionNumber);
        void loadDecisions();
      } else if (finalCr.status === 'failed') {
        if (
          finalCr.failureCode === 'stale_base_conflict' ||
          finalCr.failureReason?.includes('Stale base')
        ) {
          setStatusState('stale_conflict');
          setError(
            'Kịch bản đã được cập nhật bởi một phiên bản khác trước khi yêu cầu hoàn tất. Vui lòng xem phiên bản mới nhất.',
          );
        } else if (
          finalCr.failureCode === 'context_drift' ||
          finalCr.failureReason?.includes('Authoritative context drift')
        ) {
          setStatusState('failed');
          setError(
            'Kế hoạch chiến dịch đã thay đổi trong quá trình xử lý. Yêu cầu đã dừng lại để tránh tạo kịch bản từ dữ liệu cũ.',
          );
        } else if (finalCr.failureCode === 'budget_exhausted') {
          setStatusState('insufficient_budget');
          setError('Ngân sách AI của workspace không đủ để hoàn thành yêu cầu.');
        } else {
          setStatusState('failed');
          setError(finalCr.failureReason || 'Tạo lại kịch bản thất bại');
        }
      } else if (finalCr.status === 'canceled') {
        setStatusState('failed');
        setError('Yêu cầu thay đổi đã bị hủy.');
      }
    } catch (pollErr) {
      if (pollCtrl.signal.aborted || currentWsId !== workspaceId || currentArtId !== artifactId) {
        return;
      }
      if (pollErr instanceof PollingDeadlineError) {
        setStatusState('polling_deadline');
        setError(
          'Tác vụ tạo kịch bản đang mất nhiều thời gian hơn dự kiến. Bạn có thể nhấn Tiếp tục theo dõi.',
        );
      } else {
        setStatusState('failed');
        setError(
          pollErr instanceof Error ? pollErr.message : 'Lỗi trong quá trình kiểm tra trạng thái',
        );
      }
    }
  };

  const handleResumePolling = async () => {
    if (!resumableChangeRequestId) return;
    await executePolling(resumableChangeRequestId);
  };

  const canResumePolling = Boolean(resumableChangeRequestId) && statusState !== 'running';

  const handleCloseRequestChanges = () => {
    requestChangesSubmissionRef.current = null;
    setIsRequestChangesOpen(false);
  };

  const handleSelectRevision = async (revNum: number) => {
    try {
      const rev = await fetchArtifactRevisionByNumberApi(workspaceId, artifactId, revNum);
      setActiveRevision(rev);
      setCompareRevision(null);
      setIsEditing(false);
      void loadComplianceForRevision(revNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải phiên bản');
    }
  };

  const handleCompareRevision = async (targetRevNum: number) => {
    try {
      const targetRev = await fetchArtifactRevisionByNumberApi(
        workspaceId,
        artifactId,
        targetRevNum,
      );
      setCompareRevision(targetRev);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải phiên bản so sánh');
    }
  };

  // Human Decisions (Accept / Reject) Handlers (Checkpoint D)
  const isCurrentRevision = Boolean(
    detail &&
    activeRevision &&
    detail.artifact.currentRevisionNumber === activeRevision.revisionNumber,
  );
  const isEvaluating =
    complianceEvaluation?.status === 'pending' ||
    complianceEvaluation?.status === 'running' ||
    isComplianceLoading;
  const hasBlockingFindings = (complianceEvaluation?.blockingCount ?? 0) > 0;
  const isAccepted = detail?.artifact.lifecycleStatus === 'accepted';
  const isRejected = detail?.artifact.lifecycleStatus === 'rejected';

  const canAccept =
    canManage &&
    isCurrentRevision &&
    complianceEvaluation?.status === 'completed' &&
    complianceEvaluation.result !== 'blocked' &&
    complianceEvaluation.result !== 'failed' &&
    complianceEvaluation.blockingCount === 0 &&
    complianceEvaluation.aiAdvisoryStatus !== 'failed' &&
    !isAccepted &&
    !isRejected;

  const canReject = canManage && isCurrentRevision && !isAccepted && !isRejected;

  const acceptDisabledReason = !canManage
    ? 'Chỉ người quản lý workspace mới có quyền phê duyệt kịch bản'
    : !isCurrentRevision
      ? 'Chỉ có thể phê duyệt phiên bản kịch bản hiện tại'
      : isAccepted
        ? 'Phiên bản này đã được chấp thuận'
        : isRejected
          ? 'Phiên bản này đã bị từ chối'
          : isEvaluating
            ? 'Đang trong quá trình đánh giá tuân thủ...'
            : complianceEvaluation?.status === 'failed'
              ? 'Đánh giá tuân thủ gặp lỗi'
              : complianceEvaluation?.aiAdvisoryStatus === 'failed'
                ? 'Đánh giá tư vấn AI gặp lỗi từ phía nhà cung cấp'
                : hasBlockingFindings
                  ? `Có ${complianceEvaluation?.blockingCount} vi phạm ngăn chặn xuất bản`
                  : undefined;

  const rejectDisabledReason = !canManage
    ? 'Chỉ người quản lý workspace mới có quyền từ chối kịch bản'
    : !isCurrentRevision
      ? 'Chỉ có thể từ chối phiên bản kịch bản hiện tại'
      : isRejected
        ? 'Phiên bản này đã bị từ chối'
        : isAccepted
          ? 'Phiên bản này đã được chấp thuận'
          : undefined;

  const handleAcceptRevision = async (note?: string) => {
    if (!detail || !activeRevision) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      expectedVersion: detail.artifact.version,
      revisionNumber: activeRevision.revisionNumber,
      contentHashHex: activeRevision.contentHashHex,
      note,
    };

    const normalized = normalizeAcceptRevisionPayload(workspaceId, artifactId, payload);
    let key: string;

    if (acceptSubmissionRef.current?.payloadStr === normalized) {
      key = acceptSubmissionRef.current.key;
    } else {
      const generated = generateCryptoIdempotencyKey();
      if (!generated) {
        setIsSubmitting(false);
        setError('Trình duyệt không hỗ trợ Web Crypto bảo mật.');
        return;
      }
      key = generated;
      acceptSubmissionRef.current = { key, payloadStr: normalized };
    }

    try {
      const result = await acceptScriptRevisionApi(workspaceId, artifactId, payload, key);
      acceptSubmissionRef.current = null;
      setDetail(result.artifact);
      setApprovalSnapshot(result.approvalSnapshot);
      setIsAcceptDialogOpen(false);
      setStatusState('ready');
      setError(null);
      void loadDecisions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError(err.message || 'Lỗi mạng khi chấp thuận kịch bản. Bạn có thể nhấn thử lại.');
      } else {
        acceptSubmissionRef.current = null;
        const msg = err instanceof Error ? err.message : 'Lỗi khi chấp thuận kịch bản';
        setError(msg);
        setStatusState(
          msg.includes('Precondition') ||
            msg.includes('conflict') ||
            (err instanceof ApiError && err.status === 409)
            ? 'stale_conflict'
            : 'failed',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectRevision = async (reason: string) => {
    if (!detail || !activeRevision) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      expectedVersion: detail.artifact.version,
      revisionNumber: activeRevision.revisionNumber,
      contentHashHex: activeRevision.contentHashHex,
      reason,
    };

    const normalized = normalizeRejectRevisionPayload(workspaceId, artifactId, payload);
    let key: string;

    if (rejectSubmissionRef.current?.payloadStr === normalized) {
      key = rejectSubmissionRef.current.key;
    } else {
      const generated = generateCryptoIdempotencyKey();
      if (!generated) {
        setIsSubmitting(false);
        setError('Trình duyệt không hỗ trợ Web Crypto bảo mật.');
        return;
      }
      key = generated;
      rejectSubmissionRef.current = { key, payloadStr: normalized };
    }

    try {
      const result = await rejectScriptRevisionApi(workspaceId, artifactId, payload, key);
      rejectSubmissionRef.current = null;
      setDetail(result.artifact);
      setIsRejectDialogOpen(false);
      setStatusState('ready');
      setError(null);
      void loadDecisions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setError(err.message || 'Lỗi mạng khi từ chối kịch bản. Bạn có thể nhấn thử lại.');
      } else {
        rejectSubmissionRef.current = null;
        const msg = err instanceof Error ? err.message : 'Lỗi khi từ chối kịch bản';
        setError(msg);
        setStatusState(
          msg.includes('Precondition') ||
            msg.includes('conflict') ||
            (err instanceof ApiError && err.status === 409)
            ? 'stale_conflict'
            : 'failed',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
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
    // Compliance & Decisions data
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
    handleRetryCompliance: () => {
      if (activeRevision) void loadComplianceForRevision(activeRevision.revisionNumber);
    },
    canResumePolling,
    resumableChangeRequestId,
  };
}
