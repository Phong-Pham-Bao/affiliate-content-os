import type { ReactElement } from 'react';

export interface CallbackBannerState {
  readonly status: 'success' | 'failed';
  readonly message: string;
}

interface ConnectionsBannerProps {
  readonly banner: CallbackBannerState | null;
  readonly error: string | null;
  readonly onDismissBanner: () => void;
  readonly onRetry: () => void;
}

export function ConnectionsBanner({
  banner,
  error,
  onDismissBanner,
  onRetry,
}: ConnectionsBannerProps): ReactElement | null {
  return (
    <>
      {banner && (
        <div
          role={banner.status === 'success' ? 'status' : 'alert'}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            backgroundColor: banner.status === 'success' ? '#dcfce7' : '#fee2e2',
            color: banner.status === 'success' ? '#166534' : '#991b1b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={onDismissBanner}
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
            onClick={onRetry}
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
    </>
  );
}
