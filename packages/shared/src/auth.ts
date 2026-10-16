// Authentication & identity types for 4evergent.
//
// Phase 28I: Authentication & Owner Identity Foundation.
//
// This module defines the authentication boundary abstraction.
// Production auth providers (JWT, OAuth, API keys) implement AuthProvider.
// Development/testing uses DevAuthProvider.

/**
 * AuthenticatedPrincipal — trusted identity derived from authentication.
 *
 * `subject` is the external identity (e.g., JWT "sub", API key hash).
 * `ownerId` is the internal stable application owner identity.
 *
 * Handlers and authorization code MUST use `ownerId` from this principal.
 * Client-provided ownerId is NEVER trusted.
 */
export interface AuthenticatedPrincipal {
  /** External identity identifier (stable across sessions). */
  readonly subject: string;
  /** Internal application owner identity (UUID or stable string). */
  readonly ownerId: string;
}

/**
 * AuthProvider — authentication boundary abstraction.
 *
 * Implementations verify credentials and produce an AuthenticatedPrincipal.
 * The handler layer does NOT know or care about the auth mechanism.
 */
export interface AuthProvider {
  /**
   * Authenticate an incoming request.
   * Returns the authenticated principal, or null if unauthenticated.
   */
  authenticate(req: AuthRequest): Promise<AuthenticatedPrincipal | null>;
}

/**
 * Minimal request shape needed by AuthProvider.
 * Decouples auth from Node.js http.IncomingMessage.
 */
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Create an authenticated principal (for tests/programmatic use).
 */
export function principal(subject: string, ownerId: string): AuthenticatedPrincipal {
  return { subject, ownerId };
}
