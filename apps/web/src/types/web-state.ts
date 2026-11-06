export interface CurrentUserDTO {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export interface CurrentSessionDTO {
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
}

export interface WorkspaceSummaryItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly role: 'owner' | 'editor' | 'viewer';
}

export interface CurrentUserResponse {
  readonly user: CurrentUserDTO;
  readonly session: CurrentSessionDTO;
  readonly workspaceAccess: {
    readonly items: readonly WorkspaceSummaryItem[];
    readonly hasMore: boolean;
  };
}

export interface WorkspaceDetails {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly brandVoice: string | null;
  readonly defaultDisclosure: string | null;
  readonly aiEnabled: boolean;
  readonly status: 'active' | 'suspended' | 'deletion_pending';
  readonly role: 'owner' | 'editor' | 'viewer';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ApiProblemDetails {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

export type ViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'auth-unavailable'; readonly message: string }
  | {
      readonly kind: 'signed-in';
      readonly user: CurrentUserDTO;
      readonly session: CurrentSessionDTO;
      readonly workspaces: readonly WorkspaceSummaryItem[];
    };
