'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  createWorkspaceApi,
  fetchCurrentUser,
  fetchWorkspaceDetails,
  logoutUser,
  type CreateWorkspacePayload,
} from '../lib/api-client.js';
import { WorkspaceDetailRequestCoordinator } from '../lib/workspace-detail-request-coordinator.js';
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
  type AppShellState,
} from '../lib/app-shell-state-transitions.js';
import { LoadingState } from './loading-state.js';
import { SignedOutState } from './signed-out-state.js';
import { AuthUnavailableState } from './auth-unavailable-state.js';
import { UserNav } from './user-nav.js';
import { WorkspaceSelector } from './workspace-selector.js';
import { WorkspaceCard } from './workspace-card.js';
import { CreateWorkspaceDialog } from './create-workspace-dialog.js';

export function AppShell(): ReactElement {
  const [state, setState] = useState<AppShellState>(createInitialAppShellState);
  const coordinatorRef = useRef(new WorkspaceDetailRequestCoordinator());

  const loadWorkspaceDetails = async (workspaceId: string) => {
    const handle = coordinatorRef.current.startRequest(workspaceId);
    setState((prev) => transitionDetailStart(prev, workspaceId));

    try {
      const details = await fetchWorkspaceDetails(workspaceId, handle.signal);
      if (!coordinatorRef.current.isCurrent(handle.sequence)) return;
      setState((prev) => transitionDetailSuccess(prev, details));
    } catch (err: unknown) {
      if (!coordinatorRef.current.isCurrent(handle.sequence)) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load workspace details.';
      setState((prev) => transitionDetailFailure(prev, message));
    }
  };

  const loadSession = async () => {
    coordinatorRef.current.invalidate();
    setState(transitionSessionLoading);

    try {
      const data = await fetchCurrentUser();
      if (!data) {
        setState((prev) => transitionSessionLoaded(prev, null));
        return;
      }
      setState((prev) => transitionSessionLoaded(prev, data));
      const firstWs = data.workspaceAccess.items[0];
      if (firstWs) {
        void loadWorkspaceDetails(firstWs.id);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Authentication service is unavailable or misconfigured.';
      setState((prev) => transitionAuthUnavailable(prev, message));
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const handleSignOut = async () => {
    coordinatorRef.current.invalidate();
    setState(transitionSignOutStart);

    try {
      await logoutUser();
      setState(transitionSignOutSuccess);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign out failed. Please try again.';
      setState((prev) => transitionSignOutFailure(prev, message));
    }
  };

  const handleSaveWorkspace = async (payload: CreateWorkspacePayload, idempotencyKey: string) => {
    const newWs = await createWorkspaceApi(payload, idempotencyKey);
    coordinatorRef.current.invalidate();
    setState((prev) => transitionWorkspaceCreated(prev, newWs));
  };

  const { viewState } = state;
  if (viewState.kind === 'loading') return <LoadingState />;
  if (viewState.kind === 'signed-out') return <SignedOutState />;
  if (viewState.kind === 'auth-unavailable') {
    return <AuthUnavailableState message={viewState.message} onRetry={() => void loadSession()} />;
  }

  const { user, session, workspaces } = viewState;

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          <h1 className="app-brand-title">Affiliate Content OS</h1>
          {workspaces.length > 0 && (
            <WorkspaceSelector
              workspaces={workspaces}
              activeWorkspaceId={state.selectedWorkspaceId}
              onSelectWorkspace={(id) => void loadWorkspaceDetails(id)}
              onOpenCreateModal={() => setState((s) => transitionSetCreateModal(s, true))}
            />
          )}
        </div>
        <UserNav
          user={user}
          session={session}
          onSignOut={() => void handleSignOut()}
          isSigningOut={state.isSigningOut}
        />
      </header>

      {state.logoutError && (
        <div role="alert" className="error-banner logout-error-banner">
          <span>{state.logoutError}</span>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="btn-secondary btn-retry"
          >
            Retry
          </button>
        </div>
      )}

      <main className="app-content">
        {workspaces.length === 0 ? (
          <CreateWorkspaceDialog isInitialOnboarding onSave={handleSaveWorkspace} />
        ) : state.isDetailsLoading ? (
          <div role="status" aria-live="polite" className="workspace-loading-state">
            Loading workspace details...
          </div>
        ) : state.detailsError ? (
          <div role="alert" className="workspace-error-banner">
            <p>{state.detailsError}</p>
            {state.selectedWorkspaceId && (
              <button
                type="button"
                onClick={() => void loadWorkspaceDetails(state.selectedWorkspaceId!)}
                className="btn-secondary btn-retry"
              >
                Retry
              </button>
            )}
          </div>
        ) : state.activeWorkspace ? (
          <WorkspaceCard workspace={state.activeWorkspace} />
        ) : (
          <div className="empty-workspace-state">Select a workspace to view details.</div>
        )}

        {state.showCreateModal && (
          <div className="modal-backdrop">
            <CreateWorkspaceDialog
              onSave={handleSaveWorkspace}
              onCancel={() => setState((s) => transitionSetCreateModal(s, false))}
            />
          </div>
        )}
      </main>
    </div>
  );
}
