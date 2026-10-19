// Development authentication provider for 4evergent.
//
// Phase 28I: Authentication & Owner Identity Foundation.
//
// This provider is NOT for production use. It provides deterministic
// identity for local development, automated tests, and CI.
//
// Identity comes from explicit server configuration, NOT from request body.
// Client-provided ownerId is NEVER trusted.

import type { AuthProvider, AuthRequest, AuthenticatedPrincipal } from "./auth.js";

/**
 * Configuration for DevAuthProvider.
 *
 * `defaultOwnerId` is used when no credentials are provided.
 * `apiKeys` maps bearer tokens to ownerIds (for multi-user testing).
 */
export interface DevAuthConfig {
  /** Default owner identity when no credentials are provided. */
  defaultOwnerId: string;
  /** Optional API key mappings for multi-user testing. */
  apiKeys?: Record<string, string>;
}

/**
 * DevAuthProvider — development/test authentication.
 *
 * Authentication flow:
 * 1. Check Authorization: Bearer <key> header
 * 2. If key matches configured API key, return mapped ownerId
 * 3. Otherwise, return defaultOwnerId (always authenticated in dev)
 *
 * The default ownerId comes from explicit configuration, NOT hardcoded.
 */
export class DevAuthProvider implements AuthProvider {
  private readonly defaultOwnerId: string;
  private readonly apiKeys: Map<string, string>;

  constructor(config: DevAuthConfig) {
    this.defaultOwnerId = config.defaultOwnerId;
    this.apiKeys = new Map(Object.entries(config.apiKeys ?? {}));
  }

  async authenticate(req: AuthRequest): Promise<AuthenticatedPrincipal | null> {
    const authHeader = req.headers["authorization"];
    if (authHeader) {
      const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      if (headerValue && headerValue.startsWith("Bearer ")) {
        const key = headerValue.slice(7);
        const ownerId = this.apiKeys.get(key);
        if (ownerId) {
          return {
            subject: `apikey:${key.slice(0, 8)}`,
            ownerId,
          };
        }
        // Invalid key — fall through to default (dev mode is permissive)
      }
    }

    // Default dev identity
    return {
      subject: "dev-user",
      ownerId: this.defaultOwnerId,
    };
  }
}
