import { describe, expect, it } from 'vitest';
import { CatalogRequestCoordinator } from '../src/lib/catalog-request-coordinator.js';

describe('CatalogRequestCoordinator', () => {
  it('manages abort signals and sequence matching across rapid workspace switches', () => {
    const coordinator = new CatalogRequestCoordinator();

    const handle1 = coordinator.startRequest();
    expect(handle1.signal.aborted).toBe(false);
    expect(coordinator.isCurrent(handle1.sequence)).toBe(true);

    const handle2 = coordinator.startRequest();
    expect(handle1.signal.aborted).toBe(true);
    expect(handle2.signal.aborted).toBe(false);
    expect(coordinator.isCurrent(handle1.sequence)).toBe(false);
    expect(coordinator.isCurrent(handle2.sequence)).toBe(true);
  });

  it('invalidate cancels active request and invalidates current sequence', () => {
    const coordinator = new CatalogRequestCoordinator();
    const handle = coordinator.startRequest();

    coordinator.invalidate();
    expect(handle.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(handle.sequence)).toBe(false);
  });
});
