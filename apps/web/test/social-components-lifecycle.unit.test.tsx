import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SocialAccountDTO } from '../src/types/social.js';
import { ConnectionCard } from '../src/components/connections/connection-card.js';
import { ConnectionsBanner } from '../src/components/connections/connections-banner.js';
import { DisconnectDialog } from '../src/components/connections/disconnect-dialog.js';

describe('Social Connections Lifecycle Components Rendering', () => {
  const baseAccount: SocialAccountDTO = {
    id: '018f6c5b-21a4-789a-8def-000000000010',
    workspaceId: '018f6c5b-21a4-789a-8def-000000000001',
    platform: 'threads',
    providerAccountId: 'threads_user_1',
    displayName: 'Affiliate Pro Official',
    handle: 'affiliate_pro',
    status: 'active',
    statusReason: null,
    grantedScopes: ['threads_basic', 'threads_content_publish'],
    capabilities: {
      canPublishText: true,
      canPublishMedia: true,
      isBusinessAccount: true,
    },
    capabilitiesCheckedAt: '2026-11-18T10:00:00.000Z',
    tokenExpiresAt: '2026-12-01T00:00:00.000Z',
    reauthRequiredAt: null,
    lastRefreshedAt: '2026-11-18T10:00:00.000Z',
    nextRefreshAt: '2026-11-25T10:00:00.000Z',
    allowedActions: ['reconnect', 'refresh', 'disconnect'],
    externalRevocationSupported: false,
    externalRevocationResult: null,
    connectedByUserId: '018f6c5b-21a4-789a-8def-000000000002',
    environment: 'local',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    version: 2,
  };

  it('ConnectionCard renders owner actions when isOwner is true', () => {
    const html = renderToStaticMarkup(<ConnectionCard account={baseAccount} isOwner={true} />);
    expect(html).toContain('Làm mới');
    expect(html).toContain('Kết nối lại');
    expect(html).toContain('Ngắt kết nối');
  });

  it('ConnectionCard does not render owner action buttons when isOwner is false', () => {
    const html = renderToStaticMarkup(<ConnectionCard account={baseAccount} isOwner={false} />);
    expect(html).not.toContain('Làm mới');
    expect(html).not.toContain('Kết nối lại');
    expect(html).not.toContain('Ngắt kết nối');
  });

  it('ConnectionCard displays statusReason when present', () => {
    const accountWithReason: SocialAccountDTO = {
      ...baseAccount,
      status: 'degraded',
      statusReason: 'token_refresh_failed',
    };
    const html = renderToStaticMarkup(
      <ConnectionCard account={accountWithReason} isOwner={true} />,
    );
    expect(html).toContain('Lý do: token_refresh_failed');
  });

  it('DisconnectDialog renders destination title, Threads disclaimer, and buttons', () => {
    const html = renderToStaticMarkup(
      <DisconnectDialog
        account={baseAccount}
        isOpen={true}
        isDisconnecting={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('Ngắt kết nối Affiliate Pro Official (THREADS)');
    expect(html).toContain('Meta Threads không hỗ trợ thu hồi token từ xa qua API');
    expect(html).toContain('Hủy bỏ');
    expect(html).toContain('Xác nhận ngắt kết nối');
  });

  it('DisconnectDialog returns null when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <DisconnectDialog
        account={baseAccount}
        isOpen={false}
        isDisconnecting={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('ConnectionsBanner renders amber style and status role for partial status', () => {
    const html = renderToStaticMarkup(
      <ConnectionsBanner
        banner={{ status: 'partial', message: 'Kết nối tài khoản THREADS với quyền hạn giới hạn.' }}
        error={null}
        onDismissBanner={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('background-color:#fef3c7');
    expect(html).toContain('color:#92400e');
    expect(html).toContain('Kết nối tài khoản THREADS với quyền hạn giới hạn.');
  });
});
