import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['dist/**', '.astro/**'] },
  js.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: { 'no-eval': 'error', 'no-new-func': 'error' },
  },
];
