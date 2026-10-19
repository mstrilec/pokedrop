import js from '@eslint/js';
import next from 'eslint-config-next';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared by both `apps/api` blocks: flat config takes the last match, so the providers block
 * must repeat this group or it silently drops the workspace boundary.
 */
const apiMustNotImportWeb = {
  // These match the import specifier as written, not the resolved path, so the
  // relative form has to be listed too.
  group: ['@pokedrop/web', '@pokedrop/web/**', '**/apps/web/**', '**/web/app/**', '../**/web/**'],
  message:
    'apps/api must not import from apps/web. Share types and schemas through @pokedrop/shared.',
};

const providerInternalsAreSealed = {
  group: [
    '**/sync/providers/*/**',
    './providers/*/**',
    '../providers/*/**',
    '../**/sync/providers/*/**',
  ],
  message:
    'Provider internals stay behind apps/api/src/sync/providers/index.ts. Import the interface, DTOs, errors and tokens from there.',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,

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

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended, next],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off',

      'no-restricted-syntax': [
        'error',
        ...['Literal[value', 'TemplateElement[value.raw'].flatMap((node) => [
          {
            selector: `${node}=/(^|\\[)#[0-9a-fA-F]{3,8}(\\]|$)/]`,
            message: 'Use a color token from app/globals.css instead of a hex value.',
          },
          {
            selector: `${node}=/(^|[\\s:])-?(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|inset(-[xy])?|top|right|bottom|left)-\\[[^\\]]*\\d(px|rem)/]`,
            message: 'Use the 4px spacing scale (p-4, gap-3, ...) instead of an arbitrary length.',
          },
        ]),
      ],
    },
  },

  {
    files: ['*.mjs', '*.js', 'apps/*/*.{mjs,js,ts}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'cn',
              allowTypeImports: true,
              message:
                "Import cn from '@/lib/utils': it knows the design system's text sizes, radii and shadows.",
            },
          ],
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
        { patterns: [apiMustNotImportWeb, providerInternalsAreSealed] },
      ],
    },
  },
  // The providers folder is what the seal protects, not what it constrains: a
  // client imports its own raw schema and mapper, and may reach a sibling
  // provider by a long path. Last match wins, so this restates the workspace
  // boundary rather than only dropping the seal.
  {
    files: ['apps/api/src/sync/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [apiMustNotImportWeb] }],
    },
  },

  prettierConfig,
);
