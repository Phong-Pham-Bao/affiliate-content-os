import type { ReactElement } from 'react';
import type { CurrentSessionDTO, CurrentUserDTO } from '../types/web-state.js';

interface UserNavProps {
  readonly user: CurrentUserDTO;
  readonly session: CurrentSessionDTO;
  readonly onSignOut: () => void;
  readonly isSigningOut?: boolean;
}

export function UserNav({
  user,
  session,
  onSignOut,
  isSigningOut = false,
}: UserNavProps): ReactElement {
  const expiryTime = new Date(session.idleExpiresAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <nav className="user-nav" aria-label="User account navigation">
      <div className="user-meta">
        <span className="user-name" title={user.displayName ?? 'User'}>
          {user.displayName ?? 'Authenticated User'}
        </span>
        {user.email && <span className="user-email">({user.email})</span>}
        <span className="session-expiry" title={`Idle expires at ${session.idleExpiresAt}`}>
          Session idle until: {expiryTime}
        </span>
      </div>

      <button
        type="button"
        onClick={onSignOut}
        disabled={isSigningOut}
        className="btn-secondary btn-signout"
        aria-label="Sign out of application"
      >
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
    </nav>
  );
}
