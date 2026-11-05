import { isWorkspaceRole, type WorkspaceRole } from './types.js';

export const WORKSPACE_CAPABILITIES = [
  'workspace.read',
  'workspace.manage',
  'workspace.delete_export',
  'members.read',
  'members.manage',
  'social_accounts.manage',
  'catalog.read',
  'catalog.manage',
  'content.read',
  'content.manage',
  'content.approve',
  'publications.read',
  'publications.manage',
  'analytics.read',
  'audit.read',
] as const;

export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>(WORKSPACE_CAPABILITIES);

export function isWorkspaceCapability(value: unknown): value is WorkspaceCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}

const VIEWER_CAPABILITIES = new Set<WorkspaceCapability>([
  'workspace.read',
  'members.read',
  'catalog.read',
  'content.read',
  'publications.read',
  'analytics.read',
  'audit.read',
]);

const EDITOR_CAPABILITIES = new Set<WorkspaceCapability>([
  ...VIEWER_CAPABILITIES,
  'catalog.manage',
  'content.manage',
  'content.approve',
  'publications.manage',
]);

const OWNER_CAPABILITIES = new Set<WorkspaceCapability>(WORKSPACE_CAPABILITIES);

export function canWorkspaceRole(role: WorkspaceRole, capability: WorkspaceCapability): boolean {
  if (!isWorkspaceRole(role) || !isWorkspaceCapability(capability)) {
    return false;
  }

  if (role === 'viewer') {
    return VIEWER_CAPABILITIES.has(capability);
  }

  if (role === 'editor') {
    return EDITOR_CAPABILITIES.has(capability);
  }

  if (role === 'owner') {
    return OWNER_CAPABILITIES.has(capability);
  }

  return false;
}
