// Authentication context for 4evergent dashboard.
//
// Backend authentication is authoritative. The browser session is an
// HttpOnly SameSite cookie (set by the API on login) — the client never
// stores or reads the session token. API requests are sent with
// credentials: 'include' plus an X-Requested-With header (CSRF guard for
// cookie-authenticated state-changing requests).
//
// Legacy Bearer-token helpers are kept for the CLI / API-key consumers and
// are NOT used for user login.

const SUBJECT_KEY = '4evergent.auth.subject';

export interface AuthState {
  subject: string | null;
}

export function getStoredSubject(): string | null {
  try {
    return sessionStorage.getItem(SUBJECT_KEY);
  } catch {
    return null;
  }
}

export function storeSubject(subject: string): void {
  try {
    sessionStorage.setItem(SUBJECT_KEY, subject);
  } catch {
    // Storage unavailable — subject display only; session is cookie-based
  }
}

export function clearStoredSubject(): void {
  try {
    sessionStorage.removeItem(SUBJECT_KEY);
  } catch {
    // Ignore
  }
}

// Legacy Bearer helpers — retained for API-key/CLI flows only.
const TOKEN_KEY = '4evergent.auth.token';

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeAuth(token: string, subject: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(SUBJECT_KEY, subject);
  } catch {
    // Storage unavailable — auth will be session-only in memory
  }
}

export function clearAuth(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SUBJECT_KEY);
  } catch {
    // Ignore
  }
}
