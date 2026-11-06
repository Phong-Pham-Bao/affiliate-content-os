import type {
  CurrentUserResponse,
  ViewState,
  WorkspaceDetails,
  WorkspaceSummaryItem,
} from '../types/web-state.js';

export interface AppShellState {
  readonly viewState: ViewState;
  readonly selectedWorkspaceId: string | null;
  readonly activeWorkspace: WorkspaceDetails | null;
  readonly isDetailsLoading: boolean;
  readonly detailsError: string | null;
  readonly isSigningOut: boolean;
  readonly logoutError: string | null;
  readonly showCreateModal: boolean;
}

export function createInitialAppShellState(): AppShellState {
  return {
    viewState: { kind: 'loading' },
    selectedWorkspaceId: null,
    activeWorkspace: null,
    isDetailsLoading: false,
    detailsError: null,
    isSigningOut: false,
    logoutError: null,
    showCreateModal: false,
  };
}

export function transitionSessionLoading(state: AppShellState): AppShellState {
  return {
    ...state,
    viewState: { kind: 'loading' },
    logoutError: null,
  };
}

export function transitionSessionLoaded(
  state: AppShellState,
  data: CurrentUserResponse | null,
): AppShellState {
  if (!data) {
    return {
      ...state,
      viewState: { kind: 'signed-out' },
      selectedWorkspaceId: null,
      activeWorkspace: null,
      isDetailsLoading: false,
      detailsError: null,
      logoutError: null,
    };
  }

  const workspaces = data.workspaceAccess.items;
  return {
    ...state,
    viewState: {
      kind: 'signed-in',
      user: data.user,
      session: data.session,
      workspaces,
    },
    selectedWorkspaceId: workspaces.length > 0 ? workspaces[0]!.id : null,
    activeWorkspace: null,
    isDetailsLoading: workspaces.length > 0,
    detailsError: null,
    logoutError: null,
    showCreateModal: false,
  };
}

export function transitionAuthUnavailable(state: AppShellState, message: string): AppShellState {
  return {
    ...state,
    viewState: { kind: 'auth-unavailable', message },
    selectedWorkspaceId: null,
    activeWorkspace: null,
    isDetailsLoading: false,
    detailsError: null,
  };
}

export function transitionSignOutStart(state: AppShellState): AppShellState {
  return {
    ...state,
    isSigningOut: true,
    logoutError: null,
  };
}

export function transitionSignOutSuccess(state: AppShellState): AppShellState {
  return {
    ...state,
    viewState: { kind: 'signed-out' },
    isSigningOut: false,
    logoutError: null,
    selectedWorkspaceId: null,
    activeWorkspace: null,
    isDetailsLoading: false,
    detailsError: null,
    showCreateModal: false,
  };
}

export function transitionSignOutFailure(state: AppShellState, error: string): AppShellState {
  return {
    ...state,
    isSigningOut: false,
    logoutError: error,
  };
}

export function transitionDetailStart(state: AppShellState, workspaceId: string): AppShellState {
  return {
    ...state,
    selectedWorkspaceId: workspaceId,
    isDetailsLoading: true,
    detailsError: null,
  };
}

export function transitionDetailSuccess(
  state: AppShellState,
  workspace: WorkspaceDetails,
): AppShellState {
  return {
    ...state,
    activeWorkspace: workspace,
    isDetailsLoading: false,
    detailsError: null,
  };
}

export function transitionDetailFailure(state: AppShellState, error: string): AppShellState {
  return {
    ...state,
    activeWorkspace: null,
    isDetailsLoading: false,
    detailsError: error,
  };
}

export function transitionWorkspaceCreated(
  state: AppShellState,
  workspace: WorkspaceDetails,
): AppShellState {
  if (state.viewState.kind !== 'signed-in') return state;

  const summaryItem: WorkspaceSummaryItem = {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    role: workspace.role,
  };

  return {
    ...state,
    viewState: {
      ...state.viewState,
      workspaces: [summaryItem, ...state.viewState.workspaces],
    },
    selectedWorkspaceId: workspace.id,
    activeWorkspace: workspace,
    detailsError: null,
    showCreateModal: false,
  };
}

export function transitionSetCreateModal(state: AppShellState, show: boolean): AppShellState {
  return {
    ...state,
    showCreateModal: show,
  };
}
