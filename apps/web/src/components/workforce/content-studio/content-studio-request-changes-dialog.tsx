'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useEscapeKey } from '../../../lib/use-escape-key.js';

interface ContentStudioRequestChangesDialogProps {
  readonly isOpen: boolean;
  readonly baseRevisionNumber: number;
  readonly baseContentHashHex: string;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onSubmit: (
    selectedVideos: (1 | 2 | 3 | 4 | 5)[],
    instruction: string,
    variants: number,
  ) => Promise<void>;
  readonly onClose: () => void;
}

export function ContentStudioRequestChangesDialog({
  isOpen,
  baseRevisionNumber,
  baseContentHashHex,
  isSubmitting,
  error,
  onSubmit,
  onClose,
}: ContentStudioRequestChangesDialogProps): ReactElement | null {
  const [selectedVideos, setSelectedVideos] = useState<(1 | 2 | 3 | 4 | 5)[]>([1]);
  const [instruction, setInstruction] = useState('');
  const [variants, setVariants] = useState<number>(1);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEscapeKey(onClose, isSubmitting, isOpen);

  if (!isOpen) return null;

  const toggleVideo = (num: 1 | 2 | 3 | 4 | 5) => {
    setSelectedVideos((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num].sort((a, b) => a - b),
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (selectedVideos.length === 0) {
      setValidationError('Vui lòng chọn ít nhất một video để yêu cầu thay đổi.');
      return;
    }

    const trimmed = instruction.trim();
    if (trimmed.length === 0) {
      setValidationError('Vui lòng nhập hướng dẫn yêu cầu thay đổi.');
      return;
    }
    if (trimmed.length > 2000) {
      setValidationError('Hướng dẫn không được vượt quá 2000 ký tự.');
      return;
    }

    await onSubmit(selectedVideos, trimmed, variants);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="req-changes-title"
        className="modal-content content-studio-request-changes-modal"
      >
        <div className="modal-header">
          <h4 id="req-changes-title" className="modal-title">
            Yêu cầu thay đổi kịch bản (AI Request Changes)
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
              Chọn các video cần AI tạo lại và nhập hướng dẫn chi tiết. Tác vụ sẽ chỉ tạo lại các
              video được chọn mà không ảnh hưởng tới các video còn lại.
            </p>

            <div className="text-xs text-muted mb-3 p-2 bg-light rounded">
              <strong>Tiền điều kiện:</strong> Phiên bản cơ sở #{baseRevisionNumber} (Mã băm:{' '}
              <code>{baseContentHashHex.slice(0, 8)}...</code>)
            </div>

            {(error || validationError) && (
              <div role="alert" className="alert alert-danger p-2 mb-3 text-sm rounded">
                {validationError || error}
              </div>
            )}

            <div className="mb-3">
              <label className="form-label text-sm font-weight-bold d-block">
                Chọn video cần thay đổi (1 &ndash; 5)
              </label>
              <div className="d-flex gap-3 flex-wrap">
                {([1, 2, 3, 4, 5] as const).map((num) => (
                  <label
                    key={num}
                    className="form-check-label d-flex align-items-center gap-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={selectedVideos.includes(num)}
                      onChange={() => toggleVideo(num)}
                      disabled={isSubmitting}
                    />
                    Video {num}
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="req-instruction" className="form-label text-sm font-weight-bold">
                Hướng dẫn chỉnh sửa cho AI (Tối đa 2.000 ký tự)
              </label>
              <textarea
                id="req-instruction"
                rows={4}
                className="form-control form-control-sm"
                placeholder="Ví dụ: Thay đổi hook mở đầu sang câu hỏi giật gân hơn, tập trung vào vấn đề đau lưng khi ngồi lâu..."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={2000}
                required
                disabled={isSubmitting}
              />
              <div className="text-end text-xs text-muted mt-1">
                {instruction.length} / 2.000 ký tự
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="req-variants" className="form-label text-sm font-weight-bold">
                Số lượng biến thể mong muốn (1 &ndash; 3)
              </label>
              <select
                id="req-variants"
                className="form-select form-select-sm"
                value={variants}
                onChange={(e) => setVariants(Number(e.target.value))}
                disabled={isSubmitting}
              >
                <option value={1}>1 biến thể chính (Mặc định)</option>
                <option value={2}>2 biến thể</option>
                <option value={3}>3 biến thể (Tối đa)</option>
              </select>
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Hủy bỏ
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Đang gửi yêu cầu tới AI...' : 'Gửi yêu cầu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
