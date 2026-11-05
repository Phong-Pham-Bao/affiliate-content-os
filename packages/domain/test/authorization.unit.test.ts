import { describe, expect, it } from 'vitest';
import {
  canWorkspaceRole,
  isWorkspaceCapability,
  WORKSPACE_CAPABILITIES,
  type WorkspaceCapability,
} from '../src/authorization.js';
import { WORKSPACE_ROLES, type WorkspaceRole } from '../src/types.js';

describe('Domain Authorization Policy & Closed Capability Matrix', () => {
  it('exports exactly the 15 approved closed capabilities with no duplicates', () => {
    const expected = [
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
    ];

    expect(WORKSPACE_CAPABILITIES).toHaveLength(15);
    expect(WORKSPACE_CAPABILITIES).toEqual(expected);

    const set = new Set(WORKSPACE_CAPABILITIES);
    expect(set.size).toBe(15);
  });

  describe('isWorkspaceCapability', () => {
    it('returns true for every valid capability', () => {
      for (const cap of WORKSPACE_CAPABILITIES) {
        expect(isWorkspaceCapability(cap)).toBe(true);
      }
    });

    it('returns false for primitive non-capability strings', () => {
      const invalidStrings = [
        '',
        ' ',
        'workspace',
        'workspace.',
        'workspace.read ',
        ' workspace.read',
        'WORKSPACE.READ',
        '*',
        'workspace.*',
        'admin',
        'super',
        'manage',
        'audit',
        'catalog',
      ];
      for (const str of invalidStrings) {
        expect(isWorkspaceCapability(str)).toBe(false);
      }
    });

    it('returns false for non-string values', () => {
      const nonStrings = [
        null,
        undefined,
        123,
        true,
        false,
        Symbol('workspace.read'),
        { capability: 'workspace.read' },
        ['workspace.read'],
        () => 'workspace.read',
      ];
      for (const val of nonStrings) {
        expect(isWorkspaceCapability(val)).toBe(false);
      }
    });
  });

  describe('canWorkspaceRole role-capability matrix', () => {
    const viewerAllowed = new Set<WorkspaceCapability>([
      'workspace.read',
      'members.read',
      'catalog.read',
      'content.read',
      'publications.read',
      'analytics.read',
      'audit.read',
    ]);

    const editorAllowed = new Set<WorkspaceCapability>([
      ...viewerAllowed,
      'catalog.manage',
      'content.manage',
      'content.approve',
      'publications.manage',
    ]);

    const ownerAllowed = new Set<WorkspaceCapability>(WORKSPACE_CAPABILITIES);

    it('exhaustively evaluates all 45 cells in the 3x15 matrix', () => {
      expect(WORKSPACE_ROLES).toEqual(['owner', 'editor', 'viewer']);
      expect(WORKSPACE_CAPABILITIES).toHaveLength(15);

      for (const cap of WORKSPACE_CAPABILITIES) {
        // Viewer
        const isViewerAllowed = viewerAllowed.has(cap);
        expect(canWorkspaceRole('viewer', cap)).toBe(isViewerAllowed);

        // Editor
        const isEditorAllowed = editorAllowed.has(cap);
        expect(canWorkspaceRole('editor', cap)).toBe(isEditorAllowed);

        // Owner
        const isOwnerAllowed = ownerAllowed.has(cap);
        expect(canWorkspaceRole('owner', cap)).toBe(isOwnerAllowed);
      }
    });

    it('enforces exact viewer capabilities (7 allowed, 8 denied)', () => {
      let allowedCount = 0;
      let deniedCount = 0;

      for (const cap of WORKSPACE_CAPABILITIES) {
        if (canWorkspaceRole('viewer', cap)) {
          allowedCount++;
        } else {
          deniedCount++;
        }
      }

      expect(allowedCount).toBe(7);
      expect(deniedCount).toBe(8);

      // Verify viewer specifically cannot perform mutations
      expect(canWorkspaceRole('viewer', 'workspace.manage')).toBe(false);
      expect(canWorkspaceRole('viewer', 'workspace.delete_export')).toBe(false);
      expect(canWorkspaceRole('viewer', 'members.manage')).toBe(false);
      expect(canWorkspaceRole('viewer', 'social_accounts.manage')).toBe(false);
      expect(canWorkspaceRole('viewer', 'catalog.manage')).toBe(false);
      expect(canWorkspaceRole('viewer', 'content.manage')).toBe(false);
      expect(canWorkspaceRole('viewer', 'content.approve')).toBe(false);
      expect(canWorkspaceRole('viewer', 'publications.manage')).toBe(false);
    });

    it('enforces exact editor capabilities (11 allowed, 4 denied)', () => {
      let allowedCount = 0;
      let deniedCount = 0;

      for (const cap of WORKSPACE_CAPABILITIES) {
        if (canWorkspaceRole('editor', cap)) {
          allowedCount++;
        } else {
          deniedCount++;
        }
      }

      expect(allowedCount).toBe(11);
      expect(deniedCount).toBe(4);

      // Verify editor management operations succeed
      expect(canWorkspaceRole('editor', 'catalog.manage')).toBe(true);
      expect(canWorkspaceRole('editor', 'content.manage')).toBe(true);
      expect(canWorkspaceRole('editor', 'content.approve')).toBe(true);
      expect(canWorkspaceRole('editor', 'publications.manage')).toBe(true);

      // Verify editor cannot perform owner-only operations
      expect(canWorkspaceRole('editor', 'workspace.manage')).toBe(false);
      expect(canWorkspaceRole('editor', 'workspace.delete_export')).toBe(false);
      expect(canWorkspaceRole('editor', 'members.manage')).toBe(false);
      expect(canWorkspaceRole('editor', 'social_accounts.manage')).toBe(false);
    });

    it('enforces exact owner capabilities (all 15 allowed, 0 denied)', () => {
      let allowedCount = 0;
      let deniedCount = 0;

      for (const cap of WORKSPACE_CAPABILITIES) {
        if (canWorkspaceRole('owner', cap)) {
          allowedCount++;
        } else {
          deniedCount++;
        }
      }

      expect(allowedCount).toBe(15);
      expect(deniedCount).toBe(0);
    });

    it('fails closed for unknown or coerced roles', () => {
      const unknownRoles = [
        'admin',
        'super',
        'root',
        'member',
        'collaborator',
        'user',
        '',
        'OWNER',
        'EDITOR',
        'VIEWER',
        null,
        undefined,
        123,
        {},
      ];

      for (const role of unknownRoles) {
        for (const cap of WORKSPACE_CAPABILITIES) {
          expect(canWorkspaceRole(role as WorkspaceRole, cap)).toBe(false);
        }
      }
    });

    it('fails closed for unknown or wildcard capabilities', () => {
      const unknownCaps = [
        '*',
        'workspace.*',
        'admin',
        'all',
        '',
        'workspace.read.all',
        'workspace.read ',
        null,
        undefined,
        123,
      ];

      for (const role of WORKSPACE_ROLES) {
        for (const cap of unknownCaps) {
          expect(canWorkspaceRole(role, cap as WorkspaceCapability)).toBe(false);
        }
      }
    });
  });
});
