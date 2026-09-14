import { RoleSchema, type Role } from '@pokedrop/shared';

/**
 * Placeholder home page. The real landing page is PD-101.
 *
 * It exists so the workspace has something that renders, and it deliberately
 * consumes a contract from @pokedrop/shared so that a broken cross-package
 * type boundary fails `pnpm typecheck` rather than surfacing later.
 */
export default function Home() {
  const roles: readonly Role[] = RoleSchema.options;

  return (
    <main style={{ padding: '2rem', fontFamily: 'var(--font-geist-sans)' }}>
      <h1>PokéDrop</h1>
      <p>Workspace scaffolding is in place. Pages land in PD-101 and later.</p>
      <p>
        Roles from <code>@pokedrop/shared</code>: {roles.join(', ')}
      </p>
    </main>
  );
}
