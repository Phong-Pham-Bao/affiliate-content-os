'use client';

import type { ReactElement } from 'react';
import type { ContentArtifactRevisionDTO } from '../../../types/workforce.js';

interface ContentStudioRevisionHistoryProps {
  readonly revisions: readonly ContentArtifactRevisionDTO[];
  readonly currentRevisionNumber: number;
  readonly activeRevisionNumber: number;
  readonly onSelectRevision: (revNumber: number) => void;
  readonly onCompareRevision: (revNumber: number) => void;
  readonly onClose: () => void;
}

export function ContentStudioRevisionHistory({
  revisions,
  currentRevisionNumber,
  activeRevisionNumber,
  onSelectRevision,
  onCompareRevision,
  onClose,
}: ContentStudioRevisionHistoryProps): ReactElement {
  return (
    <section
      className="content-studio-revision-history bg-white p-4 border rounded shadow-sm mb-4"
      role="region"
      aria-label="Lịch sử phiên bản bất biến"
    >
      <div className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
        <div>
          <h5 className="mb-1 text-primary">Lịch sử phiên bản bất biến ({revisions.length})</h5>
          <span className="text-muted text-xs">
            Mỗi lần sửa đổi hoặc tạo mới đều tạo một bản ghi bất biến có tính nguồn gốc đầy đủ.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={onClose}
          aria-label="Đóng bảng lịch sử"
        >
          &times; Đóng
        </button>
      </div>

      {revisions.length === 0 ? (
        <p className="text-muted text-sm mb-0">Chưa có lịch sử phiên bản nào.</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover text-sm mb-0">
            <thead className="thead-light">
              <tr>
                <th>Phiên bản</th>
                <th>Tác giả</th>
                <th>Thời gian tạo</th>
                <th>Mã băm nội dung</th>
                <th className="text-end">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev) => {
                const isCurrent = rev.revisionNumber === currentRevisionNumber;
                const isActive = rev.revisionNumber === activeRevisionNumber;
                return (
                  <tr key={rev.id} className={isActive ? 'table-primary font-weight-bold' : ''}>
                    <td>
                      #{rev.revisionNumber}
                      {isCurrent && (
                        <span className="badge badge-success ms-2 text-xs">Mới nhất</span>
                      )}
                      {isActive && <span className="badge badge-info ms-2 text-xs">Đang xem</span>}
                    </td>
                    <td>{rev.authorRoleKey}</td>
                    <td className="text-muted">{new Date(rev.createdAt).toLocaleString()}</td>
                    <td>
                      <code className="text-xs" title={rev.contentHashHex}>
                        {rev.contentHashHex.slice(0, 10)}...
                      </code>
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end">
                        <button
                          type="button"
                          className="btn btn-xs btn-outline-primary"
                          onClick={() => onSelectRevision(rev.revisionNumber)}
                          disabled={isActive}
                          aria-label={`Xem phiên bản ${rev.revisionNumber}`}
                        >
                          Xem
                        </button>
                        {!isCurrent && (
                          <button
                            type="button"
                            className="btn btn-xs btn-outline-secondary"
                            onClick={() => onCompareRevision(rev.revisionNumber)}
                            aria-label={`So sánh phiên bản ${rev.revisionNumber}`}
                          >
                            So sánh
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
