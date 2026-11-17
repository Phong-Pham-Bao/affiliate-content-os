'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useEscapeKey } from '../../../lib/use-escape-key.js';
import type { ComplianceFindingDTO } from '../../../types/compliance.js';

interface ContentStudioAcceptDialogProps {
  readonly isOpen: boolean;
  readonly revisionNumber: number;
  readonly contentHashHex: string;
  readonly warnings: readonly ComplianceFindingDTO[];
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onConfirm: (note?: string) => Promise<void>;
  readonly onClose: () => void;
}

export function ContentStudioAcceptDialog({
  isOpen,
  revisionNumber,
  contentHashHex,
  warnings,
  isSubmitting,
  error,
  onConfirm,
  onClose,
}: ContentStudioAcceptDialogProps): ReactElement | null {
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEscapeKey(onClose, isSubmitting, isOpen);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const trimmed = note.trim();
    if (trimmed.length > 500) {
      setValidationError('Ghi chú phê duyệt không được vượt quá 500 ký tự.');
      return;
    }

    await onConfirm(trimmed.length > 0 ? trimmed : undefined);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="accept-dialog-title"
        className="modal-content content-studio-accept-modal"
      >
        <div className="modal-header">
          <h4 id="accept-dialog-title" className="modal-title text-success">
            Xác nhận chấp thuận kịch bản (Human Approval)
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
              Bạn đang thực hiện quyền phê duyệt kịch bản với tư cách con người có thẩm quyền. Thao
              tác này sẽ ghi lại một snapshot phê duyệt bất biến và hoàn tất công đoạn chuyển giao
              (handoff), nhưng <strong>không</strong> tự động đăng tải lên mạng xã hội.
            </p>

            <div className="text-xs text-muted mb-3 p-2 bg-light rounded">
              <div>
                <strong>Phiên bản phê duyệt:</strong> #{revisionNumber}
              </div>
              <div>
                <strong>Mã băm nội dung:</strong> <code>{contentHashHex.slice(0, 16)}...</code>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="alert alert-warning py-2 px-3 text-sm mb-3">
                <strong className="d-block mb-1">Cảnh báo tư vấn AI ({warnings.length}):</strong>
                <ul className="mb-0 ps-3">
                  {warnings.slice(0, 3).map((w) => (
                    <li key={w.id}>
                      <span className="font-monospace text-xs">[{w.ruleId}]</span> {w.message}
                    </li>
                  ))}
                  {warnings.length > 3 && (
                    <li>...và {warnings.length - 3} cảnh báo tư vấn khác.</li>
                  )}
                </ul>
                <div className="text-xs text-muted mt-1">
                  Các cảnh báo trên không ngăn cản bạn phê duyệt, nhưng bạn nên lưu ý trước khi sản
                  xuất video.
                </div>
              </div>
            )}

            {(error || validationError) && (
              <div role="alert" className="alert alert-danger p-2 mb-3 text-sm rounded">
                {validationError || error}
              </div>
            )}

            <div className="mb-3">
              <label htmlFor="accept-note" className="form-label text-sm font-weight-bold">
                Ghi chú phê duyệt (Tùy chọn, tối đa 500 ký tự)
              </label>
              <textarea
                id="accept-note"
                className="form-control text-sm"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isSubmitting}
                placeholder="Ví dụ: Đã kiểm tra lại thông tin khuyến mãi và tỷ lệ chuyển đổi tốt..."
              />
              <div className="d-flex justify-content-end text-xs text-muted mt-1">
                {note.length} / 500
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
            <button type="submit" className="btn btn-sm btn-success" disabled={isSubmitting}>
              {isSubmitting ? 'Đang ghi nhận phê duyệt...' : 'Xác nhận chấp thuận'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
