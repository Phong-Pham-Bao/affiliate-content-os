'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useEscapeKey } from '../../../lib/use-escape-key.js';

interface ContentStudioRejectDialogProps {
  readonly isOpen: boolean;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onConfirm: (reason: string) => Promise<void>;
  readonly onClose: () => void;
}

export function ContentStudioRejectDialog({
  isOpen,
  revisionNumber,
  contentHashHex,
  isSubmitting,
  error,
  onConfirm,
  onClose,
}: ContentStudioRejectDialogProps): ReactElement | null {
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEscapeKey(onClose, isSubmitting, isOpen);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setValidationError('Vui lòng nhập lý do từ chối kịch bản.');
      return;
    }
    if (trimmed.length > 2000) {
      setValidationError('Lý do từ chối không được vượt quá 2000 ký tự.');
      return;
    }

    await onConfirm(trimmed);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-dialog-title"
        className="modal-content content-studio-reject-modal"
      >
        <div className="modal-header">
          <h4 id="reject-dialog-title" className="modal-title text-danger">
            Từ chối kịch bản (Human Rejection)
          </h4>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Đóng hộp thoại"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body my-3">
            <p className="text-muted text-sm">
              Bạn đang quyết định từ chối phiên bản kịch bản này. Thao tác này sẽ đánh dấu trạng
              thái phiên bản là <strong>rejected</strong> và lưu trữ lý do từ chối vào lịch sử thẩm
              định của đội ngũ.
            </p>

            <div className="text-xs text-muted mb-3 p-2 bg-light rounded">
              <div>
                <strong>Phiên bản từ chối:</strong> #{revisionNumber}
              </div>
              <div>
                <strong>Mã băm nội dung:</strong> <code>{contentHashHex.slice(0, 16)}...</code>
              </div>
            </div>

            {(error || validationError) && (
              <div role="alert" className="alert alert-danger p-2 mb-3 text-sm rounded">
                {validationError || error}
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="reject-reason" className="form-label text-sm font-weight-bold">
                Lý do từ chối <span className="text-danger">*</span> (Tối đa 2000 ký tự)
              </label>
              <textarea
                id="reject-reason"
                className="form-control text-sm"
                rows={3}
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isSubmitting}
                placeholder="Ví dụ: Kịch bản không phù hợp với định vị sản phẩm hoặc vi phạm chính sách của nhà bán lẻ..."
              />
              <div className="d-flex justify-content-end text-xs text-muted mt-1">
                {reason.length} / 2000
              </div>
            </div>
          </div>

          <div className="modal-footer d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Hủy
            </button>
            <button type="submit" className="btn btn-sm btn-danger" disabled={isSubmitting}>
              {isSubmitting ? 'Đang ghi nhận từ chối...' : 'Xác nhận từ chối'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
