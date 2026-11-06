import { describe, expect, it } from 'vitest';
import {
  createInitialAppShellState,
  transitionAuthUnavailable,
  transitionDetailFailure,
  transitionDetailStart,
  transitionDetailSuccess,
  transitionSessionLoaded,
  transitionSessionLoading,
  transitionSetCreateModal,
  transitionSignOutFailure,
  transitionSignOutStart,
  transitionSignOutSuccess,
  transitionWorkspaceCreated,
} from '../src/lib/app-shell-state-transitions.js';
import type { CurrentUserResponse, WorkspaceDetails } from '../src/types/web-state.js';

const mockMeResponse: CurrentUserResponse = {
  user: {
    id: '018f4a1b-9b2e-7111-8000-000000000001',
    email: 'user@example.com',
    displayName: 'Test User',
  },
  session: {
    idleExpiresAt: '2026-11-06T10:00:00Z',
    absoluteExpiresAt: '2026-11-06T12:00:00Z',
  },
  workspaceAccess: {
    items: [
      {
        id: '018f4a1b-9b2e-7222-8000-000000000002',
        name: 'Workspace Alpha',
        slug: 'workspace-alpha',
        timezone: 'America/New_York',
        role: 'owner',
      },
    ],
    hasMore: false,
  },
};

const mockDetails: WorkspaceDetails = {
  id: '018f4a1b-9b2e-7222-8000-000000000002',
  name: 'Workspace Alpha',
  slug: 'workspace-alpha',
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

describe('AppShell State Transitions', () => {
  it('initial state is loading with no active workspace', () => {
    const s = createInitialAppShellState();
    expect(s.viewState.kind).toBe('loading');
    expect(s.selectedWorkspaceId).toBeNull();
    expect(s.activeWorkspace).toBeNull();
  });

  it('transitionSessionLoading resets view state to loading and clears logout error', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);
    s = transitionSignOutFailure(s, 'Logout failed');
    s = transitionSessionLoading(s);
    expect(s.viewState.kind).toBe('loading');
    expect(s.logoutError).toBeNull();
  });

  it('session loaded transitions to signed-in and selects first workspace', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);

    expect(s.viewState.kind).toBe('signed-in');
    if (s.viewState.kind === 'signed-in') {
      expect(s.viewState.user.id).toBe(mockMeResponse.user.id);
      expect(s.viewState.workspaces).toHaveLength(1);
    }
    expect(s.selectedWorkspaceId).toBe(mockMeResponse.workspaceAccess.items[0]!.id);
    expect(s.isDetailsLoading).toBe(true);
  });

  it('session loaded with null data transitions to signed-out', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, null);
    expect(s.viewState.kind).toBe('signed-out');
  });

  it('auth unavailable transitions to auth-unavailable with message', () => {
    let s = createInitialAppShellState();
    s = transitionAuthUnavailable(s, 'Service error');
    expect(s.viewState.kind).toBe('auth-unavailable');
    if (s.viewState.kind === 'auth-unavailable') {
      expect(s.viewState.message).toBe('Service error');
    }
  });

  it('failed logout preserves signed-in view state and user session, exposing visible error', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);
    s = transitionSignOutStart(s);
    expect(s.isSigningOut).toBe(true);

    s = transitionSignOutFailure(s, 'Network error during sign out');
    expect(s.isSigningOut).toBe(false);
    expect(s.logoutError).toBe('Network error during sign out');
    expect(s.viewState.kind).toBe('signed-in');
    if (s.viewState.kind === 'signed-in') {
      expect(s.viewState.user.id).toBe(mockMeResponse.user.id);
      expect(s.viewState.workspaces).toHaveLength(1);
    }
  });

  it('successful logout transitions to signed-out and clears state', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);
    s = transitionSignOutStart(s);
    s = transitionSignOutSuccess(s);

    expect(s.viewState.kind).toBe('signed-out');
    expect(s.isSigningOut).toBe(false);
    expect(s.logoutError).toBeNull();
    expect(s.selectedWorkspaceId).toBeNull();
    expect(s.activeWorkspace).toBeNull();
  });

  it('failed workspace detail load preserves workspace list and selected id, exposing retry state', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);
    const targetWsId = mockMeResponse.workspaceAccess.items[0]!.id;

    s = transitionDetailStart(s, targetWsId);
    expect(s.isDetailsLoading).toBe(true);
    expect(s.selectedWorkspaceId).toBe(targetWsId);

    s = transitionDetailFailure(s, 'Failed to fetch details');
    expect(s.isDetailsLoading).toBe(false);
    expect(s.detailsError).toBe('Failed to fetch details');
    expect(s.activeWorkspace).toBeNull();
    expect(s.selectedWorkspaceId).toBe(targetWsId);
    if (s.viewState.kind === 'signed-in') {
      expect(s.viewState.workspaces).toHaveLength(1);
    }
  });

  it('successful workspace detail load populates activeWorkspace and clears error', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);
    s = transitionDetailStart(s, mockDetails.id);
    s = transitionDetailSuccess(s, mockDetails);

    expect(s.isDetailsLoading).toBe(false);
    expect(s.detailsError).toBeNull();
    expect(s.activeWorkspace).toEqual(mockDetails);
  });

  it('workspace created prepends to workspaces list and sets as active', () => {
    let s = createInitialAppShellState();
    s = transitionSessionLoaded(s, mockMeResponse);

    const created: WorkspaceDetails = {
      id: '018f4a1b-9b2e-7333-8000-000000000003',
      name: 'New Brand',
      slug: 'new-brand',
      timezone: 'UTC',
      brandVoice: null,
      defaultDisclosure: null,
      aiEnabled: true,
      status: 'active',
      role: 'owner',
      createdAt: '2026-11-06T09:30:00Z',
      updatedAt: '2026-11-06T09:30:00Z',
      version: 1,
    };

    s = transitionWorkspaceCreated(s, created);
    expect(s.selectedWorkspaceId).toBe(created.id);
    expect(s.activeWorkspace).toEqual(created);
    expect(s.showCreateModal).toBe(false);
    if (s.viewState.kind === 'signed-in') {
      expect(s.viewState.workspaces).toHaveLength(2);
      expect(s.viewState.workspaces[0]!.id).toBe(created.id);
    }
  });

  it('toggling create modal updates showCreateModal flag', () => {
    let s = createInitialAppShellState();
    s = transitionSetCreateModal(s, true);
    expect(s.showCreateModal).toBe(true);
    s = transitionSetCreateModal(s, false);
    expect(s.showCreateModal).toBe(false);
  });
});
