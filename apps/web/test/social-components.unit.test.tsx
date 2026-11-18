import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SocialAccountDTO } from '../src/types/social.js';
import {
  ConnectionCapabilitiesBadge,
  ConnectionStatusBadge,
} from '../src/components/connections/connection-status-badge.js';
import { ConnectionCard } from '../src/components/connections/connection-card.js';
import { ConnectionsPanel } from '../src/components/connections/connections-panel.js';

describe('Social Connections Web Components Rendering', () => {
  const dummyAccount: SocialAccountDTO = {
    id: '018f6c5b-21a4-789a-8def-000000000010',
    workspaceId: '018f6c5b-21a4-789a-8def-000000000001',
    platform: 'threads',
    providerAccountId: 'threads_user_1',
    displayName: 'Affiliate Pro Official',
    handle: 'affiliate_pro',
    status: 'active',
    grantedScopes: ['threads_basic', 'threads_content_publish'],
    capabilities: {
      canPublishText: true,
      canPublishMedia: true,
      isBusinessAccount: true,
    },
    capabilitiesCheckedAt: '2026-11-18T10:00:00.000Z',
    tokenExpiresAt: '2026-12-01T00:00:00.000Z',
    connectedByUserId: '018f6c5b-21a4-789a-8def-000000000002',
    environment: 'local',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    version: 1,
  };

  describe('ConnectionStatusBadge', () => {
    it('renders active status with Vietnamese label', () => {
      const html = renderToStaticMarkup(<ConnectionStatusBadge status="active" />);
      expect(html).toContain('Đang hoạt động (Active)');
      expect(html).toContain('status-badge-active');
    });

    it('renders degraded status with Vietnamese label', () => {
      const html = renderToStaticMarkup(<ConnectionStatusBadge status="degraded" />);
      expect(html).toContain('Bị giới hạn (Degraded)');
      expect(html).toContain('status-badge-degraded');
    });

    it('renders reauth_required status with Vietnamese label', () => {
      const html = renderToStaticMarkup(<ConnectionStatusBadge status="reauth_required" />);
      expect(html).toContain('Cần xác thực lại (Reauth Required)');
    });

    it('renders disconnected status with Vietnamese label', () => {
      const html = renderToStaticMarkup(<ConnectionStatusBadge status="disconnected" />);
      expect(html).toContain('Đã ngắt kết nối (Disconnected)');
    });
  });

  describe('ConnectionCapabilitiesBadge', () => {
    it('renders capability pills correctly', () => {
      const html = renderToStaticMarkup(
        <ConnectionCapabilitiesBadge
          capabilities={{
            canPublishText: true,
            canPublishMedia: true,
            isBusinessAccount: true,
          }}
        />,
      );
      expect(html).toContain('Văn bản');
      expect(html).toContain('Hình/Video');
      expect(html).toContain('Doanh nghiệp');
    });
  });

  describe('ConnectionCard', () => {
    it('renders account metadata, platform, handle, and local test tag', () => {
      const html = renderToStaticMarkup(<ConnectionCard account={dummyAccount} />);
      expect(html).toContain('threads');
      expect(html).toContain('Affiliate Pro Official');
      expect(html).toContain('Local/Test');
      expect(html).toContain('Khả năng xuất bản (Capabilities):');
      expect(html).toContain('Văn bản');
      expect(html).toContain('Hình/Video');
      expect(html).toContain('Doanh nghiệp');
      expect(html).toContain('Đang hoạt động (Active)');
    });

    it('renders TikTok account with degraded state', () => {
      const tikTokAccount: SocialAccountDTO = {
        ...dummyAccount,
        id: '018f6c5b-21a4-789a-8def-000000000011',
        platform: 'tiktok',
        displayName: 'TikTok Creator',
        status: 'degraded',
        capabilities: {
          canPublishText: false,
          canPublishMedia: false,
          isBusinessAccount: false,
        },
      };

      const html = renderToStaticMarkup(<ConnectionCard account={tikTokAccount} />);
      expect(html).toContain('tiktok');
      expect(html).toContain('TikTok Creator');
      expect(html).toContain('Bị giới hạn (Degraded)');
    });
  });

  describe('ConnectionsPanel', () => {
    it('renders owner actions when userRole is owner', () => {
      const html = renderToStaticMarkup(
        <ConnectionsPanel workspaceId="018f6c5b-21a4-789a-8def-000000000001" userRole="owner" />,
      );
      expect(html).toContain('Tài khoản mạng xã hội (Social Connections)');
      expect(html).toContain('+ Kết nối Threads');
      expect(html).toContain('+ Kết nối TikTok');
      expect(html).not.toContain('Chỉ Chủ sở hữu (Owner) mới có quyền kết nối tài khoản mới.');
    });

    it('renders non-owner notice when userRole is viewer', () => {
      const html = renderToStaticMarkup(
        <ConnectionsPanel workspaceId="018f6c5b-21a4-789a-8def-000000000001" userRole="viewer" />,
      );
      expect(html).toContain('Tài khoản mạng xã hội (Social Connections)');
      expect(html).not.toContain('+ Kết nối Threads');
      expect(html).toContain('Chỉ Chủ sở hữu (Owner) mới có quyền kết nối tài khoản mới.');
    });
  });
});
