import { describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseQueryResult } from '../../src/database/index.js';
import { DatabaseError } from '../../src/database/errors.js';
import { createPostgresLoginTransactionAdapter } from '../../src/auth/postgres-login-transaction-adapter.js';
import { createPostgresSessionAdapter } from '../../src/auth/postgres-session-adapter.js';
import { createPostgresWorkspaceSummaryAdapter } from '../../src/auth/postgres-workspace-summary-adapter.js';

function createMockDatabase(): {
  database: Database;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const database = {
    query,
    withTransaction: vi.fn(),
    probe: vi.fn(),
    close: vi.fn(),
  } as unknown as Database;
  return { database, query };
}

describe('packages/infrastructure/auth/postgres-auth-adapters', () => {
  const sampleNow = '2026-11-02T12:00:00.000Z';
  const sampleExpires = '2026-11-02T12:10:00.000Z';
  const sampleId = '0192b012-3456-789a-8bcd-ef0123456789';
  const sampleUserId = '0192b012-3456-789a-8bcd-ef0123456710';
  const hash32 = new Uint8Array(32).fill(1);
  const iv12 = new Uint8Array(12).fill(2);
  const tag16 = new Uint8Array(16).fill(3);
  const cipher = new Uint8Array([1, 2, 3]);

  describe('PostgresLoginTransactionAdapter', () => {
    it('executes parameterized INSERT with exact column order', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const adapter = createPostgresLoginTransactionAdapter(database);

      await adapter.createLoginTransaction({
        id: sampleId,
        stateHash: hash32,
        browserBindingHash: hash32,
        secretsCiphertext: cipher,
        secretsIv: iv12,
        secretsAuthTag: tag16,
        keyVersion: 'v1',
        returnTo: '/dashboard',
        createdAt: sampleNow,
        expiresAt: sampleExpires,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('INSERT INTO oidc_login_transactions');
      expect(sql).toContain('$1');
      expect(params).toHaveLength(10);
      expect(params[0]).toBe(sampleId);
      expect(params[1]).toEqual(Buffer.from(hash32));
      expect(params[2]).toEqual(Buffer.from(hash32));
      expect(params[3]).toEqual(Buffer.from(cipher));
      expect(params[4]).toEqual(Buffer.from(iv12));
      expect(params[5]).toEqual(Buffer.from(tag16));
      expect(params[6]).toBe('v1');
      expect(params[7]).toBe('/dashboard');
      expect(params[8]).toBe(sampleNow);
      expect(params[9]).toBe(sampleExpires);
    });

    it('consumes transaction atomically via locking CTE and maps result', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: sampleId,
            key_version: 'v1',
            return_to: '/dashboard',
            secrets_ciphertext: Buffer.from(cipher),
            secrets_iv: Buffer.from(iv12),
            secrets_auth_tag: Buffer.from(tag16),
            created_at: sampleNow,
            expires_at: sampleExpires,
          },
        ],
      } as unknown as DatabaseQueryResult<unknown>);

      const adapter = createPostgresLoginTransactionAdapter(database);
      const result = await adapter.consumeLoginTransaction({
        stateHash: hash32,
        browserBindingHash: hash32,
        now: sampleNow,
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(sampleId);
      expect(result!.returnTo).toBe('/dashboard');
      expect(result!.secretsCiphertext).toEqual(cipher);
      expect(result!.secretsIv).toEqual(iv12);
      expect(result!.secretsAuthTag).toEqual(tag16);

      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('WITH target AS');
      expect(sql).toContain('UPDATE oidc_login_transactions');
      expect(params).toEqual([Buffer.from(hash32), Buffer.from(hash32), sampleNow]);
    });

    it('returns null when no pending transaction matches', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const adapter = createPostgresLoginTransactionAdapter(database);

      const result = await adapter.consumeLoginTransaction({
        stateHash: hash32,
        browserBindingHash: hash32,
        now: sampleNow,
      });
      expect(result).toBeNull();
    });

    it('fails closed when duplicate rows are returned', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({
        rowCount: 2,
        rows: [{}, {}],
      } as unknown as DatabaseQueryResult<unknown>);
      const adapter = createPostgresLoginTransactionAdapter(database);

      await expect(
        adapter.consumeLoginTransaction({
          stateHash: hash32,
          browserBindingHash: hash32,
          now: sampleNow,
        }),
      ).rejects.toThrow(DatabaseError);
    });
  });

  describe('PostgresSessionAdapter', () => {
    it('creates active session with parameterized SQL', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const adapter = createPostgresSessionAdapter(database);

      await adapter.createSession({
        id: sampleId,
        userId: sampleUserId,
        currentTokenHash: hash32,
        createdAt: sampleNow,
        lastSeenAt: sampleNow,
        idleExpiresAt: sampleExpires,
        absoluteExpiresAt: sampleExpires,
        rotatedAt: sampleNow,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('INSERT INTO application_sessions');
      expect(params).toEqual([
        sampleId,
        sampleUserId,
        Buffer.from(hash32),
        sampleNow,
        sampleNow,
        sampleExpires,
        sampleExpires,
        sampleNow,
      ]);
    });

    it('finds candidate sessions by current or valid previous hash', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: sampleId,
            user_id: sampleUserId,
            current_token_hash: Buffer.from(hash32),
            previous_token_hash: null,
            previous_token_valid_until: null,
            created_at: sampleNow,
            last_seen_at: sampleNow,
            idle_expires_at: sampleExpires,
            absolute_expires_at: sampleExpires,
            rotated_at: sampleNow,
            revoked_at: null,
            revocation_reason: null,
            version: '1',
          },
        ],
      } as unknown as DatabaseQueryResult<unknown>);

      const adapter = createPostgresSessionAdapter(database);
      const rows = await adapter.findCandidateSessions({
        tokenHash: hash32,
        now: sampleNow,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(sampleId);
      expect(rows[0]!.userId).toBe(sampleUserId);
      expect(rows[0]!.version).toBe(1);
    });

    it('rotates session and increments version', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const adapter = createPostgresSessionAdapter(database);

      const newHash = new Uint8Array(32).fill(9);
      await adapter.rotateSession({
        sessionId: sampleId,
        currentVersion: 1,
        newCurrentHash: newHash,
        oldCurrentHash: hash32,
        graceValidUntil: sampleExpires,
        rotatedAt: sampleNow,
        lastSeenAt: sampleNow,
        idleExpiresAt: sampleExpires,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('UPDATE application_sessions');
      expect(sql).toContain('version = version + 1');
      expect(params[6]).toBe(sampleId);
      expect(params[7]).toBe(1);
    });

    it('throws DatabaseError when rotation encounters version mismatch (concurrency conflict)', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const adapter = createPostgresSessionAdapter(database);

      await expect(
        adapter.rotateSession({
          sessionId: sampleId,
          currentVersion: 1,
          newCurrentHash: hash32,
          oldCurrentHash: hash32,
          graceValidUntil: sampleExpires,
          rotatedAt: sampleNow,
          lastSeenAt: sampleNow,
          idleExpiresAt: sampleExpires,
        }),
      ).rejects.toThrow(DatabaseError);
    });

    it('touches session and updates idle expiry', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const adapter = createPostgresSessionAdapter(database);

      await adapter.touchSession({
        sessionId: sampleId,
        currentVersion: 1,
        lastSeenAt: sampleNow,
        idleExpiresAt: sampleExpires,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('UPDATE application_sessions');
      expect(params).toEqual([sampleNow, sampleExpires, sampleId, 1]);
    });

    it('revokes session and scrubs token hashes', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const adapter = createPostgresSessionAdapter(database);

      await adapter.revokeSession({
        sessionId: sampleId,
        currentVersion: 1,
        revokedAt: sampleNow,
        reason: 'logout',
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('current_token_hash = NULL');
      expect(sql).toContain('previous_token_hash = NULL');
      expect(params).toEqual([sampleNow, 'logout', sampleId, 1]);
    });
  });

  describe('PostgresWorkspaceSummaryAdapter', () => {
    it('queries active memberships and workspaces with LIMIT 101 and stable order', async () => {
      const { database, query } = createMockDatabase();
      query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: '0192b012-3456-789a-8bcd-ef0123456722',
            name: 'Workspace Alpha',
            slug: 'workspace-alpha',
            timezone: 'Asia/Ho_Chi_Minh',
            role: 'owner',
          },
        ],
      } as unknown as DatabaseQueryResult<unknown>);

      const adapter = createPostgresWorkspaceSummaryAdapter(database);
      const res = await adapter.listActiveWorkspaceSummaries(sampleUserId);

      expect(res.hasMore).toBe(false);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.name).toBe('Workspace Alpha');
      expect(res.items[0]!.slug).toBe('workspace-alpha');
      expect(res.items[0]!.role).toBe('owner');

      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain("m.status = 'active'");
      expect(sql).toContain("w.status = 'active'");
      expect(sql).toContain('ORDER BY w.slug ASC, w.id ASC');
      expect(sql).toContain('LIMIT 101');
      expect(params).toEqual([sampleUserId]);
    });

    it('sets hasMore=true when exactly 101 rows returned and slices to 100', async () => {
      const { database, query } = createMockDatabase();
      const mockRows = Array.from({ length: 101 }, (_, i) => ({
        id: `0192b012-3456-789a-8bcd-ef0123456${String(i).padStart(3, '0')}`,
        name: `Workspace ${i}`,
        slug: `ws-${i}`,
        timezone: 'UTC',
        role: 'editor',
      }));
      query.mockResolvedValueOnce({
        rowCount: 101,
        rows: mockRows,
      } as unknown as DatabaseQueryResult<unknown>);

      const adapter = createPostgresWorkspaceSummaryAdapter(database);
      const res = await adapter.listActiveWorkspaceSummaries(sampleUserId);

      expect(res.hasMore).toBe(true);
      expect(res.items).toHaveLength(100);
    });
  });
});
