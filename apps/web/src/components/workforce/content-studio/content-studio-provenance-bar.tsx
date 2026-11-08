'use client';

import type { ReactElement } from 'react';
import type { ContentArtifactRevisionDTO } from '../../../types/workforce.js';
import type { ContentArtifactLineageDTO } from '../../../types/script-studio.js';

interface ContentStudioProvenanceBarProps {
  readonly revision: ContentArtifactRevisionDTO;
  readonly lineage?: ContentArtifactLineageDTO | null | undefined;
  readonly lifecycleStatus: string;
}

export function ContentStudioProvenanceBar({
  revision,
  lineage,
  lifecycleStatus,
}: ContentStudioProvenanceBarProps): ReactElement {
  const cost =
    revision.costMicrounits !== null
      ? `$${(revision.costMicrounits / 1_000_000).toFixed(4)}`
      : 'N/A';

  const lineageLabel =
    lineage?.lineageType === 'human_edited'
      ? 'Chỉnh sửa thủ công'
      : lineage?.lineageType === 'change_request'
        ? 'Yêu cầu thay đổi AI'
        : 'AI tạo tự động';

  return (
    <div
      className="content-studio-provenance-bar p-3 mb-4 bg-light border rounded text-xs"
      role="region"
      aria-label="Thông tin nguồn gốc và chi phí"
    >
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="badge badge-primary text-xs">Phiên bản #{revision.revisionNumber}</span>
          <span className="badge badge-secondary text-xs">{lineageLabel}</span>
          <span className="badge badge-outline-secondary text-xs">
            Trạng thái: {lifecycleStatus}
          </span>
          <span className="text-muted">
            Tác giả: <strong>{revision.authorRoleKey}</strong>
          </span>
        </div>

        <div className="d-flex align-items-center gap-3 flex-wrap text-muted">
          <div>
            <strong>Mô hình:</strong> {revision.provider} / {revision.model}
          </div>
          <div>
            <strong>Chi phí:</strong> {cost}
          </div>
          <div>
            <strong>Độ trễ:</strong> {revision.latencyMs ?? 'N/A'}ms
          </div>
          {lineage?.contentBriefHashHex && (
            <div title={`Brief Hash: ${lineage.contentBriefHashHex}`}>
              <strong>Brief:</strong> {lineage.contentBriefHashHex.slice(0, 8)}...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
