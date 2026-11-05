import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureAuditEventSnapshot } from '@affiliate-content-os/application';
import { createPostgresAuditAdapter } from '../../src/audit/index.js';
import { setupIsolatedTestDatabase, type TestDatabaseContext } from './helpers/setup.js';

describe('audit_events append-only schema', () => {
  let context: TestDatabaseContext;
  let client: pg.Client;
  beforeAll(async () => {
    context = await setupIsolatedTestDatabase();
    client = new pg.Client({ connectionString: context.dbUrl });
    await client.connect();
    await client.query(
      `INSERT INTO users(id,identity_provider,identity_subject,status,created_at,updated_at) VALUES('0192b012-3456-789a-8bcd-ef0123456703','issuer','audit-user','active',now(),now()); INSERT INTO workspaces(id,name,slug,timezone,ai_enabled,status,created_at,updated_at) VALUES('0192b012-3456-789a-8bcd-ef0123456702','Audit','audit-test','UTC',false,'active',now(),now())`,
    );
  });
  afterAll(async () => {
    await client?.end();
    await context?.cleanup();
  });
  it('inserts and rejects update/delete while preserving the row', async () => {
    await client.query(
      `INSERT INTO audit_events(id,workspace_id,actor_type,actor_user_id,action,resource_type,resource_id,result,changes_json,occurred_at,created_at) VALUES('0192b012-3456-789a-8bcd-ef0123456701','0192b012-3456-789a-8bcd-ef0123456702','user','0192b012-3456-789a-8bcd-ef0123456703','workspace.created','workspace','0192b012-3456-789a-8bcd-ef0123456702','succeeded','{}',now(),now())`,
    );
    await expect(client.query(`UPDATE audit_events SET result='failed'`)).rejects.toMatchObject({
      code: '55000',
    });
    await expect(client.query(`DELETE FROM audit_events`)).rejects.toMatchObject({ code: '55000' });
    await expect(client.query(`TRUNCATE audit_events`)).rejects.toMatchObject({ code: '55000' });
    const r = await client.query(`SELECT result FROM audit_events`);
    expect(r.rows).toEqual([{ result: 'succeeded' }]);
  });

  it('enforces actor, tenant, token, JSON, metadata, timestamp, and duplicate constraints', async () => {
    const sql = `INSERT INTO audit_events(id,workspace_id,actor_type,actor_user_id,action,resource_type,resource_id,result,reason_code,changes_json,ip_hash,user_agent_summary,occurred_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)`;
    const base = [
      '0192b012-3456-789a-8bcd-ef0123456710',
      '0192b012-3456-789a-8bcd-ef0123456702',
      'user',
      '0192b012-3456-789a-8bcd-ef0123456703',
      'workspace.updated',
      'workspace',
      '0192b012-3456-789a-8bcd-ef0123456702',
      'succeeded',
      null,
      '{}',
      null,
      null,
      '2026-11-05T12:00:00.000Z',
      '2026-11-05T12:00:00.000Z',
    ];
    const cases: Array<[string, readonly unknown[]]> = [
      ['actor consistency', base.map((v, i) => (i === 3 ? null : v))],
      ['system actor consistency', base.map((v, i) => (i === 2 ? 'system' : v))],
      ['workspace FK', base.map((v, i) => (i === 1 ? '0192b012-3456-789a-8bcd-ef0123456799' : v))],
      ['actor FK', base.map((v, i) => (i === 3 ? '0192b012-3456-789a-8bcd-ef0123456799' : v))],
      ['action token', base.map((v, i) => (i === 4 ? 'Workspace.Updated' : v))],
      ['changes JSON', base.map((v, i) => (i === 9 ? '[]' : v))],
      [
        'changes key limit',
        base.map((v, i) =>
          i === 9
            ? JSON.stringify(Object.fromEntries(Array.from({ length: 33 }, (_, n) => [`k${n}`, n])))
            : v,
        ),
      ],
      ['IP hash', base.map((v, i) => (i === 10 ? '127.0.0.1' : v))],
      ['user agent', base.map((v, i) => (i === 11 ? ' raw ' : v))],
      ['timestamp', base.map((v, i) => (i === 13 ? '2026-11-05T11:59:59.000Z' : v))],
      ['duplicate id', base.map((v, i) => (i === 0 ? '0192b012-3456-789a-8bcd-ef0123456701' : v))],
    ];
    for (const [_name, params] of cases)
      await expect(client.query(sql, params as unknown[])).rejects.toBeTruthy();
  });

  it('round-trips approved changes through the PostgreSQL adapter', async () => {
    const adapter = createPostgresAuditAdapter({
      query: async (text: string, params?: readonly unknown[]) => {
        const result = await client.query(text, params as unknown[] | undefined);
        return {
          rows: Object.freeze([...result.rows]),
          rowCount: result.rowCount ?? 0,
          command: result.command,
        };
      },
    } as never);
    const event = captureAuditEventSnapshot({
      id: '0192b012-3456-789a-8bcd-ef0123456711',
      workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
      actorType: 'system',
      actorUserId: null,
      action: 'workspace.updated',
      resourceType: 'workspace',
      resourceId: '0192b012-3456-789a-8bcd-ef0123456702',
      result: 'succeeded',
      reasonCode: null,
      changes: { status: { before: 'draft', after: 'active' } },
      ipHash: null,
      userAgentSummary: null,
      correlationId: null,
      occurredAt: '2026-11-05T12:00:00.000Z',
      createdAt: '2026-11-05T12:00:00.000Z',
    });
    await adapter.appendAuditEvent(event);
    const result = await client.query(`SELECT changes_json FROM audit_events WHERE id=$1`, [
      event.id,
    ]);
    expect(result.rows[0]?.changes_json).toEqual({ status: { before: 'draft', after: 'active' } });
  });
  it('has all four approved indexes', async () => {
    const r = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='audit_events' ORDER BY indexname`,
    );
    expect(r.rows.map((x) => x.indexname)).toEqual(
      expect.arrayContaining([
        'idx_audit_events_workspace_cursor',
        'idx_audit_events_workspace_resource',
        'idx_audit_events_workspace_actor',
        'idx_audit_events_correlation',
      ]),
    );
  });
});
