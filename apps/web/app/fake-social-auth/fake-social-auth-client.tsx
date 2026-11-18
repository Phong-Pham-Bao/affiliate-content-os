'use client';

import { type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';

function isValidCallbackUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri, window.location.origin);
    if (url.origin !== window.location.origin) return false;
    return /^\/api\/v1\/social-connections\/(threads|tiktok)\/callback$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function FakeSocialAuthClient(): ReactElement {
  const searchParams = useSearchParams();
  const platform = searchParams.get('platform') ?? 'unknown';
  const state = searchParams.get('state');
  const redirectUri = searchParams.get('redirect_uri');
  const scopes = searchParams.get('scopes') ?? '';
  const mockEnv = searchParams.get('mock_env') ?? 'local';

  if (!state || !redirectUri) {
    return (
      <div
        className="fake-auth-container"
        style={{ padding: '2rem', maxWidth: '600px', margin: '2rem auto' }}
      >
        <div
          role="alert"
          className="error-banner"
          style={{ padding: '1rem', border: '1px solid #ef4444', borderRadius: '8px' }}
        >
          <h2>Yêu cầu không hợp lệ (Invalid OAuth Request)</h2>
          <p>
            Thiếu tham số bắt buộc <code>state</code> hoặc <code>redirect_uri</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!isValidCallbackUri(redirectUri)) {
    return (
      <div
        className="fake-auth-container"
        style={{ padding: '2rem', maxWidth: '600px', margin: '2rem auto' }}
      >
        <div
          role="alert"
          className="error-banner"
          style={{ padding: '1rem', border: '1px solid #ef4444', borderRadius: '8px' }}
        >
          <h2>Địa chỉ chuyển hướng không hợp lệ (Invalid Redirect Target)</h2>
          <p>
            Tham số <code>redirect_uri</code> phải là đường dẫn callback nội bộ hợp lệ của hệ thống.
          </p>
        </div>
      </div>
    );
  }

  const handleAuthorize = () => {
    const fakeCode = `fake_auth_code_${Date.now()}`;
    const targetUrl = new URL(redirectUri, window.location.origin);
    targetUrl.searchParams.set('state', state);
    targetUrl.searchParams.set('code', fakeCode);
    window.location.href = targetUrl.toString();
  };

  const handleDeny = () => {
    const targetUrl = new URL(redirectUri, window.location.origin);
    targetUrl.searchParams.set('state', state);
    targetUrl.searchParams.set('error', 'access_denied');
    targetUrl.searchParams.set('error_description', 'User denied connection in mock provider');
    window.location.href = targetUrl.toString();
  };

  return (
    <div
      className="fake-auth-card"
      style={{
        padding: '2rem',
        maxWidth: '560px',
        margin: '3rem auto',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#ffffff',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
          Xác thực thử nghiệm (Fake OAuth Provider)
        </h1>
        <span
          style={{
            padding: '0.25rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            backgroundColor: '#fef3c7',
            color: '#92400e',
          }}
        >
          {mockEnv.toUpperCase()}
        </span>
      </div>

      <p style={{ color: '#4b5563', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Đây là màn hình giả lập nhà cung cấp mạng xã hội dành cho môi trường thử nghiệm. Không có
        cuộc gọi thật nào ra ngoài Threads hoặc TikTok.
      </p>

      <div
        style={{
          padding: '1rem',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          fontSize: '0.875rem',
        }}
      >
        <div style={{ marginBottom: '0.5rem' }}>
          <strong>Nền tảng (Platform):</strong>{' '}
          <span style={{ textTransform: 'capitalize' }}>{platform}</span>
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <strong>Quyền yêu cầu (Scopes):</strong> <code>{scopes || 'none'}</code>
        </div>
        <div>
          <strong>State preview:</strong> <code>{state.slice(0, 12)}...</code>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleDeny}
          style={{
            padding: '0.625rem 1.25rem',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            backgroundColor: '#ffffff',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Từ chối (Deny)
        </button>
        <button
          type="button"
          onClick={handleAuthorize}
          style={{
            padding: '0.625rem 1.25rem',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Chấp thuận kết nối (Authorize)
        </button>
      </div>
    </div>
  );
}
