import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createManualRevisionApi,
  fetchArtifactRevisionByNumberApi,
  fetchArtifactRevisionsApi,
  fetchChangeRequestByIdApi,
  requestScriptChangesApi,
} from '../src/lib/workforce-api-client-revisions.js';
import {
  validateArtifactChangeRequest,
  validateContentArtifactLineage,
  validateScriptPackage,
} from '../src/lib/workforce-validators-script.js';
import { createMockScriptPackage } from './content-studio-components.unit.test.js';

describe('Workforce API Client & Validators - Checkpoint C Revisions', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetchArtifactRevisionsApi parses list of revisions', async () => {
    const mockResponse = {
      items: [
        {
          id: 'rev-1',
          workspaceId: 'ws-1',
          artifactId: 'art-1',
          revisionNumber: 1,
          contentJson: {},
          contentHashHex: 'hash1',
          schemaVersion: 1,
          promptTemplate: 't',
          promptVersion: 'v',
          provider: 'google',
          model: 'gemini-3.8-flash',
          tokenInput: 100,
          tokenOutput: 200,
          costMicrounits: 10000,
          costCurrency: 'USD',
          latencyMs: 500,
          authorRoleKey: 'scriptwriter',
          createdAt: '2026-11-08T12:00:00.000Z',
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    } as Response);

    const res = await fetchArtifactRevisionsApi('ws-1', 'art-1');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.revisionNumber).toBe(1);
  });

  it('fetchArtifactRevisionByNumberApi fetches single revision', async () => {
    const mockRev = {
      id: 'rev-1',
      workspaceId: 'ws-1',
      artifactId: 'art-1',
      revisionNumber: 1,
      contentJson: {},
      contentHashHex: 'hash1',
      schemaVersion: 1,
      promptTemplate: 't',
      promptVersion: 'v',
      provider: 'google',
      model: 'gemini-3.8-flash',
      tokenInput: 100,
      tokenOutput: 200,
      costMicrounits: 10000,
      costCurrency: 'USD',
      latencyMs: 500,
      authorRoleKey: 'scriptwriter',
      createdAt: '2026-11-08T12:00:00.000Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockRev,
    } as Response);

    const res = await fetchArtifactRevisionByNumberApi('ws-1', 'art-1', 1);
    expect(res.revisionNumber).toBe(1);
    expect(res.model).toBe('gemini-3.8-flash');
  });

  it('fetchChangeRequestByIdApi fetches change request', async () => {
    const mockCr = {
      id: 'cr-123',
      artifactId: 'art-1',
      baseRevisionNumber: 1,
      baseContentHashHex: 'hash1',
      requestedByUserId: 'usr-1',
      instructionText: 'Update scenes',
      selectedVideoNumbers: [1, 2],
      targetVariantCount: 1,
      status: 'completed',
      resultingRevisionNumber: 2,
      failureReason: null,
      createdAt: '2026-11-08T12:00:00.000Z',
      updatedAt: '2026-11-08T12:05:00.000Z',
      version: 2,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockCr,
    } as Response);

    const res = await fetchChangeRequestByIdApi('ws-1', 'art-1', 'cr-123');
    expect(res.id).toBe('cr-123');
    expect(res.status).toBe('completed');
  });

  it('createManualRevisionApi sends structured payload and parses response', async () => {
    const mockPkg = createMockScriptPackage();
    const mockResponse = {
      artifact: {
        id: 'art-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        workOrderId: 'wo-1',
        workItemId: 'wi-1',
        assignmentId: 'asg-1',
        authorRoleKey: 'scriptwriter',
        artifactType: 'script_package',
        lifecycleStatus: 'review_required',
        currentRevisionNumber: 2,
        createdAt: '2026-11-08T12:00:00.000Z',
        updatedAt: '2026-11-08T12:00:00.000Z',
        version: 2,
      },
      latestRevision: {
        id: 'rev-2',
        workspaceId: 'ws-1',
        artifactId: 'art-1',
        revisionNumber: 2,
        contentJson: mockPkg,
        contentHashHex: 'hash2',
        schemaVersion: 1,
        promptTemplate: 'manual',
        promptVersion: 'manual',
        provider: 'human',
        model: 'manual_editor',
        tokenInput: null,
        tokenOutput: null,
        costMicrounits: null,
        costCurrency: null,
        latencyMs: null,
        authorRoleKey: 'scriptwriter',
        createdAt: '2026-11-08T12:30:00.000Z',
      },
      evidenceReferences: [],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    } as Response);

    const res = await createManualRevisionApi('ws-1', 'art-1', {
      expectedVersion: 1,
      baseRevisionNumber: 1,
      baseContentHashHex: 'hash1',
      rawContent: mockPkg,
      note: 'Updated voiceover',
    });

    expect(res.artifact.currentRevisionNumber).toBe(2);
    expect(res.latestRevision.revisionNumber).toBe(2);
  });

  it('requestScriptChangesApi sends change request and parses accepted response', async () => {
    const mockCr = {
      id: 'cr-1',
      artifactId: 'art-1',
      baseRevisionNumber: 1,
      baseContentHashHex: 'hash1',
      requestedByUserId: 'usr-1',
      instructionText: 'Make hook punchier',
      selectedVideoNumbers: [1, 3],
      targetVariantCount: 2,
      status: 'pending',
      resultingRevisionNumber: null,
      failureReason: null,
      createdAt: '2026-11-08T12:00:00.000Z',
      updatedAt: '2026-11-08T12:00:00.000Z',
      version: 1,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockCr,
    } as Response);

    const res = await requestScriptChangesApi('ws-1', 'art-1', {
      expectedVersion: 1,
      baseRevisionNumber: 1,
      baseContentHashHex: 'hash1',
      instructionText: 'Make hook punchier',
      selectedVideoNumbers: [1, 3],
      targetVariantCount: 2,
    });

    expect(res.id).toBe('cr-1');
    expect(res.selectedVideoNumbers).toEqual([1, 3]);
    expect(res.status).toBe('pending');
  });

  it('validateScriptPackage validates bounded 5-video package structure', () => {
    const pkg = createMockScriptPackage();
    const validated = validateScriptPackage(pkg);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.videos).toHaveLength(5);
    expect(validated.videos[0].videoNumber).toBe(1);
    expect(validated.videos[4].videoNumber).toBe(5);
  });

  it('validateScriptPackage rejects invalid video count or non-object', () => {
    expect(() => validateScriptPackage(null)).toThrow();
    expect(() =>
      validateScriptPackage({ schemaVersion: 1, seriesTitle: 'X', videos: [1, 2] }),
    ).toThrow();
  });

  it('validateArtifactChangeRequest and validateContentArtifactLineage parse valid objects', () => {
    const cr = validateArtifactChangeRequest({
      id: 'cr-1',
      artifactId: 'art-1',
      baseRevisionNumber: 1,
      baseContentHashHex: 'hash',
      requestedByUserId: 'u-1',
      instructionText: 'Update',
      selectedVideoNumbers: [2],
      targetVariantCount: 1,
      status: 'in_progress',
      version: 1,
    });
    expect(cr.id).toBe('cr-1');
    expect(cr.selectedVideoNumbers).toEqual([2]);

    const lin = validateContentArtifactLineage({
      id: 'lin-1',
      artifactId: 'art-1',
      revisionNumber: 1,
      lineageType: 'ai_generated',
      contentBriefHashHex: 'briefhash',
      contentBriefVersion: 1,
      planningRevisionIds: { product_strategy: 'r1' },
      sourceScriptUnitIds: ['u1'],
      metadata: {},
      createdAt: '2026-11-08T12:00:00.000Z',
    });
    expect(lin.lineageType).toBe('ai_generated');
    expect(lin.contentBriefVersion).toBe(1);
  });
});
