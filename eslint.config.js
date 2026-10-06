// Root config: lints repository scripts and config files only. Each workspace has its own config.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['apps/**', 'packages/**', '**/node_modules/**', '**/dist/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules: { 'no-eval': 'error', 'no-new-func': 'error', 'no-implied-eval': 'error' },
  },
];
