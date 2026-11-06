import type { ChangeEvent, ReactElement } from 'react';
import type { WorkspaceSummaryItem } from '../types/web-state.js';

interface WorkspaceSelectorProps {
  readonly workspaces: readonly WorkspaceSummaryItem[];
  readonly activeWorkspaceId: string | null;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onOpenCreateModal: () => void;
}

export function WorkspaceSelector({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onOpenCreateModal,
}: WorkspaceSelectorProps): ReactElement {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.currentTarget.value;
    if (val === '__new__') {
      onOpenCreateModal();
    } else if (val && val !== activeWorkspaceId) {
      onSelectWorkspace(val);
    }
  };

  return (
    <div className="workspace-selector-group">
      <label htmlFor="workspace-select" className="sr-only">
        Active Workspace
      </label>
      <select
        id="workspace-select"
        value={activeWorkspaceId ?? ''}
        onChange={handleChange}
        className="workspace-dropdown"
        aria-label="Select active workspace"
      >
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name} ({ws.role})
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onOpenCreateModal}
        className="btn-secondary btn-new-workspace"
        aria-label="Create new workspace"
      >
        + New Workspace
      </button>
    </div>
  );
}
