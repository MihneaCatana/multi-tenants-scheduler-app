// Flat-config ESLint for the Simi backend (ESLint v9 + typescript-eslint).
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2023,
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Handled by @typescript-eslint/no-unused-vars above.
      'no-unused-vars': 'off',
      // TypeScript already catches truly undefined identifiers at compile time;
      // `no-undef` is a JS rule that misfires on Node/browser globals (process,
      // console, Buffer, crypto, …) in TS files. Leave it off for .ts.
      'no-undef': 'off',
    },
  },
  // Test files: relax rules that are commonly needed for mocking.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'src/db/migrations/**', 'coverage/**'],
  },
];
