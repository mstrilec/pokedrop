import js from '@eslint/js';
import next from 'eslint-config-next';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole workspace.
 *
 * typescript-eslint's `projectService` resolves every file to its owning
 * tsconfig.json on its own, so a single root pass is both simpler and faster
 * than running ESLint once per package with three separate TS programs.
 *
 * Formatting is Prettier's job alone: `eslint-config-prettier` goes last and
 * switches off every stylistic rule the two would otherwise fight over.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'design/**',
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,

  // Backend and shared contracts: type-aware linting.
  //
  // no-floating-promises and no-misused-promises are the reason this is worth
  // the extra seconds. A forgotten await inside a Prisma transaction or a
  // BullMQ processor fails silently, and with no test suite there is nothing
  // else that would catch it.
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
  },

  // Frontend: Next's own rules plus plain (non type-aware) TypeScript rules.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended, next],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Pages Router only, and it resolves 'pages/' against the ESLint root
      // rather than apps/web, so in this monorepo it can do nothing but warn
      // that a directory we deliberately do not have is missing.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // Root-level config files (this one, commitlint, next.config.ts).
  {
    files: ['*.mjs', '*.js', 'apps/*/*.{mjs,js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // The workspace boundary promised in PD-10: the two apps talk only through
  // @pokedrop/shared. Until now this held only because no dependency edge
  // existed; this makes a violation fail loudly.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // These match the import specifier as written, not the
              // resolved path, so the relative form has to be listed too:
              // from apps/web/app the sibling app reads as ../../api/...
              group: [
                '@pokedrop/api',
                '@pokedrop/api/**',
                '**/apps/api/**',
                '**/api/src/**',
                '../**/api/**',
              ],
              message:
                'apps/web must not import from apps/api. Share types and schemas through @pokedrop/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@pokedrop/web',
                '@pokedrop/web/**',
                '**/apps/web/**',
                '**/web/app/**',
                '../**/web/**',
              ],
              message:
                'apps/api must not import from apps/web. Share types and schemas through @pokedrop/shared.',
            },
          ],
        },
      ],
    },
  },

  prettierConfig,
);
