'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactRevisionDTO,
} from '../../../types/workforce.js';
import type { ArtifactChangeRequestDTO, ScriptPackage } from '../../../types/script-studio.js';
import {
  createManualRevisionApi,
  fetchArtifactDetailApi,
  fetchArtifactRevisionByNumberApi,
  fetchArtifactRevisionsApi,
  requestScriptChangesApi,
} from '../../../lib/workforce-api-client.js';
import { validateScriptPackage } from '../../../lib/workforce-validators-script.js';
import {
  generateCryptoIdempotencyKey,
  normalizeManualSavePayload,
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusState, setStatusState] = useState<ContentStudioStatusState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resumableChangeRequestId, setResumableChangeRequestId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const activeChangeRequestIdRef = useRef<string | null>(null);

  const manualSaveSubmissionRef = useRef<{ key: string; payloadStr: string } | null>(null);
  const requestChangesSubmissionRef = useRef<{ key: string; payloadStr: string } | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    pollAbortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    activeChangeRequestIdRef.current = null;
    setResumableChangeRequestId(null);
    manualSaveSubmissionRef.current = null;
    requestChangesSubmissionRef.current = null;

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
  }, [workspaceId, artifactId, initialDetail]);

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
      note: note || undefined,
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
      const res = await createManualRevisionApi(workspaceId, artifactId, payload, key);
      // Definitive success -> clear retry key and pending change request
      manualSaveSubmissionRef.current = null;
      setResumableChangeRequestId(null);
      activeChangeRequestIdRef.current = null;
      setDetail(res);
      setActiveRevision(res.latestRevision);
      setIsEditing(false);
      setStatusState('ready');
      const revs = await fetchArtifactRevisionsApi(workspaceId, artifactId);
      setRevisions(revs.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Ambiguous transport failure: retain key for retry with identical payload
        setError(err.message || 'Lỗi mạng khi lưu phiên bản chỉnh sửa. Bạn có thể nhấn thử lại.');
      } else {
        // Definitive server response: clear retry key
        manualSaveSubmissionRef.current = null;
        const msg = err instanceof Error ? err.message : 'Lỗi khi lưu phiên bản chỉnh sửa';
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
      // Definitive 202 response -> clear retry key
      requestChangesSubmissionRef.current = null;
      setIsRequestChangesOpen(false);
      setStatusState('running');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Ambiguous transport failure: retain key for retry with identical payload
        setError(err.message || 'Lỗi mạng khi gửi yêu cầu thay đổi. Bạn có thể nhấn thử lại.');
      } else {
        // Definitive server response: clear retry key
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

    // Start bounded, abortable polling for change request completion
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

      // Definitive terminal result from server: clear resumable ID
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
          'Quá thời gian theo dõi tự động cho yêu cầu thay đổi. Tác vụ vẫn có thể đang chạy trên máy chủ. Bạn có thể nhấn Tiếp tục kiểm tra.',
        );
      } else if (pollErr instanceof ApiError && pollErr.status === 0) {
        setStatusState('polling_deadline');
        setError(
          'Mất kết nối mạng khi kiểm tra trạng thái yêu cầu thay đổi. Bạn có thể nhấn Tiếp tục kiểm tra.',
        );
      } else {
        setResumableChangeRequestId(null);
        activeChangeRequestIdRef.current = null;
        setStatusState('failed');
        setError(
          pollErr instanceof Error
            ? pollErr.message
            : 'Lỗi trong quá trình kiểm tra trạng thái yêu cầu',
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
    handleResumePolling,
    canResumePolling,
    resumableChangeRequestId,
  };
}
