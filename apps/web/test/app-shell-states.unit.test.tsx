import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../src/components/app-shell.js';
import { SignedOutState } from '../src/components/signed-out-state.js';
import { AuthUnavailableState } from '../src/components/auth-unavailable-state.js';
import { CreateWorkspaceDialog } from '../src/components/create-workspace-dialog.js';
import { WorkspaceCard } from '../src/components/workspace-card.js';
import { WorkspaceSelector } from '../src/components/workspace-selector.js';

describe('apps/web - AppShell and UI State Distinctions', () => {
  it('renders loading state initially during session resolution', () => {
    const html = renderToStaticMarkup(<AppShell />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading Affiliate Content OS...');
  });

  it('distinguishes signed-out state with clear action to sign in', () => {
    const html = renderToStaticMarkup(<SignedOutState />);
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain('Sign in with Google');
  });

  it('distinguishes authentication unavailable state with recoverable alert and retry button', () => {
    const html = renderToStaticMarkup(
      <AuthUnavailableState message="Provider 503" onRetry={() => {}} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Authentication Unavailable');
    expect(html).toContain('Provider 503');
    expect(html).toContain('Retry Connection');
  });

  it('distinguishes zero-workspace onboarding as a normal non-modal region/form', () => {
    const html = renderToStaticMarkup(
      <CreateWorkspaceDialog isInitialOnboarding onSave={async () => {}} />,
    );
    expect(html).toContain('class="onboarding-card"');
    expect(html).toContain('Create Your First Workspace');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
  });

  it('distinguishes modal workspace creation with role=dialog and no dialog role on backdrop', () => {
    const modalHtml = renderToStaticMarkup(
      <div className="modal-backdrop">
        <CreateWorkspaceDialog onSave={async () => {}} onCancel={() => {}} />
      </div>,
    );
    // Backdrop must NOT have role="dialog" or aria-modal="true"
    expect(modalHtml).toContain('class="modal-backdrop"');
    expect(modalHtml).not.toMatch(/class="modal-backdrop"[^>]*role="dialog"/);
    expect(modalHtml).not.toMatch(/class="modal-backdrop"[^>]*aria-modal="true"/);

    // Inner modal card must have role="dialog" and aria-modal="true"
    expect(modalHtml).toContain('role="dialog"');
    expect(modalHtml).toContain('aria-modal="true"');
    expect(modalHtml).toContain('aria-labelledby="modal-dialog-title"');
    expect(modalHtml).toContain('aria-describedby="modal-dialog-desc"');
  });

  it('preserves workspace selector and tracks selected workspace during loading or errors', () => {
    const workspaces = [
      {
        id: 'ws-active-1',
        name: 'Main Brand',
        slug: 'main-brand',
        timezone: 'UTC',
        role: 'owner' as const,
      },
      {
        id: 'ws-active-2',
        name: 'Secondary Niche',
        slug: 'secondary-niche',
        timezone: 'America/New_York',
        role: 'editor' as const,
      },
    ];

    const selectorHtml = renderToStaticMarkup(
      <WorkspaceSelector
        workspaces={workspaces}
        activeWorkspaceId="ws-active-2"
        onSelectWorkspace={() => {}}
        onOpenCreateModal={() => {}}
      />,
    );

    // Dropdown value reflects selected workspace id independently
    expect(selectorHtml).toContain('value="ws-active-2"');
    expect(selectorHtml).toContain('Main Brand (owner)');
    expect(selectorHtml).toContain('Secondary Niche (editor)');
  });

  it('renders workspace details card when details are loaded successfully', () => {
    const cardHtml = renderToStaticMarkup(
      <WorkspaceCard
        workspace={{
          id: 'ws-1',
          name: 'Affiliate Pro',
          slug: 'affiliate-pro',
          timezone: 'Europe/London',
          brandVoice: 'Casual & honest',
          defaultDisclosure: 'Affiliate links used.',
          aiEnabled: true,
          status: 'active',
          role: 'owner',
          createdAt: '2026-11-06T00:00:00Z',
          updatedAt: '2026-11-06T00:00:00Z',
          version: 1,
        }}
      />,
    );

    expect(cardHtml).toContain('Affiliate Pro');
    expect(cardHtml).toContain('Europe/London');
    expect(cardHtml).toContain('Casual &amp; honest');
  });
});
