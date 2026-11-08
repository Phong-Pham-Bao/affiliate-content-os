'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ContentArtifactDetailDTO,
  ContentArtifactRevisionDTO,
} from '../../../types/workforce.js';
import type { ScriptPackage } from '../../../types/script-studio.js';
import {
  createManualRevisionApi,
  fetchArtifactDetailApi,
  fetchArtifactRevisionByNumberApi,
  fetchArtifactRevisionsApi,
  requestScriptChangesApi,
} from '../../../lib/workforce-api-client.js';
import { validateScriptPackage } from '../../../lib/workforce-validators-script.js';
import { generateCryptoIdempotencyKey } from '../../../lib/crypto-idempotency.js';
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

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setError(null);
    setStatusState('idle');
    setIsEditing(false);
    setCompareRevision(null);

    const loadData = async () => {
      try {
        let currentDetail = initialDetail;
        if (!currentDetail) {
          currentDetail = await fetchArtifactDetailApi(workspaceId, artifactId, ctrl.signal);
          setDetail(currentDetail);
          setActiveRevision(currentDetail.latestRevision);
        }
        const revs = await fetchArtifactRevisionsApi(workspaceId, artifactId, ctrl.signal);
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
    const key = generateCryptoIdempotencyKey() ?? globalThis.crypto?.randomUUID?.() ?? 'key';
    try {
      const res = await createManualRevisionApi(
        workspaceId,
        artifactId,
        {
          expectedVersion: detail.artifact.version,
          baseRevisionNumber: activeRevision.revisionNumber,
          baseContentHashHex: activeRevision.contentHashHex,
          rawContent: updatedPackage,
          note: note || undefined,
        },
        key,
      );
      setDetail(res);
      setActiveRevision(res.latestRevision);
      setIsEditing(false);
      setStatusState('ready');
      const revs = await fetchArtifactRevisionsApi(workspaceId, artifactId);
      setRevisions(revs.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi lưu phiên bản chỉnh sửa';
      setError(msg);
      setStatusState(
        msg.includes('Precondition') || msg.includes('conflict') ? 'stale_conflict' : 'failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestChanges = async (
    selectedVideos: (1 | 2 | 3 | 4 | 5)[],
    instruction: string,
    variants: number,
  ) => {
    if (!detail || !activeRevision) return;
    setIsSubmitting(true);
    setError(null);
    const key = generateCryptoIdempotencyKey() ?? globalThis.crypto?.randomUUID?.() ?? 'key';
    try {
      await requestScriptChangesApi(
        workspaceId,
        artifactId,
        {
          expectedVersion: detail.artifact.version,
          baseRevisionNumber: activeRevision.revisionNumber,
          baseContentHashHex: activeRevision.contentHashHex,
          instructionText: instruction,
          selectedVideoNumbers: selectedVideos,
          targetVariantCount: variants,
        },
        key,
      );
      setIsRequestChangesOpen(false);
      setStatusState('running');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi yêu cầu thay đổi';
      setError(msg);
      setStatusState(
        msg.includes('Precondition') || msg.includes('conflict') ? 'stale_conflict' : 'failed',
      );
    } finally {
      setIsSubmitting(false);
    }
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
    handleRequestChanges,
    handleSelectRevision,
    handleCompareRevision,
  };
}
