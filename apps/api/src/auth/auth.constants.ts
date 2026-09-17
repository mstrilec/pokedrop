/**
 * Injection token for the configured Better Auth instance.
 *
 * A token rather than a class so that swapping the provider means replacing one
 * factory, not rewriting every consumer — see the note in this folder's
 * README.md.
 */
export const AUTH_INSTANCE = Symbol('AUTH_INSTANCE');

/**
 * Where the handler is mounted. Deliberately outside the versioned `/api/v1`
 * prefix: these routes belong to Better Auth's own contract, and versioning
 * them would mean versioning someone else's URLs.
 */
export const AUTH_BASE_PATH = '/api/auth';
