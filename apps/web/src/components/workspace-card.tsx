import type { ReactElement } from 'react';
import type { WorkspaceDetails } from '../types/web-state.js';

interface WorkspaceCardProps {
  readonly workspace: WorkspaceDetails;
}

export function WorkspaceCard({ workspace }: WorkspaceCardProps): ReactElement {
  return (
    <article className="workspace-overview-card" aria-labelledby="ws-card-title">
      <header className="workspace-card-header">
        <div className="title-row">
          <h2 id="ws-card-title" className="workspace-name">
            {workspace.name}
          </h2>
          <div className="badge-row">
            <span className={`badge role-badge role-${workspace.role}`}>
              {workspace.role.toUpperCase()}
            </span>
            <span className="badge status-badge status-active">{workspace.status}</span>
          </div>
        </div>
        <p className="workspace-slug">
          Slug: <code>{workspace.slug}</code>
        </p>
      </header>

      <section className="workspace-attributes" aria-label="Workspace configuration">
        <dl className="attributes-grid">
          <div className="attribute-item">
            <dt>Timezone</dt>
            <dd>{workspace.timezone}</dd>
          </div>
          <div className="attribute-item">
            <dt>AI Generation</dt>
            <dd>{workspace.aiEnabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div className="attribute-item">
            <dt>Brand Voice</dt>
            <dd>{workspace.brandVoice || 'None specified'}</dd>
          </div>
          <div className="attribute-item">
            <dt>Default Disclosure</dt>
            <dd>{workspace.defaultDisclosure || 'None specified'}</dd>
          </div>
        </dl>
      </section>

      <section className="checkpoint-banner" aria-label="Checkpoint status">
        <p className="checkpoint-text">
          <strong>Checkpoint A Active:</strong> Workspace tenancy, authenticated session, and owner
          membership are verified. Catalog, facts, and generation runs arrive in Checkpoint B.
        </p>
      </section>
    </article>
  );
}
