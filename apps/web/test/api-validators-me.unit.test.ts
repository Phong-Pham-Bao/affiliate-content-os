import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api-validators-common.js';
import { validateCurrentUserResponse } from '../src/lib/api-validators.js';

describe('apps/web - validateCurrentUserResponse', () => {
  const validMe = {
    user: {
      id: '018f4a1b-9b2e-7111-8000-000000000001',
      email: 'alex@example.com',
      displayName: 'Alex',
    },
    session: {
      idleExpiresAt: '2026-11-06T10:00:00Z',
      absoluteExpiresAt: '2026-11-06T12:00:00Z',
    },
    workspaceAccess: {
      items: [
        {
          id: '018f4a1b-9b2e-7222-8000-000000000002',
          name: 'Main Space',
          slug: 'main-space',
          timezone: 'America/New_York',
          role: 'owner',
        },
      ],
      hasMore: false,
    },
  };

  it('validates a strictly compliant /me response', () => {
    const res = validateCurrentUserResponse(validMe);
    expect(res.user.id).toBe(validMe.user.id);
    expect(res.workspaceAccess.items[0]?.role).toBe('owner');
  });

  it('rejects extra keys on root object', () => {
    expect(() => validateCurrentUserResponse({ ...validMe, extra: 'forbidden' })).toThrow(ApiError);
  });

  it('rejects symbol keys on root object', () => {
    const withSym = { ...validMe, [Symbol('evil')]: 'test' };
    expect(() => validateCurrentUserResponse(withSym)).toThrow(ApiError);
  });

  it('rejects extra keys or aliases on user object (e.g. status, roles)', () => {
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        user: { ...validMe.user, status: 'active' },
      }),
    ).toThrow(ApiError);

    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        user: { ...validMe.user, role: 'admin' },
      }),
    ).toThrow(ApiError);
  });

  it('rejects extra keys on session object (e.g. id, token)', () => {
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        session: { ...validMe.session, id: 'session-id' },
      }),
    ).toThrow(ApiError);
  });

  it('rejects extra keys on workspaceAccess object (e.g. workspaces alias)', () => {
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        workspaceAccess: { ...validMe.workspaceAccess, workspaces: [] },
      }),
    ).toThrow(ApiError);
  });

  it('rejects extra keys on workspace summary item (e.g. workspaceId, permissions)', () => {
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        workspaceAccess: {
          ...validMe.workspaceAccess,
          items: [{ ...validMe.workspaceAccess.items[0], workspaceId: 'alias-id' }],
        },
      }),
    ).toThrow(ApiError);
  });

  it('rejects UUIDv4 in user.id or item.id', () => {
    const v4 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        user: { ...validMe.user, id: v4 },
      }),
    ).toThrow(ApiError);

    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        workspaceAccess: {
          ...validMe.workspaceAccess,
          items: [{ ...validMe.workspaceAccess.items[0], id: v4 }],
        },
      }),
    ).toThrow(ApiError);
  });

  it('rejects date-only or malformed dates in session timestamps', () => {
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        session: { ...validMe.session, idleExpiresAt: '2026-11-06' },
      }),
    ).toThrow(ApiError);
  });

  it('rejects reversed session timestamps where idleExpiresAt > absoluteExpiresAt', () => {
    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        session: {
          idleExpiresAt: '2026-11-06T15:00:00Z',
          absoluteExpiresAt: '2026-11-06T12:00:00Z',
        },
      }),
    ).toThrow(ApiError);
  });

  it('rejects workspaceAccess.items exceeding maximum of 100 items', () => {
    const itemTemplate = validMe.workspaceAccess.items[0]!;
    const tooManyItems = Array.from({ length: 101 }, (_, i) => ({
      ...itemTemplate,
      id: `018f4a1b-9b2e-7222-8000-${String(i).padStart(12, '0')}`,
      slug: `space-${i}`,
    }));

    expect(() =>
      validateCurrentUserResponse({
        ...validMe,
        workspaceAccess: {
          items: tooManyItems,
          hasMore: true,
        },
      }),
    ).toThrow(ApiError);
  });

  it('rejects non-object root or missing properties', () => {
    expect(() => validateCurrentUserResponse(null)).toThrow(ApiError);
    expect(() => validateCurrentUserResponse('string')).toThrow(ApiError);
    expect(() => validateCurrentUserResponse({ user: validMe.user })).toThrow(ApiError);
  });
});
