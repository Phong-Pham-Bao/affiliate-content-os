import type { ReactElement } from 'react';
import type { SocialPlatform } from '../../types/social.js';

interface ConnectionsHeaderProps {
  readonly isOwner: boolean;
  readonly isConnecting: boolean;
  readonly onConnect: (platform: SocialPlatform) => void;
}

export function ConnectionsHeader({
  isOwner,
  isConnecting,
  onConnect,
}: ConnectionsHeaderProps): ReactElement {
  return (
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
            onClick={() => onConnect('threads')}
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
            onClick={() => onConnect('tiktok')}
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
  );
}
