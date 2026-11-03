import { describe, expect, it, vi } from 'vitest';
import { parseIsoTimestamp, parseUserId } from '@affiliate-content-os/domain';
import { getCurrentUser } from '../../src/auth/get-current-user.js';
import type { AuthenticatedSessionContext } from '../../src/auth/authenticate-session.js';
import type { WorkspaceSummaryPort } from '../../src/auth/ports.js';

describe('packages/application - getCurrentUser', () => {
  const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
  const sampleContext: AuthenticatedSessionContext = {
    user: {
      id: parseUserId(sampleUserId),
      identityProvider: 'https://auth.example.com',
      identitySubject: 'sub-1',
      email: 'user@example.com',
      displayName: 'Example User',
      status: 'active',
      createdAt: parseIsoTimestamp('2026-11-02T10:00:00.000Z'),
      updatedAt: parseIsoTimestamp('2026-11-02T10:00:00.000Z'),
      version: 1,
    },
    session: {
      id: '0192b012-3456-789a-8bcd-ef0123456720',
      userId: sampleUserId,
      idleExpiresAt: '2026-11-02T12:30:00.000Z',
      absoluteExpiresAt: '2026-11-02T20:00:00.000Z',
    },
    rotatedToken: null,
  };

  it('returns exactly the approved safe shape without exposing internal metadata or secrets', async () => {
    const workspaceSummary: WorkspaceSummaryPort = {
      listActiveWorkspaceSummaries: vi.fn().mockResolvedValue({
        items: [
          {
            id: '0192b012-3456-789a-8bcd-ef0123456730',
            name: 'Workspace Alpha',
            slug: 'workspace-alpha',
            timezone: 'Asia/Ho_Chi_Minh',
            role: 'owner',
          },
        ],
        hasMore: false,
      }),
    };

    const res = await getCurrentUser(sampleContext, { workspaceSummary });

    expect(res.user.id).toBe(sampleUserId);
    expect(res.user.email).toBe('user@example.com');
    expect(res.user.displayName).toBe('Example User');
    expect(res.session.idleExpiresAt).toBe('2026-11-02T12:30:00.000Z');
    expect(res.session.absoluteExpiresAt).toBe('2026-11-02T20:00:00.000Z');
    expect(res.workspaceAccess.items).toHaveLength(1);
    expect(res.workspaceAccess.hasMore).toBe(false);

    // Verify non-disclosure of internal metadata
    const userKeys = Object.keys(res.user);
    expect(userKeys).toEqual(['id', 'email', 'displayName']);

    const sessionKeys = Object.keys(res.session);
    expect(sessionKeys).toEqual(['idleExpiresAt', 'absoluteExpiresAt']);
  });
});
