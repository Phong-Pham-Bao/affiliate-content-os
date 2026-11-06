import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api-validators-common.js';
import { validateWorkspaceDetails } from '../src/lib/workspace-details-validator.js';

describe('apps/web - validateWorkspaceDetails', () => {
  const validDetails = {
    id: '018f4a1b-9b2e-7222-8000-000000000002',
    name: 'Main Space',
    slug: 'main-space',
    timezone: 'America/New_York',
    brandVoice: null,
    defaultDisclosure: null,
    aiEnabled: false,
    status: 'active',
    role: 'owner',
    createdAt: '2026-11-06T09:00:00Z',
    updatedAt: '2026-11-06T09:00:00Z',
    version: 1,
  };

  it('validates a strictly compliant WorkspaceDetails payload', () => {
    const res = validateWorkspaceDetails(validDetails);
    expect(res.id).toBe(validDetails.id);
    expect(res.name).toBe('Main Space');
    expect(res.version).toBe(1);
  });

  it('rejects extra keys on WorkspaceDetails payload', () => {
    expect(() => validateWorkspaceDetails({ ...validDetails, extraField: true })).toThrow(ApiError);
  });

  it('rejects symbol keys on WorkspaceDetails payload', () => {
    const withSym = { ...validDetails, [Symbol('hidden')]: 123 };
    expect(() => validateWorkspaceDetails(withSym)).toThrow(ApiError);
  });

  it('rejects missing keys on WorkspaceDetails payload', () => {
    const { version: _, ...missing } = validDetails;
    expect(() => validateWorkspaceDetails(missing)).toThrow(ApiError);
  });

  it('rejects UUIDv4 for id', () => {
    const v4 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(() => validateWorkspaceDetails({ ...validDetails, id: v4 })).toThrow(ApiError);
  });

  it('rejects date-only or invalid RFC3339 strings', () => {
    expect(() => validateWorkspaceDetails({ ...validDetails, createdAt: '2026-11-06' })).toThrow(
      ApiError,
    );

    expect(() => validateWorkspaceDetails({ ...validDetails, updatedAt: 'not-a-date' })).toThrow(
      ApiError,
    );
  });

  it('rejects reversed timestamps where createdAt > updatedAt', () => {
    expect(() =>
      validateWorkspaceDetails({
        ...validDetails,
        createdAt: '2026-11-06T10:00:00Z',
        updatedAt: '2026-11-06T09:00:00Z',
      }),
    ).toThrow(ApiError);
  });

  it('rejects version 0, negative version, or floating point version', () => {
    expect(() => validateWorkspaceDetails({ ...validDetails, version: 0 })).toThrow(ApiError);
    expect(() => validateWorkspaceDetails({ ...validDetails, version: -1 })).toThrow(ApiError);
    expect(() => validateWorkspaceDetails({ ...validDetails, version: 1.5 })).toThrow(ApiError);
  });

  it('rejects invalid status or role', () => {
    expect(() => validateWorkspaceDetails({ ...validDetails, status: 'deleted' })).toThrow(
      ApiError,
    );
    expect(() => validateWorkspaceDetails({ ...validDetails, role: 'superadmin' })).toThrow(
      ApiError,
    );
  });
});
