'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import type { SocialAccountDTO } from '../../types/social.js';

interface DisconnectDialogProps {
  readonly account: SocialAccountDTO;
  readonly isOpen: boolean;
  readonly isDisconnecting: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function DisconnectDialog({
  account,
  isOpen,
  isDisconnecting,
  onConfirm,
  onCancel,
}: DisconnectDialogProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null;
      cancelButtonRef.current?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !isDisconnecting) {
          onCancel();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        previousActiveElement.current?.focus();
      };
    }
    return undefined;
  }, [isOpen, isDisconnecting, onCancel]);

  if (!isOpen) return null;

  const isThreads = account.platform === 'threads';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-dialog-title"
        aria-describedby="disconnect-dialog-description"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '480px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        <h3
          id="disconnect-dialog-title"
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            margin: '0 0 0.5rem 0',
            color: '#111827',
          }}
        >
          Ngắt kết nối {account.displayName} ({account.platform.toUpperCase()})
        </h3>

        <div id="disconnect-dialog-description" style={{ fontSize: '0.875rem', color: '#4b5563' }}>
          <p style={{ margin: '0 0 0.75rem 0' }}>
            Bạn có chắc chắn muốn ngắt kết nối tài khoản này? Quyền xuất bản nội dung sẽ bị hủy và
            toàn bộ khóa xác thực cục bộ sẽ bị xóa vĩnh viễn.
          </p>

          {isThreads && (
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '6px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1e40af',
                fontSize: '0.8125rem',
                marginBottom: '1rem',
              }}
            >
              <strong>Lưu ý về Threads:</strong> Meta Threads không hỗ trợ thu hồi token từ xa qua
              API. Thao tác này sẽ xóa an toàn phiên kết nối trong Affiliate Content OS. Để gỡ bỏ
              quyền hoàn toàn khỏi tài khoản Threads của bạn, vui lòng truy cập{' '}
              <em>Cài đặt Threads &gt; Trang web và ứng dụng được phê duyệt</em>.
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            marginTop: '1.25rem',
          }}
        >
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={isDisconnecting}
            onClick={onCancel}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              backgroundColor: '#ffffff',
              color: '#374151',
              cursor: isDisconnecting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              fontSize: '0.875rem',
            }}
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            disabled={isDisconnecting}
            onClick={onConfirm}
            className="btn-confirm-disconnect"
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid #dc2626',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              cursor: isDisconnecting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              fontSize: '0.875rem',
              opacity: isDisconnecting ? 0.7 : 1,
            }}
          >
            {isDisconnecting ? 'Đang ngắt kết nối...' : 'Xác nhận ngắt kết nối'}
          </button>
        </div>
      </div>
    </div>
  );
}
