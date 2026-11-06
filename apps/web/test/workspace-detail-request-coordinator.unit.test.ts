import { describe, expect, it } from 'vitest';
import { WorkspaceDetailRequestCoordinator } from '../src/lib/workspace-detail-request-coordinator.js';

describe('WorkspaceDetailRequestCoordinator', () => {
  it('assigns monotonically increasing sequences', () => {
    const coordinator = new WorkspaceDetailRequestCoordinator();
    const h1 = coordinator.startRequest('ws-1');
    const h2 = coordinator.startRequest('ws-2');

    expect(h1.sequence).toBe(1);
    expect(h2.sequence).toBe(2);
    expect(coordinator.getCurrentWorkspaceId()).toBe('ws-2');
  });

  it('aborts previous in-flight request signal when new request starts', () => {
    const coordinator = new WorkspaceDetailRequestCoordinator();
    const h1 = coordinator.startRequest('ws-1');
    expect(h1.signal.aborted).toBe(false);

    const h2 = coordinator.startRequest('ws-2');
    expect(h1.signal.aborted).toBe(true);
    expect(h2.signal.aborted).toBe(false);
  });

  it('prevents out-of-order completion: older request A cannot overwrite newer B', async () => {
    const coordinator = new WorkspaceDetailRequestCoordinator();

    // Start request A
    const reqA = coordinator.startRequest('ws-a');
    // Start request B immediately after
    const reqB = coordinator.startRequest('ws-b');

    // Simulate async resolution order: B finishes first, then A finishes
    let activeWorkspaceId: string | null = null;

    // B completes
    if (coordinator.isCurrent(reqB.sequence)) {
      activeWorkspaceId = 'ws-b';
    }
    expect(activeWorkspaceId).toBe('ws-b');

    // A completes late
    if (coordinator.isCurrent(reqA.sequence)) {
      activeWorkspaceId = 'ws-a';
    }
    // A was rejected because sequence 1 != currentSequence 2
    expect(activeWorkspaceId).toBe('ws-b');
  });

  it('invalidates pending requests on session reload or signout', () => {
    const coordinator = new WorkspaceDetailRequestCoordinator();
    const req = coordinator.startRequest('ws-1');
    expect(coordinator.isCurrent(req.sequence)).toBe(true);

    coordinator.invalidate();
    expect(coordinator.isCurrent(req.sequence)).toBe(false);
    expect(req.signal.aborted).toBe(true);
    expect(coordinator.getCurrentWorkspaceId()).toBeNull();
  });
});
