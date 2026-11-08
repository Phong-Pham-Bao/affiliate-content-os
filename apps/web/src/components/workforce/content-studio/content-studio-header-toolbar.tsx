'use client';

import type { ReactElement } from 'react';

interface ContentStudioHeaderToolbarProps {
  readonly seriesTitle: string;
  readonly canManage: boolean;
  readonly isEditing: boolean;
  readonly isComparing: boolean;
  readonly isHistoryOpen: boolean;
  readonly onToggleHistory: () => void;
  readonly onStartEdit: () => void;
  readonly onOpenRequestChanges: () => void;
  readonly onClose?: (() => void) | undefined;
}

export function ContentStudioHeaderToolbar({
  seriesTitle,
  canManage,
  isEditing,
  isComparing,
  isHistoryOpen,
  onToggleHistory,
  onStartEdit,
  onOpenRequestChanges,
  onClose,
}: ContentStudioHeaderToolbarProps): ReactElement {
  return (
    <header className="content-studio-header-toolbar d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom flex-wrap gap-2">
      <div>
        <h3 className="mb-1 text-primary">
          Content Studio &bull; {seriesTitle || 'Gói kịch bản 5 video'}
        </h3>
        <p className="text-muted text-xs mb-0">
          Xưởng nội dung thương mại: duyệt kịch bản, lời thoại tiếng Việt, phân cảnh, lớp phủ và
          lịch sử phiên bản.
        </p>
      </div>

      <div className="d-flex align-items-center gap-2 flex-wrap">
        <button
          type="button"
          className={`btn btn-sm ${isHistoryOpen ? 'btn-info' : 'btn-outline-info'}`}
          onClick={onToggleHistory}
          aria-expanded={isHistoryOpen}
          aria-label="Xem lịch sử phiên bản"
        >
          Lịch sử phiên bản
        </button>

        {canManage && !isEditing && !isComparing && (
          <>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={onStartEdit}
              aria-label="Chỉnh sửa thủ công kịch bản"
            >
              Chỉnh sửa thủ công
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={onOpenRequestChanges}
              aria-label="Yêu cầu AI thay đổi kịch bản"
            >
              Yêu cầu AI viết lại
            </button>
          </>
        )}

        {onClose && (
          <button
            type="button"
            className="btn btn-sm btn-secondary ms-2"
            onClick={onClose}
            aria-label="Đóng Content Studio"
          >
            Đóng
          </button>
        )}
      </div>
    </header>
  );
}
