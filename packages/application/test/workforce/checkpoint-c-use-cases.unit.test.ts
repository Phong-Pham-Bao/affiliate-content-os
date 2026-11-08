import { describe, expect, it, vi } from 'vitest';
import { DomainValidationError, type UserId, type WorkspaceId } from '@affiliate-content-os/domain';
import {
  createManualRevision,
  getArtifactRevisionByNumber,
  getArtifactRevisions,
  getChangeRequestById,
  requestScriptChanges,
  type WorkforcePersistencePort,
} from '../../src/workforce/index.js';

const wsId = '018f0000-0000-7000-8000-000000000001' as WorkspaceId;
const userId = '018f0000-0000-7000-8000-000000000002' as UserId;
const artId = '018f0000-0000-7000-8000-000000000003';
const changeReqId = '018f0000-0000-7000-8000-000000000004';
const hashHex = 'a'.repeat(64);

function makeFakeVideo(num: 1 | 2 | 3 | 4 | 5) {
  return {
    videoNumber: num,
    title: `Video ${num} Title`,
    objective: `Objective ${num}`,
    targetDurationSeconds: 45,
    hook: {
      spokenHook: 'Spoken hook text',
      visualHook: 'Visual hook text',
    },
    voiceOver: 'Voice-over narration text for video',
    scenes: [
      {
        sceneNumber: 1,
        timeRangeSeconds: { start: 0, end: 5 },
        visualDescription: 'Visual scene 1',
        spokenText: 'Spoken text 1',
      },
    ],
    onScreenOverlays: [],
    callToAction: {
      text: 'CTA text',
      visualDirection: 'Visual CTA',
    },
    disclosure: {
      placement: 'Bottom',
      text: 'Affiliate disclosure',
    },
    shotList: [
      {
        shotNumber: 1,
        durationSeconds: 5,
        description: 'Shot 1',
        cameraAngle: 'Eye-level',
        framing: 'Medium',
        movement: 'Static',
        props: [],
      },
    ],
    variants: [
      {
        variantNumber: 1,
        hook: { spokenHook: 'Hook 1', visualHook: 'Visual 1' },
        voiceOver: 'VO 1',
        scenes: [
          {
            sceneNumber: 1,
            timeRangeSeconds: { start: 0, end: 5 },
            visualDescription: 'Visual 1',
            spokenText: 'Spoken 1',
          },
        ],
        callToAction: { text: 'CTA 1', visualDirection: 'Visual 1' },
      },
    ],
    evidenceReferences: [],
    creativeHypotheses: [],
  };
}

describe('Checkpoint C Application Use Cases', () => {
  it('calls getArtifactRevisions via persistence port', async () => {
    const mockPersistence = {
      getArtifactRevisions: vi.fn().mockResolvedValue([{ revisionNumber: 1 }]),
    } as unknown as WorkforcePersistencePort;

    const res = await getArtifactRevisions(mockPersistence, wsId, artId);
    expect(mockPersistence.getArtifactRevisions).toHaveBeenCalledWith(wsId, artId);
    expect(res).toHaveLength(1);
  });

  it('calls getArtifactRevisionByNumber via persistence port', async () => {
    const mockPersistence = {
      getArtifactRevisionByNumber: vi.fn().mockResolvedValue({
        artifact: { id: artId },
        latestRevision: { revisionNumber: 2 },
      }),
    } as unknown as WorkforcePersistencePort;

    const res = await getArtifactRevisionByNumber(mockPersistence, wsId, artId, 2);
    expect(mockPersistence.getArtifactRevisionByNumber).toHaveBeenCalledWith(wsId, artId, 2);
    expect(res?.latestRevision?.revisionNumber).toBe(2);
  });

  it('calls getChangeRequestById via persistence port', async () => {
    const mockPersistence = {
      getChangeRequestById: vi.fn().mockResolvedValue({ id: changeReqId }),
    } as unknown as WorkforcePersistencePort;

    const res = await getChangeRequestById(mockPersistence, wsId, artId, changeReqId);
    expect(mockPersistence.getChangeRequestById).toHaveBeenCalledWith(wsId, artId, changeReqId);
    expect(res?.id).toBe(changeReqId);
  });

  it('validates content and calls createManualRevision', async () => {
    const mockPersistence = {
      createManualRevision: vi.fn().mockResolvedValue({
        artifact: { id: artId, currentRevisionNumber: 2 },
      }),
    } as unknown as WorkforcePersistencePort;

    const validPackage = {
      schemaVersion: 1,
      seriesTitle: 'Series 5 Video',
      targetAudienceSummary: 'Audience summary',
      creativeDirectionSummary: 'Creative direction summary',
      videos: [
        makeFakeVideo(1),
        makeFakeVideo(2),
        makeFakeVideo(3),
        makeFakeVideo(4),
        makeFakeVideo(5),
      ],
      evidenceReferences: [],
    };

    const res = await createManualRevision(mockPersistence, {
      workspaceId: wsId,
      artifactId: artId,
      actorUserId: userId,
      expectedVersion: 1,
      baseRevisionNumber: 1,
      baseContentHashHex: hashHex,
      rawContent: validPackage,
      note: 'Human polish',
      idempotencyKey: 'idemp-manual-rev-1',
    });

    expect(mockPersistence.createManualRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency: expect.objectContaining({
          rawKey: 'idemp-manual-rev-1',
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artId}/revisions`,
        }),
      }),
    );
    expect(res.artifact.currentRevisionNumber).toBe(2);
  });

  it('validates inputs and calls requestScriptChanges', async () => {
    const mockPersistence = {
      requestScriptChanges: vi.fn().mockResolvedValue({
        id: changeReqId,
        status: 'in_progress',
        selectedVideoNumbers: [1, 3],
      }),
    } as unknown as WorkforcePersistencePort;

    const res = await requestScriptChanges(mockPersistence, {
      workspaceId: wsId,
      artifactId: artId,
      actorUserId: userId,
      expectedVersion: 1,
      baseRevisionNumber: 1,
      baseContentHashHex: hashHex,
      instructionText: 'Làm nổi bật tính năng tiết kiệm năng lượng hơn',
      selectedVideoNumbers: [3, 1], // Unsorted with duplicate check
      targetVariantCount: 2,
      idempotencyKey: 'idemp-req-changes-1',
    });

    expect(mockPersistence.requestScriptChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        instructionText: 'Làm nổi bật tính năng tiết kiệm năng lượng hơn',
        selectedVideoNumbers: [1, 3], // Sorted and unique
        targetVariantCount: 2,
        idempotency: expect.objectContaining({
          rawKey: 'idemp-req-changes-1',
          routeKey: `POST /api/v1/workspaces/${wsId}/artifacts/${artId}/request-changes`,
        }),
      }),
    );
    expect(res.status).toBe('in_progress');
  });

  it('rejects requestScriptChanges with empty instruction text or invalid video numbers', async () => {
    const mockPersistence = {
      requestScriptChanges: vi.fn(),
    } as unknown as WorkforcePersistencePort;

    await expect(
      requestScriptChanges(mockPersistence, {
        workspaceId: wsId,
        artifactId: artId,
        actorUserId: userId,
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: hashHex,
        instructionText: '   ',
        selectedVideoNumbers: [1],
        idempotencyKey: 'idemp-invalid-1',
      }),
    ).rejects.toThrow(DomainValidationError);

    await expect(
      requestScriptChanges(mockPersistence, {
        workspaceId: wsId,
        artifactId: artId,
        actorUserId: userId,
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: hashHex,
        instructionText: 'Valid instruction',
        selectedVideoNumbers: [0 as unknown as 1],
        idempotencyKey: 'idemp-invalid-2',
      }),
    ).rejects.toThrow(DomainValidationError);
  });

  it('rejects createManualRevision and requestScriptChanges with invalid idempotency key', async () => {
    const mockPersistence = {
      createManualRevision: vi.fn(),
      requestScriptChanges: vi.fn(),
    } as unknown as WorkforcePersistencePort;

    const samplePackage = {
      schemaVersion: 1,
      seriesTitle: 'Series 5 Video',
      targetAudienceSummary: 'Audience summary',
      creativeDirectionSummary: 'Creative direction summary',
      videos: [
        makeFakeVideo(1),
        makeFakeVideo(2),
        makeFakeVideo(3),
        makeFakeVideo(4),
        makeFakeVideo(5),
      ],
      evidenceReferences: [],
    };

    await expect(
      createManualRevision(mockPersistence, {
        workspaceId: wsId,
        artifactId: artId,
        actorUserId: userId,
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: hashHex,
        rawContent: samplePackage,
        idempotencyKey: '   ',
      }),
    ).rejects.toThrow(DomainValidationError);

    await expect(
      requestScriptChanges(mockPersistence, {
        workspaceId: wsId,
        artifactId: artId,
        actorUserId: userId,
        expectedVersion: 1,
        baseRevisionNumber: 1,
        baseContentHashHex: hashHex,
        instructionText: 'Valid',
        selectedVideoNumbers: [1],
        idempotencyKey: '',
      }),
    ).rejects.toThrow(DomainValidationError);
  });
});
