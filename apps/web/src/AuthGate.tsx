import { useState, useEffect, useCallback } from 'react';
import { getStoredToken, storeAuth, clearAuth, getStoredSubject } from './auth';
import { api } from './api';
import LogoMark from './components/LogoMark';

interface AuthProps {
  children: React.ReactNode;
}

interface AuthState {
  authenticated: boolean | null;
  loginError: string | null;
  loading: boolean;
}

/**
 * AuthGate — validates session against a PROTECTED endpoint.
 * Does NOT treat public /health as an auth check.
 */
export function AuthGate({ children }: AuthProps) {
  const [authenticated, setAuthenticated] = useState<AuthState['authenticated']>(null);
  const [loginError, setLoginError] = useState<AuthState['loginError']>(null);
  const [loading, setLoading] = useState<AuthState['loading']>(false);

  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      api.listAgents()
        .then(() => setAuthenticated(true))
        .catch(() => {
          clearAuth();
          setAuthenticated(false);
        });
    } else {
      setAuthenticated(false);
    }
  }, []);

  const handleLogin = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);

    const formData = new FormData(e.currentTarget);
    const token = formData.get('token') as string;

    if (!token || token.trim().length === 0) {
      setLoginError('Please enter a token');
      setLoading(false);
      return;
    }

    storeAuth(token.trim(), 'pending');

    try {
      // Validate against a PROTECTED endpoint: public /health does not
      // exercise the token, so it cannot prove the session is valid.
      await api.listAgents();
      const subject = getStoredSubject() ?? 'authenticated-user';
      storeAuth(token.trim(), subject);
      setAuthenticated(true);
    } catch (_err) {
      clearAuth();
      setLoginError('Invalid token or authentication failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearAuth();
    setAuthenticated(false);
  }, []);

  if (authenticated === null) {
    return (
      <div className="auth-screen">
        <div className="auth-box">
          <LogoMark className="auth-logo" size={32} />
          <h1>4evergent</h1>
          <p className="muted">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="auth-screen">
        <form className="auth-box" onSubmit={handleLogin}>
          <LogoMark className="auth-logo" size={32} />
          <h1>4evergent</h1>
          <p className="muted">Enter your access token to continue.</p>

          <div className="auth-field">
            <label htmlFor="token">Access Token</label>
            <input
              id="token"
              name="token"
              type="password"
              placeholder="Enter your Bearer token"
              autoComplete="off"
              autoFocus
            />
          </div>

          {loginError && <div className="error-banner">{loginError}</div>}

          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>

          <div className="auth-help">
            <p className="muted">Development: Any non-empty token works with DevAuthProvider.</p>
            <p className="muted">Production: Use a valid API key or JWT.</p>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="app-with-logout">
      <LogoutButton onLogout={handleLogout} />
      {children}
    </div>
  );
}

function LogoutButton({ onLogout }: { onLogout: () => void }) {
  return (
    <button className="logout-btn" onClick={onLogout} title="Sign out">
      Sign Out
    </button>
  );
}
