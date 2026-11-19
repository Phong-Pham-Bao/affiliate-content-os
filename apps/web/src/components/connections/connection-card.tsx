import { useState, type ReactElement } from 'react';
import type { SocialAccountDTO } from '../../types/social.js';
import { ConnectionCapabilitiesBadge, ConnectionStatusBadge } from './connection-status-badge.js';
import { DisconnectDialog } from './disconnect-dialog.js';

interface ConnectionCardProps {
  readonly account: SocialAccountDTO;
  readonly isOwner?: boolean | undefined;
  readonly onReconnect?: ((account: SocialAccountDTO) => void) | undefined;
  readonly onRefresh?: ((account: SocialAccountDTO) => Promise<void>) | undefined;
  readonly onDisconnect?: ((account: SocialAccountDTO) => Promise<void>) | undefined;
}

export function ConnectionCard({
  account,
  isOwner = false,
  onReconnect,
  onRefresh,
  onDisconnect,
}: ConnectionCardProps): ReactElement {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isLocal =
    account.environment === 'local' ||
    account.environment === 'sandbox' ||
    account.environment === 'test';

  const isDisconnected = account.status === 'disconnected';
  const allowed = new Set(account.allowedActions ?? ['reconnect', 'refresh', 'disconnect']);

  const handleRefreshClick = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh(account);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!onDisconnect || isDisconnecting) return;
    setIsDisconnecting(true);
    try {
      await onDisconnect(account);
      setIsDisconnectDialogOpen(false);
    } finally {
      setIsDisconnecting(false);
    }
  };

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

      {account.statusReason && (
        <div
          style={{
            fontSize: '0.75rem',
            padding: '0.375rem 0.5rem',
            borderRadius: '4px',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
          }}
        >
          Lý do: {account.statusReason}
        </div>
      )}

      <div>
        <span style={{ fontSize: '0.75rem', color: '#4b5563', fontWeight: 500 }}>
          Khả năng xuất bản (Capabilities):
        </span>
        <ConnectionCapabilitiesBadge capabilities={account.capabilities} />
      </div>

      {account.tokenExpiresAt && !isDisconnected && (
        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
          Hết hạn token: {new Date(account.tokenExpiresAt).toLocaleDateString()}
        </div>
      )}

      {isOwner && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {allowed.has('refresh') && !isDisconnected && (
            <button
              type="button"
              disabled={isRefreshing}
              onClick={() => void handleRefreshClick()}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                color: '#374151',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
              }}
            >
              {isRefreshing ? 'Đang làm mới...' : 'Làm mới'}
            </button>
          )}

          {allowed.has('reconnect') && (
            <button
              type="button"
              onClick={() => onReconnect?.(account)}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '4px',
                border: '1px solid #2563eb',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Kết nối lại
            </button>
          )}

          {allowed.has('disconnect') && !isDisconnected && (
            <button
              type="button"
              onClick={() => setIsDisconnectDialogOpen(true)}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '4px',
                border: '1px solid #dc2626',
                backgroundColor: '#ffffff',
                color: '#dc2626',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              Ngắt kết nối
            </button>
          )}
        </div>
      )}

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

      <DisconnectDialog
        account={account}
        isOpen={isDisconnectDialogOpen}
        isDisconnecting={isDisconnecting}
        onConfirm={() => void handleConfirmDisconnect()}
        onCancel={() => setIsDisconnectDialogOpen(false)}
      />
    </div>
  );
}
