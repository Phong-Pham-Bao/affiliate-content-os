'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SocialAccountDTO, SocialPlatform } from '../../types/social.js';
import {
  beginSocialAuthorize,
  fetchCallbackResult,
  fetchSocialAccounts,
} from '../../lib/social-api-client.js';
import { ConnectionCard } from './connection-card.js';

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
  const [callbackBanner, setCallbackBanner] = useState<{
    readonly status: 'success' | 'failed';
    readonly message: string;
  } | null>(null);

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

  // 1. Process connection_result landing parameter if present in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultKey = params.get('connection_result');

    if (resultKey) {
      // Clear URL parameter immediately to prevent duplicate consumption
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            Tài khoản mạng xã hội (Social Connections)
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
            Kết nối các kênh phân phối để chuẩn bị xuất bản nội dung.
          </p>
        </div>

        {isOwner ? (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void handleConnect('threads')}
              className="btn-connect-threads"
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid #000000',
                backgroundColor: '#000000',
                color: '#ffffff',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '0.875rem',
                opacity: isConnecting ? 0.7 : 1,
              }}
            >
              + Kết nối Threads
            </button>
            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void handleConnect('tiktok')}
              className="btn-connect-tiktok"
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid #fe2c55',
                backgroundColor: '#fe2c55',
                color: '#ffffff',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: '0.875rem',
                opacity: isConnecting ? 0.7 : 1,
              }}
            >
              + Kết nối TikTok
            </button>
          </div>
        ) : (
          <span style={{ fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic' }}>
            Chỉ Chủ sở hữu (Owner) mới có quyền kết nối tài khoản mới.
          </span>
        )}
      </div>

      {callbackBanner && (
        <div
          role={callbackBanner.status === 'success' ? 'status' : 'alert'}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            backgroundColor: callbackBanner.status === 'success' ? '#dcfce7' : '#fee2e2',
            color: callbackBanner.status === 'success' ? '#166534' : '#991b1b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{callbackBanner.message}</span>
          <button
            type="button"
            onClick={() => setCallbackBanner(null)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadAccounts()}
            style={{
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
              border: '1px solid #b91c1c',
              backgroundColor: '#ffffff',
              color: '#b91c1c',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Thử lại
          </button>
        </div>
      )}

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
            <ConnectionCard key={acc.id} account={acc} />
          ))}
        </div>
      )}
    </section>
  );
}
