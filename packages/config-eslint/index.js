// Shared ESLint flat configs for Verbis. See CLAUDE.md §3–4 and §9.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const APP_PACKAGES = [
  '@verbis/api',
  '@verbis/connector-hub',
  '@verbis/designer-web',
  '@verbis/agent-web',
  '@verbis/admin-web',
];

const IGNORES = [
  '**/dist/**',
  '**/benchmark-dist/**',
  '**/benchmark-report/**',
  '**/storybook-static/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.stryker-tmp/**',
  '**/reports/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/src/generated/**',
];

/**
 * CLAUDE.md rule 10: no string-to-code. Rule 3/12: no secrets in the browser.
 * @param {string[]} extraPatterns
 */
const restrictedImports = (extraPatterns) => [
  'error',
  {
    paths: [
      { name: 'vm', message: 'Dynamic code execution is forbidden (ADR-0007).' },
      { name: 'node:vm', message: 'Dynamic code execution is forbidden (ADR-0007).' },
    ],
    patterns: [
      {
        group: APP_PACKAGES,
        message: 'Apps must never be imported (CLAUDE.md §3).',
      },
      {
        group: ['**/apps/**', '../../apps/**'],
        message: 'Apps must never be imported (CLAUDE.md §3).',
      },
      ...extraPatterns,
    ],
  },
];

/**
 * @param {object} options
 * @param {string} options.tsconfigRootDir Directory of the calling package (import.meta.dirname).
 * @param {'node' | 'react' | 'plain'} [options.kind]
 * @param {{ group: string[]; message: string }[]} [options.restrictedImportPatterns] Extra layer rules.
 */
export function createConfig({ tsconfigRootDir, kind = 'node', restrictedImportPatterns = [] }) {
  const runtimeGlobals = kind === 'react' ? globals.browser : globals.node;

  return tseslint.config(
    { ignores: IGNORES },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: runtimeGlobals,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: { 'import-x': importX },
      rules: {
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        'no-restricted-globals': [
          'error',
          { name: 'eval', message: 'Forbidden (ADR-0007).' },
          { name: 'Function', message: 'Forbidden (ADR-0007).' },
        ],
        'no-restricted-imports': restrictedImports(restrictedImportPatterns),
        'no-console': 'error',
        eqeqeq: ['error', 'always'],
        '@typescript-eslint/no-explicit-any': 'error',
        // NestJS modules are decorated classes with static factories.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
        ],
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
            pathGroups: [{ pattern: '@verbis/**', group: 'internal', position: 'before' }],
            pathGroupsExcludedImportTypes: ['builtin'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'import-x/no-duplicates': 'error',
        'import-x/first': 'error',
        'import-x/newline-after-import': 'error',
      },
    },
    ...(kind === 'react'
      ? [
          {
            files: ['**/*.tsx', '**/*.jsx'],
            ...react.configs.flat.recommended,
            ...react.configs.flat['jsx-runtime'],
            settings: { react: { version: '18.3' } },
          },
          {
            files: ['**/*.tsx', '**/*.jsx'],
            plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
            rules: {
              ...react.configs.flat.recommended.rules,
              ...react.configs.flat['jsx-runtime'].rules,
              ...reactHooks.configs.recommended.rules,
              ...jsxA11y.flatConfigs.strict.rules,
              // CLAUDE.md §5.2 (SECURITY): no raw HTML injection.
              'react/no-danger': 'error',
              'react/no-danger-with-children': 'error',
              'react/jsx-no-target-blank': 'error',
              'react/jsx-no-script-url': 'error',
              // CLAUDE.md rule 5: user-visible text must come from i18n keys.
              'react/jsx-no-literals': [
                'error',
                { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '/', ':'] },
              ],
            },
          },
        ]
      : []),
    {
      files: ['**/*.spec.ts', '**/*.spec.tsx', '**/e2e/**', '**/*.config.ts', '**/*.config.js'],
      rules: {
        'no-console': 'off',
        'react/jsx-no-literals': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}

export default createConfig;
