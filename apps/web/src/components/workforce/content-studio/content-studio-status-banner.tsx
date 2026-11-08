'use client';

import type { ReactElement } from 'react';

export type ContentStudioStatusState =
  | 'idle'
  | 'preparing'
  | 'queued'
  | 'running'
  | 'partial_success'
  | 'retry_wait'
  | 'failed'
  | 'assembling'
  | 'ready'
  | 'stale_conflict'
  | 'insufficient_budget'
  | 'provider_outage'
  | 'polling_deadline';

interface ContentStudioStatusBannerProps {
  readonly status: ContentStudioStatusState;
  readonly message?: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly onResume?: (() => void) | undefined;
}

const STATUS_CONFIGS: Record<
  ContentStudioStatusState,
  { label: string; alertClass: string; desc: string }
> = {
  idle: {
    label: 'Sẵn sàng',
    alertClass: 'alert-secondary',
    desc: 'Không có tác vụ nào đang chạy.',
  },
  preparing: {
    label: 'Đang chuẩn bị',
    alertClass: 'alert-info',
    desc: 'Hệ thống đang tổng hợp bản định hướng nội dung (Content Brief) từ các tài liệu lập kế hoạch.',
  },
  queued: {
    label: 'Đang chờ xử lý',
    alertClass: 'alert-info',
    desc: 'Các đơn vị tạo kịch bản 5 video đang nằm trong hàng đợi xử lý.',
  },
  running: {
    label: 'Đang thực thi',
    alertClass: 'alert-primary',
    desc: 'Biên kịch AI đang tạo kịch bản cho các video (tối đa 3 cuộc gọi đồng thời).',
  },
  partial_success: {
    label: 'Hoàn thành một phần',
    alertClass: 'alert-warning',
    desc: 'Một số video đã tạo thành công, các video còn lại có thể thử lại mà không phải tạo lại từ đầu.',
  },
  retry_wait: {
    label: 'Chờ thử lại',
    alertClass: 'alert-warning',
    desc: 'Đang chờ thử lại sau sự cố tạm thời của nhà cung cấp AI.',
  },
  failed: {
    label: 'Thất bại',
    alertClass: 'alert-danger',
    desc: 'Tác vụ tạo kịch bản gặp lỗi và đã dừng lại.',
  },
  assembling: {
    label: 'Đang ghép gói kịch bản',
    alertClass: 'alert-info',
    desc: 'Tất cả 5 video đã thành công, đang ghép thành gói kịch bản hoàn chỉnh.',
  },
  ready: {
    label: 'Hoàn tất',
    alertClass: 'alert-success',
    desc: 'Gói kịch bản 5 video đã được lắp ráp và sẵn sàng duyệt.',
  },
  stale_conflict: {
    label: 'Xung đột phiên bản',
    alertClass: 'alert-danger',
    desc: 'Dữ liệu của bạn không khớp với phiên bản mới nhất trên máy chủ. Vui lòng tải lại trang.',
  },
  insufficient_budget: {
    label: 'Ngân sách không đủ',
    alertClass: 'alert-danger',
    desc: 'Không đủ ngân sách khả dụng để thực thi hoặc tái tạo kịch bản.',
  },
  provider_outage: {
    label: 'Sự cố nhà cung cấp',
    alertClass: 'alert-danger',
    desc: 'Dịch vụ AI hiện không phản hồi. Vui lòng thử lại sau.',
  },
  polling_deadline: {
    label: 'Chờ phản hồi quá thời gian',
    alertClass: 'alert-warning',
    desc: 'Yêu cầu thay đổi đang được máy chủ tiếp tục xử lý nhưng đã vượt quá thời gian theo dõi liên tục. Bạn có thể tiếp tục kiểm tra trạng thái.',
  },
};

export function ContentStudioStatusBanner({
  status,
  message,
  onRetry,
  onResume,
}: ContentStudioStatusBannerProps): ReactElement | null {
  if (status === 'idle') return null;

  const config = STATUS_CONFIGS[status] ?? STATUS_CONFIGS.idle;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`content-studio-status-banner alert ${config.alertClass} p-3 mb-4 rounded d-flex justify-content-between align-items-center flex-wrap gap-2`}
    >
      <div>
        <strong>{config.label}:</strong> {message || config.desc}
      </div>
      <div className="d-flex align-items-center gap-2">
        {onResume && (status === 'polling_deadline' || status === 'failed') && (
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={onResume}>
            Tiếp tục kiểm tra
          </button>
        )}
        {onRetry && (status === 'failed' || status === 'partial_success') && (
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>
            Thử lại tác vụ
          </button>
        )}
      </div>
    </div>
  );
}
