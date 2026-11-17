'use client';

import { useId, useState, type ReactElement } from 'react';
import type { ComplianceEvaluationDTO, ComplianceFindingDTO } from '../../../types/compliance.js';

interface ContentStudioCompliancePanelProps {
  readonly evaluation: ComplianceEvaluationDTO | null;
  readonly isLoading?: boolean | undefined;
  readonly error?: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
}

export function ContentStudioCompliancePanel({
  evaluation,
  isLoading = false,
  error = null,
  onRetry,
}: ContentStudioCompliancePanelProps): ReactElement {
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'blocking' | 'warning' | 'info'>(
    'all',
  );
  const panelId = useId();

  if (isLoading) {
    return (
      <section
        className="content-studio-compliance-panel border rounded p-3 mb-4 bg-light"
        aria-busy="true"
        aria-label="Bảng đánh giá tuân thủ"
      >
        <div className="d-flex align-items-center gap-2">
          <span
            className="spinner-border spinner-border-sm text-primary"
            role="status"
            aria-hidden="true"
          />
          <span className="text-muted text-sm">Đang tải báo cáo đánh giá tuân thủ...</span>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="content-studio-compliance-panel border border-warning rounded p-3 mb-4 bg-light"
        aria-label="Bảng đánh giá tuân thủ"
      >
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <strong className="text-warning">Chưa tải được báo cáo tuân thủ:</strong>
            <span className="text-sm ms-2 text-muted">{error}</span>
          </div>
          {onRetry && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry}>
              Thử lại
            </button>
          )}
        </div>
      </section>
    );
  }

  if (!evaluation) {
    return (
      <section
        className="content-studio-compliance-panel border rounded p-3 mb-4 bg-light"
        aria-label="Bảng đánh giá tuân thủ"
      >
        <p className="text-muted text-sm mb-0">
          Chưa có báo cáo tuân thủ cho phiên bản kịch bản này.
        </p>
      </section>
    );
  }

  const statusBadgeClass =
    evaluation.status === 'completed'
      ? evaluation.blockingCount > 0
        ? 'bg-danger'
        : 'bg-success'
      : evaluation.status === 'running'
        ? 'bg-primary'
        : evaluation.status === 'failed'
          ? 'bg-danger'
          : 'bg-secondary';

  const statusLabel =
    evaluation.status === 'completed'
      ? evaluation.blockingCount > 0
        ? 'Vi phạm chặn xuất bản'
        : 'Đạt điều kiện xem xét'
      : evaluation.status === 'running'
        ? 'Đang kiểm tra...'
        : evaluation.status === 'failed'
          ? 'Lỗi đánh giá'
          : 'Đang xếp hàng';

  const findings = evaluation.findings ?? [];
  const filteredFindings =
    filterSeverity === 'all' ? findings : findings.filter((f) => f.severity === filterSeverity);

  // Group findings by video
  const findingsByVideo = new Map<number | 'general', ComplianceFindingDTO[]>();
  for (const f of filteredFindings) {
    const key = f.videoNumber ?? 'general';
    const group = findingsByVideo.get(key) ?? [];
    group.push(f);
    findingsByVideo.set(key, group);
  }

  return (
    <section
      className="content-studio-compliance-panel border rounded p-3 mb-4 bg-white shadow-sm"
      aria-label="Bảng kiểm tra tuân thủ và tư vấn AI"
      id={panelId}
    >
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3 pb-2 border-bottom">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <h4 className="h6 mb-0 text-dark">Đánh giá tuân thủ & An toàn thương mại</h4>
          <span className={`badge ${statusBadgeClass}`}>{statusLabel}</span>
          <span className="badge bg-light text-muted border text-xs">
            Chính sách: {evaluation.policyVersion}
          </span>
          <span className="text-muted text-xs">Phiên bản #{evaluation.revisionNumber}</span>
        </div>

        <div
          className="d-flex align-items-center gap-1 btn-group btn-group-sm"
          role="group"
          aria-label="Lọc mức độ"
        >
          <button
            type="button"
            className={`btn btn-xs ${filterSeverity === 'all' ? 'btn-dark' : 'btn-outline-secondary'}`}
            onClick={() => setFilterSeverity('all')}
          >
            Tất cả ({findings.length})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filterSeverity === 'blocking' ? 'btn-danger' : 'btn-outline-danger'}`}
            onClick={() => setFilterSeverity('blocking')}
          >
            Ngăn chặn ({evaluation.blockingCount})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filterSeverity === 'warning' ? 'btn-warning' : 'btn-outline-warning'}`}
            onClick={() => setFilterSeverity('warning')}
          >
            Cảnh báo ({evaluation.warningCount})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filterSeverity === 'info' ? 'btn-info' : 'btn-outline-info'}`}
            onClick={() => setFilterSeverity('info')}
          >
            Thông tin ({evaluation.infoCount})
          </button>
        </div>
      </div>

      {evaluation.blockingCount > 0 && (
        <div className="alert alert-danger py-2 px-3 text-sm mb-3" role="alert">
          <strong>Lưu ý bắt buộc:</strong> Có {evaluation.blockingCount} vi phạm ngăn chặn xuất bản
          theo luật tất định. Kịch bản không thể được chấp thuận cho đến khi các vi phạm này được
          chỉnh sửa thủ công.
        </div>
      )}

      {findings.length === 0 ? (
        <p className="text-muted text-sm mb-0">
          Tuyệt vời! Không phát hiện vi phạm quy tắc tuân thủ nào trên phiên bản này.
        </p>
      ) : filteredFindings.length === 0 ? (
        <p className="text-muted text-sm mb-0">
          Không có phát hiện nào thuộc mức độ &quot;{filterSeverity}&quot;.
        </p>
      ) : (
        <div className="compliance-findings-list d-flex flex-column gap-3">
          {Array.from(findingsByVideo.entries()).map(([videoKey, groupFindings]) => (
            <div key={String(videoKey)} className="compliance-group border-start border-3 ps-3">
              <h5 className="h6 text-secondary mb-2">
                {videoKey === 'general'
                  ? 'Quy định chung toàn bộ chuỗi video'
                  : `Video ${videoKey}`}
              </h5>

              <div className="d-flex flex-column gap-2">
                {groupFindings.map((finding) => {
                  const severityBadge =
                    finding.severity === 'blocking'
                      ? 'bg-danger'
                      : finding.severity === 'warning'
                        ? 'bg-warning text-dark'
                        : 'bg-info text-dark';

                  const sourceLabel =
                    finding.source === 'deterministic_rule' ? 'Luật tất định' : 'Tư vấn AI';

                  return (
                    <div
                      key={finding.id}
                      className="finding-card border rounded p-2 bg-light-subtle text-sm"
                    >
                      <div className="d-flex justify-content-between align-items-center gap-2 mb-1 flex-wrap">
                        <div className="d-flex align-items-center gap-1">
                          <span className={`badge ${severityBadge}`}>
                            {finding.severity === 'blocking'
                              ? 'Ngăn chặn'
                              : finding.severity === 'warning'
                                ? 'Cảnh báo'
                                : 'Thông tin'}
                          </span>
                          <span className="badge bg-secondary-subtle text-secondary border">
                            {sourceLabel}
                          </span>
                          <span className="font-monospace text-xs text-muted">
                            [{finding.ruleId}]
                          </span>
                          {finding.fieldPath && (
                            <span className="font-monospace text-xs text-primary">
                              {finding.fieldPath}
                            </span>
                          )}
                        </div>
                      </div>

                      {finding.flaggedText && (
                        <blockquote className="my-1 py-1 px-2 border-start border-2 border-danger bg-light text-danger-emphasis font-monospace text-xs mb-1">
                          &quot;{finding.flaggedText}&quot;
                        </blockquote>
                      )}

                      <p className="mb-1 text-dark">{finding.message}</p>

                      {finding.suggestedFix && (
                        <p className="mb-1 text-muted text-xs">
                          <strong className="text-secondary">Gợi ý sửa đổi:</strong>{' '}
                          {finding.suggestedFix}
                        </p>
                      )}

                      {finding.evidenceReferences.length > 0 && (
                        <div className="d-flex align-items-center gap-1 flex-wrap mt-1">
                          <span className="text-xs text-muted">Căn cứ:</span>
                          {finding.evidenceReferences.map((ref, idx) => (
                            <span
                              key={`${ref.sourceId}-${idx}`}
                              className="badge bg-light text-dark border text-xs"
                              title={`Tham chiếu: ${ref.sourceId}`}
                            >
                              {ref.sourceKind === 'product_fact' ? 'Dữ liệu sản phẩm' : 'Phân tích'}
                              : {ref.sourceId.slice(0, 8)}...
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
