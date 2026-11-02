import type { AuthenticatedSessionContext } from './authenticate-session.js';
import type { WorkspaceSummaryItemDTO, WorkspaceSummaryPort } from './ports.js';

export interface CurrentUserResponseDTO {
  readonly user: {
    readonly id: string;
    readonly email: string | null;
    readonly displayName: string | null;
  };
  readonly session: {
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
  };
  readonly workspaceAccess: {
    readonly items: readonly WorkspaceSummaryItemDTO[];
    readonly hasMore: boolean;
  };
}

export interface GetCurrentUserDependencies {
  readonly workspaceSummary: WorkspaceSummaryPort;
}

export async function getCurrentUser(
  context: AuthenticatedSessionContext,
  deps: GetCurrentUserDependencies,
): Promise<CurrentUserResponseDTO> {
  const summaries = await deps.workspaceSummary.listActiveWorkspaceSummaries(context.user.id);

  return Object.freeze({
    user: Object.freeze({
      id: context.user.id,
      email: context.user.email,
      displayName: context.user.displayName,
    }),
    session: Object.freeze({
      idleExpiresAt: context.session.idleExpiresAt,
      absoluteExpiresAt: context.session.absoluteExpiresAt,
    }),
    workspaceAccess: Object.freeze({
      items: summaries.items,
      hasMore: summaries.hasMore,
    }),
  });
}
