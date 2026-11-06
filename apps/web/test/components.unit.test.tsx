import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingState } from '../src/components/loading-state.js';
import { SignedOutState } from '../src/components/signed-out-state.js';
import { AuthUnavailableState } from '../src/components/auth-unavailable-state.js';
import { UserNav } from '../src/components/user-nav.js';
import { WorkspaceSelector } from '../src/components/workspace-selector.js';
import { WorkspaceCard } from '../src/components/workspace-card.js';
import { WorkspaceFormFields } from '../src/components/workspace-form-fields.js';
import { CreateWorkspaceDialog } from '../src/components/create-workspace-dialog.js';

describe('Web Components Rendering', () => {
  it('renders LoadingState with accessible status role', () => {
    const html = renderToStaticMarkup(<LoadingState />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading Affiliate Content OS...');
  });

  it('renders SignedOutState with sign-in link pointing to /auth/login', () => {
    const html = renderToStaticMarkup(<SignedOutState />);
    expect(html).toContain('Affiliate Content OS');
    expect(html).toContain('href="/auth/login"');
    expect(html).toContain('Sign in with Google');
  });

  it('renders AuthUnavailableState with error alert and message', () => {
    const html = renderToStaticMarkup(
      <AuthUnavailableState message="Auth service offline" onRetry={() => {}} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Authentication Unavailable');
    expect(html).toContain('Auth service offline');
    expect(html).toContain('Retry Connection');
  });

  it('renders UserNav with user details and sign out button matching exact schema', () => {
    const html = renderToStaticMarkup(
      <UserNav
        user={{
          id: '0192b012-3456-789a-8bcd-ef0123456701',
          email: 'jane@example.com',
          displayName: 'Jane Doe',
        }}
        session={{
          idleExpiresAt: '2026-11-06T14:30:00Z',
          absoluteExpiresAt: '2026-11-06T22:00:00Z',
        }}
        onSignOut={() => {}}
      />,
    );
    expect(html).toContain('Jane Doe');
    expect(html).toContain('jane@example.com');
    expect(html).toContain('Session idle until:');
    expect(html).toContain('Sign out');
  });

  it('renders WorkspaceSelector with accessible dropdown and create button using id and role', () => {
    const workspaces = [
      {
        id: 'ws-1',
        name: 'Alpha Blog',
        slug: 'alpha-blog',
        timezone: 'UTC',
        role: 'owner' as const,
      },
      {
        id: 'ws-2',
        name: 'Beta News',
        slug: 'beta-news',
        timezone: 'America/New_York',
        role: 'viewer' as const,
      },
    ];
    const html = renderToStaticMarkup(
      <WorkspaceSelector
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        onSelectWorkspace={() => {}}
        onOpenCreateModal={() => {}}
      />,
    );
    expect(html).toContain('Alpha Blog (owner)');
    expect(html).toContain('Beta News (viewer)');
    expect(html).toContain('+ New Workspace');
  });

  it('renders WorkspaceCard with role badge, settings, and Checkpoint A banner', () => {
    const html = renderToStaticMarkup(
      <WorkspaceCard
        workspace={{
          id: 'ws-1',
          name: 'Acme Media',
          slug: 'acme-media',
          timezone: 'America/New_York',
          brandVoice: 'Authoritative',
          defaultDisclosure: 'We earn commissions.',
          aiEnabled: true,
          status: 'active',
          role: 'owner',
          createdAt: '2026-11-06T00:00:00Z',
          updatedAt: '2026-11-06T00:00:00Z',
          version: 1,
        }}
      />,
    );
    expect(html).toContain('Acme Media');
    expect(html).toContain('acme-media');
    expect(html).toContain('OWNER');
    expect(html).toContain('America/New_York');
    expect(html).toContain('Authoritative');
    expect(html).toContain('We earn commissions.');
    expect(html).toContain('Checkpoint A Active:');
  });

  it('renders CreateWorkspaceDialog in initial onboarding mode as a normal section, not a modal dialog', () => {
    const html = renderToStaticMarkup(
      <CreateWorkspaceDialog isInitialOnboarding onSave={async () => {}} />,
    );
    expect(html).toContain('class="onboarding-card"');
    expect(html).toContain('aria-labelledby="onboarding-title"');
    expect(html).toContain('aria-describedby="onboarding-desc"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
  });

  it('renders CreateWorkspaceDialog in modal mode with role=dialog, aria-modal, and accessible labels', () => {
    const html = renderToStaticMarkup(
      <CreateWorkspaceDialog onSave={async () => {}} onCancel={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="modal-dialog-title"');
    expect(html).toContain('aria-describedby="modal-dialog-desc"');
    expect(html).toContain('Cancel');
  });

  it('renders WorkspaceFormFields with inputs, labels, and validation errors', () => {
    const html = renderToStaticMarkup(
      <WorkspaceFormFields
        values={{
          name: 'My Store',
          slug: 'my-store',
          timezone: 'UTC',
          brandVoice: '',
          defaultDisclosure: '',
          aiEnabled: true,
        }}
        fieldErrors={{ slug: 'Slug must be lowercase alphanumeric.' }}
        onNameChange={() => {}}
        onSlugChange={() => {}}
        onTimezoneChange={() => {}}
        onBrandVoiceChange={() => {}}
        onDisclosureChange={() => {}}
        onAiEnabledChange={() => {}}
      />,
    );
    expect(html).toContain('Workspace Name *');
    expect(html).toContain('Slug (URL Identifier) *');
    expect(html).toContain('Slug must be lowercase alphanumeric.');
    expect(html).toContain('Enable AI Generation for this workspace');
  });
});
