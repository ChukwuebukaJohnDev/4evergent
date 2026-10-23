// Production API key authentication provider for 4evergent.
//
// Phase 28T: Production Authentication.
//
// This provider validates Bearer tokens against server-side configured API keys.
// It is NOT for development/testing — use DevAuthProvider instead.
//
// Identity comes from validated credentials, NEVER from client input.
// Client-provided ownerId is NEVER trusted.

import type { AuthProvider, AuthRequest, AuthenticatedPrincipal } from "./auth.js";

/**
 * Configuration for ProductionApiKeyAuthProvider.
 *
 * Each API key maps to a specific ownerId and subject.
 * Keys should be cryptographically random and stored as server-side secrets.
 */
export interface ProductionAuthConfig {
  /** Map of API keys to their associated identity. */
  apiKeys: Record<string, { ownerId: string; subject: string }>;
}

/**
 * ProductionApiKeyAuthProvider — production authentication.
 *
 * Authentication flow:
 * 1. Check Authorization: Bearer *** header
 * 2. If key matches configured API key, return mapped identity
 * 3. Otherwise, return null (unauthenticated)
 *
 * No fallback. No default identity. Invalid credentials = unauthenticated.
 */
export class ProductionApiKeyAuthProvider implements AuthProvider {
  private readonly apiKeys: Map<string, { ownerId: string; subject: string }>;

  constructor(config: ProductionAuthConfig) {
    this.apiKeys = new Map(Object.entries(config.apiKeys));
  }

  async authenticate(req: AuthRequest): Promise<AuthenticatedPrincipal | null> {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return null;

    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerValue || !headerValue.startsWith("Bearer ")) return null;

    const key = headerValue.slice(7);
    const identity = this.apiKeys.get(key);
    if (!identity) return null;

    return {
      subject: identity.subject,
      ownerId: identity.ownerId,
    };
  }
}
