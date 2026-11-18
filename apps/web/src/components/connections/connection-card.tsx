import type { ReactElement } from 'react';
import type { SocialAccountDTO } from '../../types/social.js';
import { ConnectionCapabilitiesBadge, ConnectionStatusBadge } from './connection-status-badge.js';

interface ConnectionCardProps {
  readonly account: SocialAccountDTO;
}

export function ConnectionCard({ account }: ConnectionCardProps): ReactElement {
  const isLocal = account.environment === 'local' || account.environment === 'sandbox';

  return (
    <div
      className="connection-card"
      style={{
        padding: '1.25rem',
        borderRadius: '8px',
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                textTransform: 'uppercase',
                fontWeight: 700,
                fontSize: '0.75rem',
                color: '#6b7280',
              }}
            >
              {account.platform}
            </span>
            {isLocal && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '0.1rem 0.375rem',
                  borderRadius: '9999px',
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                  fontWeight: 600,
                }}
              >
                Local/Test
              </span>
            )}
          </div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0.25rem 0 0 0' }}>
            {account.displayName}
          </h3>
          {account.handle && (
            <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.1rem 0 0 0' }}>
              {account.handle}
            </p>
          )}
        </div>
        <ConnectionStatusBadge status={account.status} />
      </div>

      <div>
        <span style={{ fontSize: '0.75rem', color: '#4b5563', fontWeight: 500 }}>
          Khả năng xuất bản (Capabilities):
        </span>
        <ConnectionCapabilitiesBadge capabilities={account.capabilities} />
      </div>

      <div
        style={{
          marginTop: 'auto',
          paddingTop: '0.75rem',
          borderTop: '1px solid #f3f4f6',
          fontSize: '0.75rem',
          color: '#9ca3af',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Kết nối: {new Date(account.createdAt).toLocaleDateString()}</span>
        <span>v{account.version}</span>
      </div>
    </div>
  );
}
