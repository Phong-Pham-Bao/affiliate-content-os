'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SocialAccountDTO, SocialPlatform } from '../../types/social.js';
import {
  beginSocialAuthorize,
  beginSocialReconnect,
  disconnectSocialAccount,
  fetchCallbackResult,
  fetchSocialAccounts,
  refreshSocialAccount,
} from '../../lib/social-api-client.js';
import { ConnectionCard } from './connection-card.js';
import { ConnectionsBanner, type CallbackBannerState } from './connections-banner.js';
import { ConnectionsHeader } from './connections-header.js';

interface ConnectionsPanelProps {
  readonly workspaceId: string;
  readonly userRole: 'owner' | 'editor' | 'viewer';
}

export function ConnectionsPanel({ workspaceId, userRole }: ConnectionsPanelProps): ReactElement {
  const isOwner = userRole === 'owner';

  const [accounts, setAccounts] = useState<readonly SocialAccountDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [callbackBanner, setCallbackBanner] = useState<CallbackBannerState | null>(null);

  const loadAccounts = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      try {
        const items = await fetchSocialAccounts(workspaceId, signal);
        setAccounts(items);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg =
          err instanceof Error ? err.message : 'Không thể tải danh sách kết nối mạng xã hội.';
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultKey = params.get('connection_result');

    if (resultKey) {
      const nextUrl = window.location.pathname;
      window.history.replaceState({}, document.title, nextUrl);

      void (async () => {
        try {
          const result = await fetchCallbackResult(workspaceId, resultKey);
          if (result.status === 'success') {
            setCallbackBanner({
              status: 'success',
              message: `Kết nối tài khoản ${result.platform.toUpperCase()} thành công!`,
            });
          } else if (result.status === 'partial') {
            setCallbackBanner({
              status: 'partial',
              message: `Kết nối tài khoản ${result.platform.toUpperCase()} với quyền hạn giới hạn. Cần xác thực thêm để mở khóa toàn bộ tính năng.`,
            });
          } else {
            setCallbackBanner({
              status: 'failed',
              message: `Kết nối thất bại: ${result.errorDescription ?? result.errorCode ?? 'Lỗi không xác định'}`,
            });
          }
        } catch {
          setCallbackBanner({
            status: 'failed',
            message: 'Không thể xác nhận kết quả kết nối hoặc kết quả đã hết hạn.',
          });
        }
        void loadAccounts();
      })();
    } else {
      void loadAccounts();
    }
  }, [workspaceId, loadAccounts]);

  const handleConnect = async (platform: SocialPlatform) => {
    if (!isOwner) return;
    setIsConnecting(true);
    setError(null);
    try {
      const { authorizationUrl } = await beginSocialAuthorize(
        workspaceId,
        platform,
        window.location.pathname,
      );
      window.location.href = authorizationUrl;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể bắt đầu kết nối OAuth.';
      setError(msg);
      setIsConnecting(false);
    }
  };

  const handleReconnect = async (account: SocialAccountDTO) => {
    if (!isOwner) return;
    setError(null);
    try {
      const { authorizationUrl } = await beginSocialReconnect(
        workspaceId,
        account.id,
        window.location.pathname,
      );
      window.location.href = authorizationUrl;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể bắt đầu kết nối lại.';
      setError(msg);
    }
  };

  const handleRefresh = async (account: SocialAccountDTO) => {
    if (!isOwner) return;
    try {
      const updated = await refreshSocialAccount(workspaceId, account.id);
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setCallbackBanner({
        status: 'success',
        message: `Đã làm mới thông tin tài khoản ${updated.displayName} thành công.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Làm mới tài khoản thất bại.';
      setError(msg);
    }
  };

  const handleDisconnect = async (account: SocialAccountDTO) => {
    if (!isOwner) return;
    try {
      const updated = await disconnectSocialAccount(workspaceId, account.id, account.version);
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setCallbackBanner({
        status: 'success',
        message: `Đã ngắt kết nối tài khoản ${updated.displayName} khỏi hệ thống.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ngắt kết nối tài khoản thất bại.';
      setError(msg);
    }
  };

  return (
    <section
      role="region"
      aria-label="Quản lý kết nối mạng xã hội"
      className="connections-panel"
      style={{
        marginTop: '1.5rem',
        padding: '1.5rem',
        borderRadius: '12px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
      }}
    >
      <ConnectionsHeader
        isOwner={isOwner}
        isConnecting={isConnecting}
        onConnect={(p) => void handleConnect(p)}
      />

      <ConnectionsBanner
        banner={callbackBanner}
        error={error}
        onDismissBanner={() => setCallbackBanner(null)}
        onRetry={() => void loadAccounts()}
      />

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}
        >
          Đang tải danh sách tài khoản kết nối...
        </div>
      ) : accounts.length === 0 ? (
        <div
          style={{
            padding: '2.5rem',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px dashed #d1d5db',
            color: '#6b7280',
          }}
        >
          <p style={{ margin: 0, fontWeight: 500 }}>
            Chưa có tài khoản mạng xã hội nào được kết nối.
          </p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            {isOwner
              ? 'Nhấn nút "Kết nối Threads" hoặc "Kết nối TikTok" ở trên để bắt đầu.'
              : 'Hãy liên hệ Chủ sở hữu Workspace để kết nối tài khoản.'}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {accounts.map((acc) => (
            <ConnectionCard
              key={acc.id}
              account={acc}
              isOwner={isOwner}
              onReconnect={(a) => void handleReconnect(a)}
              onRefresh={(a) => handleRefresh(a)}
              onDisconnect={(a) => handleDisconnect(a)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
