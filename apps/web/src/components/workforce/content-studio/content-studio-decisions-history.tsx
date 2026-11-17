'use client';

import type { ReactElement } from 'react';
import type {
  ContentReviewDecisionDTO,
  ContentApprovalSnapshotDTO,
} from '../../../types/compliance.js';

interface ContentStudioDecisionsHistoryProps {
  readonly decisions: readonly ContentReviewDecisionDTO[];
  readonly approvalSnapshot?: ContentApprovalSnapshotDTO | null | undefined;
  readonly isLoading?: boolean | undefined;
  readonly onClose: () => void;
}

export function ContentStudioDecisionsHistory({
  decisions,
  approvalSnapshot,
  isLoading = false,
  onClose,
}: ContentStudioDecisionsHistoryProps): ReactElement {
  return (
    <section
      className="content-studio-decisions-history border rounded p-3 mb-4 bg-white shadow-sm"
      aria-label="Lịch sử quyết định kiểm duyệt của con người"
    >
      <div className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
        <h4 className="h6 mb-0 text-dark">
          Lịch sử quyết định kiểm duyệt (Human Decisions History)
        </h4>
        <button
          type="button"
          className="btn-close"
          onClick={onClose}
          aria-label="Đóng bảng lịch sử quyết định"
        >
          &times;
        </button>
      </div>

      {isLoading ? (
        <div className="d-flex align-items-center gap-2 py-2">
          <span
            className="spinner-border spinner-border-sm text-primary"
            role="status"
            aria-hidden="true"
          />
          <span className="text-muted text-sm">Đang tải lịch sử quyết định...</span>
        </div>
      ) : decisions.length === 0 ? (
        <p className="text-muted text-sm mb-0">
          Chưa có quyết định thẩm định nào được ghi nhận cho kịch bản này.
        </p>
      ) : (
        <div className="d-flex flex-column gap-3">
          {approvalSnapshot && (
            <div className="card border-success bg-success-subtle text-success-emphasis p-3">
              <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                <span className="badge bg-success">Snapshot Chấp thuận Hoàn tất</span>
                <span className="text-xs font-monospace">
                  Chính sách: {approvalSnapshot.policyVersion}
                </span>
              </div>
              <div className="text-xs mb-1">
                <strong>Người phê duyệt:</strong> {approvalSnapshot.approvedByUserId}
              </div>
              <div className="text-xs mb-1">
                <strong>Thời điểm phê duyệt:</strong> {approvalSnapshot.createdAt}
              </div>
              {approvalSnapshot.affiliateDisclosureText && (
                <div className="text-xs mt-2 pt-2 border-top border-success-subtle">
                  <strong>Thông báo tiếp thị liên kết bắt buộc:</strong>
                  <div className="fst-italic mt-1">
                    &ldquo;{approvalSnapshot.affiliateDisclosureText}&rdquo;
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0 text-sm align-middle">
              <thead className="table-light">
                <tr>
                  <th scope="col">Phiên bản</th>
                  <th scope="col">Quyết định</th>
                  <th scope="col">Người thực hiện</th>
                  <th scope="col">Thời điểm</th>
                  <th scope="col">Chi tiết (Lý do / Ghi chú)</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((dec) => {
                  const badgeClass =
                    dec.decision === 'accepted'
                      ? 'bg-success'
                      : dec.decision === 'rejected'
                        ? 'bg-danger'
                        : 'bg-warning text-dark';

                  const label =
                    dec.decision === 'accepted'
                      ? 'Chấp thuận'
                      : dec.decision === 'rejected'
                        ? 'Từ chối'
                        : 'Yêu cầu AI sửa';

                  return (
                    <tr key={dec.id}>
                      <td className="font-monospace text-xs">#{dec.revisionNumber}</td>
                      <td>
                        <span className={`badge ${badgeClass}`}>{label}</span>
                      </td>
                      <td className="text-xs font-monospace text-muted">
                        {dec.actorUserId.slice(0, 8)}...
                      </td>
                      <td className="text-xs text-muted">
                        {new Date(dec.createdAt).toLocaleString('vi-VN')}
                      </td>
                      <td className="text-xs">
                        {dec.reason && (
                          <div className="text-danger">
                            <strong>Lý do:</strong> {dec.reason}
                          </div>
                        )}
                        {dec.note && (
                          <div className="text-muted">
                            <strong>Ghi chú:</strong> {dec.note}
                          </div>
                        )}
                        {!dec.reason && !dec.note && (
                          <span className="text-muted fst-italic">Không có ghi chú</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
