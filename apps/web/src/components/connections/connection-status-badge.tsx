import type { ReactElement } from 'react';
import type { SocialAccountCapabilities, SocialAccountStatus } from '../../types/social.js';

interface ConnectionStatusBadgeProps {
  readonly status: SocialAccountStatus;
}

export function ConnectionStatusBadge({ status }: ConnectionStatusBadgeProps): ReactElement {
  const configs: Record<SocialAccountStatus, { label: string; bg: string; color: string }> = {
    connecting: { label: 'Đang kết nối (Connecting)', bg: '#f3f4f6', color: '#4b5563' },
    active: { label: 'Đang hoạt động (Active)', bg: '#dcfce7', color: '#15803d' },
    degraded: { label: 'Bị giới hạn (Degraded)', bg: '#fef3c7', color: '#b45309' },
    reauth_required: {
      label: 'Cần xác thực lại (Reauth Required)',
      bg: '#ffe4e6',
      color: '#be123c',
    },
    review_gated: { label: 'Đang xét duyệt (Review Gated)', bg: '#e0e7ff', color: '#4338ca' },
    disconnected: { label: 'Đã ngắt kết nối (Disconnected)', bg: '#f1f5f9', color: '#475569' },
  };

  const config = configs[status] ?? configs.active;

  return (
    <span
      className={`status-badge status-badge-${status}`}
      style={{
        display: 'inline-block',
        padding: '0.2rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: config.bg,
        color: config.color,
      }}
    >
      {config.label}
    </span>
  );
}

export function ConnectionCapabilitiesBadge({
  capabilities,
}: {
  readonly capabilities: SocialAccountCapabilities;
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
      {capabilities.canPublishText && (
        <span
          style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.375rem',
            borderRadius: '4px',
            backgroundColor: '#f3f4f6',
            color: '#374151',
          }}
        >
          Văn bản
        </span>
      )}
      {capabilities.canPublishMedia && (
        <span
          style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.375rem',
            borderRadius: '4px',
            backgroundColor: '#f3f4f6',
            color: '#374151',
          }}
        >
          Hình/Video
        </span>
      )}
      {capabilities.isBusinessAccount && (
        <span
          style={{
            fontSize: '0.7rem',
            padding: '0.1rem 0.375rem',
            borderRadius: '4px',
            backgroundColor: '#f3f4f6',
            color: '#374151',
          }}
        >
          Doanh nghiệp
        </span>
      )}
    </div>
  );
}
